// Razorpay provider — Payment Links for checkout, Subscriptions for AutoPay, HMAC webhooks.
import crypto from 'crypto';
import { SoftwareInvoice, newInvoiceId, markInvoicePaid } from './invoices.js';
import { Library } from '../models.js';
import { addInterval } from '../billing.js';

const API = 'https://api.razorpay.com/v1';

function basicAuth(keyId, keySecret) {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
}

async function rzFetch(path, { keyId, keySecret, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: basicAuth(keyId, keySecret),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.description || data?.message || `Razorpay HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status >= 500 ? 502 : 400;
    err.code = 'razorpay_error';
    err.raw = data;
    throw err;
  }
  return data;
}

export function verifyRazorpaySignature(rawBody, signature, webhookSecret) {
  if (!webhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}

/** Also used for Checkout.js payment verification (order|payment HMAC). */
export function verifyPaymentSignature({ orderId, paymentId, signature, keySecret }) {
  const payload = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac('sha256', keySecret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}

export function createRazorpayProvider({ keyId, keySecret, webhookSecret = '', mode = 'test' }) {
  const cfg = { keyId, keySecret, webhookSecret, mode };

  return {
    name: 'razorpay',
    mode,

    async createCheckout({ library, plan, interval, amount, returnUrl }) {
      const amtPaise = Math.round(Number(amount) * 100);
      if (!amtPaise || amtPaise < 100) throw Object.assign(new Error('Amount too small'), { status: 400 });
      const invoiceId = newInvoiceId();
      const currency = 'INR';
      await SoftwareInvoice.create({
        invoiceId,
        tenantId: library.libraryId,
        planId: plan?.planId || library.planId,
        interval: interval || library.subscription?.interval || 'month',
        amount: Number(amount),
        currency,
        status: 'open',
        provider: 'razorpay',
        dueAt: new Date(),
      });
      const link = await rzFetch('/payment_links', {
        ...cfg,
        method: 'POST',
        body: {
          amount: amtPaise,
          currency,
          accept_partial: false,
          description: `Library OS — ${plan?.name || library.planId || 'subscription'} (${interval || 'month'})`,
          customer: {
            name: library.name,
            email: library.contactEmail || undefined,
          },
          notify: { email: true, sms: false },
          reminder_enable: false,
          callback_url: returnUrl || undefined,
          callback_method: returnUrl ? 'get' : undefined,
          notes: {
            tenantId: library.libraryId,
            invoiceId,
            planId: plan?.planId || library.planId || '',
            interval: interval || 'month',
          },
        },
      });
      await SoftwareInvoice.updateOne({ invoiceId }, { $set: { providerRef: link.id } });
      return { url: link.short_url || link.url, reference: link.id, invoiceId, provider: 'razorpay' };
    },

    /** Create a Razorpay subscription plan + subscription for AutoPay (optional). */
    async createAutoPay({ library, plan, interval, amount, totalCount = 120, returnUrl }) {
      const period = interval === 'year' ? 'yearly' : 'monthly';
      const amtPaise = Math.round(Number(amount) * 100);
      const rzPlan = await rzFetch('/plans', {
        ...cfg,
        method: 'POST',
        body: {
          period,
          interval: 1,
          item: {
            name: `Library OS ${plan?.name || plan?.planId}`,
            amount: amtPaise,
            currency: 'INR',
          },
          notes: { planId: plan?.planId || '', tenantId: library.libraryId },
        },
      });
      const sub = await rzFetch('/subscriptions', {
        ...cfg,
        method: 'POST',
        body: {
          plan_id: rzPlan.id,
          total_count: totalCount,
          customer_notify: 1,
          notes: { tenantId: library.libraryId, planId: plan?.planId || '' },
          notify_info: library.contactEmail ? { notify_email: library.contactEmail } : undefined,
        },
      });
      await Library.updateOne(
        { libraryId: library.libraryId },
        { $set: { 'subscription.providerSubId': sub.id, 'subscription.provider': 'razorpay' } },
      );
      return { url: sub.short_url, reference: sub.id, provider: 'razorpay', autoPay: true };
    },

    async cancel({ library }) {
      const subId = library?.subscription?.providerSubId;
      if (!subId) return;
      try {
        await rzFetch(`/subscriptions/${subId}/cancel`, { ...cfg, method: 'POST', body: { cancel_at_cycle_end: 1 } });
      } catch (e) {
        console.error('[razorpay] cancel failed:', e.message);
      }
    },

    verifyWebhook(rawBody, headers) {
      const sig = headers['x-razorpay-signature'] || headers['X-Razorpay-Signature'];
      return verifyRazorpaySignature(rawBody, sig, cfg.webhookSecret);
    },

    async handleWebhook(event) {
      const type = event?.event;
      const payload = event?.payload || {};
      // Payment link paid
      if (type === 'payment_link.paid') {
        const pl = payload.payment_link?.entity || payload.payment_link;
        const notes = pl?.notes || {};
        const payment = payload.payment?.entity;
        return activateFromPayment({
          tenantId: notes.tenantId,
          invoiceId: notes.invoiceId,
          providerRef: pl?.id || payment?.id,
          amount: payment?.amount ? payment.amount / 100 : undefined,
          interval: notes.interval,
          planId: notes.planId,
          raw: event,
        });
      }
      if (type === 'payment.captured') {
        const payment = payload.payment?.entity;
        const notes = payment?.notes || {};
        return activateFromPayment({
          tenantId: notes.tenantId,
          invoiceId: notes.invoiceId,
          providerRef: payment?.id,
          amount: payment?.amount ? payment.amount / 100 : undefined,
          interval: notes.interval,
          planId: notes.planId,
          raw: event,
        });
      }
      if (type === 'subscription.charged' || type === 'subscription.activated') {
        const sub = payload.subscription?.entity;
        const payment = payload.payment?.entity;
        const notes = sub?.notes || {};
        return activateFromPayment({
          tenantId: notes.tenantId,
          providerRef: payment?.id || sub?.id,
          interval: notes.interval || (sub?.plan_id ? undefined : 'month'),
          planId: notes.planId,
          raw: event,
          autoPay: true,
        });
      }
      if (type === 'subscription.pending' || type === 'subscription.halted') {
        const sub = payload.subscription?.entity;
        const tenantId = sub?.notes?.tenantId;
        if (tenantId) {
          await Library.updateOne({ libraryId: tenantId }, { $set: { 'subscription.status': 'past_due' } });
          return { ok: true, status: 'past_due', tenantId };
        }
      }
      if (type === 'subscription.cancelled' || type === 'subscription.completed') {
        const sub = payload.subscription?.entity;
        const tenantId = sub?.notes?.tenantId;
        if (tenantId) {
          await Library.updateOne({ libraryId: tenantId }, { $set: { 'subscription.status': 'cancelled', 'subscription.cancelAtPeriodEnd': false } });
          return { ok: true, status: 'cancelled', tenantId };
        }
      }
      return { ok: true, ignored: type };
    },
  };
}

async function activateFromPayment({ tenantId, invoiceId, providerRef, amount, interval, planId, raw, autoPay }) {
  if (!tenantId) return { ok: false, error: 'missing_tenant' };
  const lib = await Library.findOne({ libraryId: tenantId });
  if (!lib) return { ok: false, error: 'library_not_found' };
  const now = new Date();
  const iv = interval || lib.subscription?.interval || 'month';
  const periodEnd = addInterval(now, iv);
  const next = {
    ...(lib.subscription?.toObject?.() || lib.subscription || {}),
    status: 'active',
    interval: iv,
    price: amount != null ? Number(amount) : lib.subscription?.price,
    currentPeriodEnd: periodEnd,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    pendingPlanId: null,
    provider: 'razorpay',
    lastPaymentAt: now,
    lastPaymentRef: providerRef || null,
    ...(autoPay ? {} : {}),
  };
  if (planId) next.planId = planId;
  const set = { subscription: next };
  if (planId) set.planId = planId;
  else if (next.planId) set.planId = next.planId;
  await Library.updateOne({ libraryId: tenantId }, { $set: set });
  if (invoiceId) await markInvoicePaid(invoiceId, { providerRef, paidAt: now, raw });
  else if (providerRef) {
    await SoftwareInvoice.create({
      invoiceId: newInvoiceId(),
      tenantId,
      planId: planId || lib.planId,
      interval: iv,
      amount: amount ?? next.price ?? 0,
      currency: 'INR',
      status: 'paid',
      provider: 'razorpay',
      providerRef,
      paidAt: now,
      periodStart: now,
      periodEnd,
      raw,
    }).catch(() => {});
  }
  return { ok: true, tenantId, status: 'active', periodEnd };
}

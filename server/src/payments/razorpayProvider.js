// Razorpay provider — Payment Links for checkout, Subscriptions for AutoPay, HMAC webhooks.
import crypto from 'crypto';
import { SoftwareInvoice, newInvoiceId } from './invoices.js';
import { settleInvoice } from './settlement.js';
import { Library } from '../models.js';

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
    // Reachability probe: this is not a payment, capture or charge.
    async testConnection() {
      await rzFetch('/payment_links?count=1', { ...cfg, method: 'GET' });
      return true;
    },
    mode,

    async createCheckout({ library, plan, interval, amount, returnUrl, invoiceId: requestedInvoiceId }) {
      const amtPaise = Math.round(Number(amount) * 100);
      if (!amtPaise || amtPaise < 100) throw Object.assign(new Error('Amount too small'), { status: 400 });
      const existing = requestedInvoiceId ? await SoftwareInvoice.findOne({ invoiceId: requestedInvoiceId, tenantId: library.libraryId, provider: 'razorpay', status: 'open' }).exec() : null;
      if (requestedInvoiceId && !existing) throw Object.assign(new Error('Saved checkout invoice was not found for this library'), { status: 409, code: 'invoice_conflict' });
      const invoiceId = requestedInvoiceId || newInvoiceId();
      const currency = existing?.currency || 'INR';
      if (existing) {
        await SoftwareInvoice.updateOne({ invoiceId }, { $set: { amount: Number(amount), provider: 'razorpay', dueAt: new Date(), gatewayMinor: amtPaise,
            ...(existing.totalMinor < amtPaise ? { totalMinor: amtPaise } : {}) } });
      } else {
        await SoftwareInvoice.create({
          invoiceId,
          tenantId: library.libraryId,
          planId: plan?.planId || library.planId,
          interval: interval || library.subscription?.interval || 'month',
          amount: Number(amount),
          totalMinor: amtPaise, baseMinor: amtPaise, taxableMinor: amtPaise,
          currency,
          status: 'open',
          provider: 'razorpay',
          dueAt: new Date(),
        });
      }
      const link = await rzFetch('/payment_links', {
        ...cfg,
        method: 'POST',
        body: {
          amount: amtPaise,
          currency,
          accept_partial: false,
          description: `My Library OS — ${plan?.name || library.planId || 'subscription'} (${interval || 'month'})`,
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
      await SoftwareInvoice.updateOne({ invoiceId }, { $set: { providerRef: link.id, providerOrderRef: link.id } });
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
            name: `My Library OS ${plan?.name || plan?.planId}`,
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
      if (type === 'payment_link.paid') {
        const pl = payload.payment_link?.entity || payload.payment_link;
        const notes = pl?.notes || {};
        const payment = payload.payment?.entity;
        const amountPaise = payment?.amount ?? pl?.amount_paid ?? pl?.amount;
        return activateFromPayment({
          tenantId: notes.tenantId,
          invoiceId: notes.invoiceId,
          providerRef: payment?.id || pl?.id,
          providerOrderRef: pl?.id,
          currency: payment?.currency || pl?.currency,
          amountMinor: amountPaise != null ? Number(amountPaise) : undefined,
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
          providerOrderRef: notes.paymentLinkId || notes.payment_link_id || null,
          currency: payment?.currency,
          amountMinor: payment?.amount != null ? Number(payment.amount) : undefined,
          raw: event,
        });
      }
      if (type === 'subscription.charged' || type === 'subscription.activated') {
        const sub = payload.subscription?.entity;
        const payment = payload.payment?.entity;
        const notes = sub?.notes || {};
        const lib = sub?.id ? await Library.findOne({ 'subscription.providerSubId': sub.id }).lean() : null;
        const invoiceId = notes.invoiceId || (sub?.id ? (await SoftwareInvoice.findOne({ providerRef: sub.id, status: 'open' }).lean())?.invoiceId : null);
        return activateFromPayment({
          tenantId: lib?.libraryId || null,
          invoiceId,
          providerRef: payment?.id || sub?.id,
          providerOrderRef: sub?.id,
          currency: payment?.currency || sub?.currency,
          amountMinor: payment?.amount != null ? Number(payment.amount) : undefined,
          raw: event,
          autoPay: true,
        });
      }
      if (type === 'subscription.pending' || type === 'subscription.halted') {
        const sub = payload.subscription?.entity;
        const lib = sub?.id ? await Library.findOne({ 'subscription.providerSubId': sub.id }) : null;
        if (lib) {
          await Library.updateOne({ libraryId: lib.libraryId }, { $set: { 'subscription.status': 'past_due' } });
          return { ok: true, status: 'past_due', tenantId: lib.libraryId };
        }
      }
      if (type === 'subscription.cancelled' || type === 'subscription.completed') {
        const sub = payload.subscription?.entity;
        const lib = sub?.id ? await Library.findOne({ 'subscription.providerSubId': sub.id }) : null;
        if (lib) {
          await Library.updateOne({ libraryId: lib.libraryId }, { $set: { 'subscription.status': 'cancelled', 'subscription.cancelAtPeriodEnd': false } });
          return { ok: true, status: 'cancelled', tenantId: lib.libraryId };
        }
      }
      return { ok: true, ignored: type };
    }
  };
}

async function activateFromPayment({ tenantId, invoiceId, providerRef, providerOrderRef, amountMinor, currency, raw }) {
  // Never create an invoice from callback notes. A real, pre-created invoice must exist.
  if (!invoiceId) return { ok: false, error: 'invoice_required' };
  const invoice = await SoftwareInvoice.findOne({ invoiceId }).lean();
  if (!invoice) return { ok: false, error: 'invoice_not_found' };
  if (tenantId && invoice.tenantId !== tenantId) return { ok: false, error: 'tenant_invoice_mismatch' };
  const settled = await settleInvoice(invoiceId, {
    providerRef, providerOrderRef, raw, source: 'razorpay', provider: 'razorpay',
    gatewayMinor: amountMinor, currency,
  });
  if (!settled.ok) {
    return { ok: false, error: settled.error || 'settlement_failed', tenantId: invoice.tenantId, invoiceId };
  }
  return { ok: true, tenantId: invoice.tenantId, invoiceId, status: invoice.kind === 'topup' ? 'paid' : 'active', periodEnd: settled.invoice?.periodEnd, already: settled.already, requiresRecovery: settled.requiresRecovery };
}

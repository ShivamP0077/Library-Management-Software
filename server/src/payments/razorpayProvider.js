// Razorpay provider — Payment Links for checkout, Subscriptions for AutoPay, HMAC webhooks.
import crypto from 'crypto';
import { SoftwareInvoice, newInvoiceId, findUsableOpenInvoice } from './invoices.js';
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

/** True when this payment is one of the link's payments, or shares the link's order id. */
export function paymentMatchesPaymentLink(link, payment) {
  if (!link || !payment) return false;
  const payId = payment.id || payment.payment_id;
  const payments = Array.isArray(link.payments) ? link.payments : [];
  if (payId && payments.some((p) => {
    const id = p && (p.payment_id || p.id);
    return id && String(id) === String(payId);
  })) return true;
  const orderId = payment.order_id || payment.orderId;
  if (orderId && link.order_id && String(link.order_id) === String(orderId)) return true;
  return false;
}

function noteBag(notes) {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return {};
  return notes;
}

function noteString(notes, key) {
  const value = noteBag(notes)[key];
  if (value == null || value === '') return null;
  return String(value);
}

function storedPlinkId(invoice) {
  if (!invoice) return null;
  for (const ref of [invoice.providerRef, invoice.providerOrderRef]) {
    if (typeof ref === 'string' && ref.startsWith('plink_')) return ref;
  }
  return null;
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

  // payment.captured does not include the payment-link id. Notes may, after we
  // patch them. Otherwise confirm the captured payment is on the invoice's plink_.
  async function resolveCapturedOrderRef(payment, notes) {
    const noteLink = noteString(notes, 'paymentLinkId') || noteString(notes, 'payment_link_id');
    if (noteLink) return noteLink;
    const orderId = payment?.order_id ? String(payment.order_id) : null;
    const invoiceId = noteString(notes, 'invoiceId');
    if (!invoiceId) return orderId;
    const invoice = await SoftwareInvoice.findOne({ invoiceId }).lean();
    const plinkId = storedPlinkId(invoice);
    if (!plinkId) return orderId;
    try {
      const link = await rzFetch(`/payment_links/${encodeURIComponent(plinkId)}`, {
        keyId: cfg.keyId,
        keySecret: cfg.keySecret,
      });
      if (paymentMatchesPaymentLink(link, payment)) return plinkId;
    } catch (e) {
      console.error('[razorpay] payment link lookup failed:', e.message);
    }
    // Lookup failed, or this payment is not on that link. Do not force the plink id.
    return orderId;
  }

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
      // A brand-new invoice often has no provider yet. A missing, void, paid,
      // or other-library id is ignored and a new checkout is started.
      const existing = await findUsableOpenInvoice({ invoiceId: requestedInvoiceId, tenantId: library.libraryId, provider: 'razorpay' });
      const invoiceId = existing ? existing.invoiceId : newInvoiceId();
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
      const notes = {
        tenantId: library.libraryId,
        invoiceId,
        planId: plan?.planId || library.planId || '',
        interval: interval || 'month',
      };
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
          notes,
        },
      });
      // The link id does not exist until Razorpay creates the link, so it cannot
      // be written into the create-time notes. Update the link notes afterwards.
      // Settlement does not depend on this: payment.captured looks the link up.
      if (link?.id) {
        try {
          await rzFetch(`/payment_links/${encodeURIComponent(link.id)}`, {
            ...cfg,
            method: 'PATCH',
            body: {
              notes: {
                ...notes,
                paymentLinkId: link.id,
                payment_link_id: link.id,
              },
            },
          });
        } catch (e) {
          console.error('[razorpay] could not store payment link id on the link notes:', e.message);
        }
      }
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
      if (type === 'payment.captured' || type === 'order.paid') {
        const payment = payload.payment?.entity;
        const order = payload.order?.entity;
        const notes = { ...noteBag(order?.notes), ...noteBag(payment?.notes) };
        const providerOrderRef = await resolveCapturedOrderRef(payment, notes);
        const amountPaise = payment?.amount ?? order?.amount_paid ?? order?.amount;
        return activateFromPayment({
          tenantId: notes.tenantId,
          invoiceId: notes.invoiceId,
          providerRef: payment?.id || null,
          providerOrderRef,
          currency: payment?.currency || order?.currency,
          amountMinor: amountPaise != null ? Number(amountPaise) : undefined,
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

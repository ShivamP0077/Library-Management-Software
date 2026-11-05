// PayPal provider — Orders API checkout + webhook signature verify.
import { SoftwareInvoice, newInvoiceId, markInvoicePaid } from './invoices.js';
import { Library } from '../models.js';
import { addInterval } from '../billing.js';

function baseUrl(mode) {
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function paypalToken({ clientId, clientSecret, mode }) {
  const res = await fetch(`${baseUrl(mode)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error_description || 'PayPal auth failed'), { status: 502, code: 'paypal_auth' });
  return data.access_token;
}

async function ppFetch(path, cfg, { method = 'GET', body, token } = {}) {
  const access = token || await paypalToken(cfg);
  const res = await fetch(`${baseUrl(cfg.mode)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.details?.[0]?.description || `PayPal HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status >= 500 ? 502 : 400, code: 'paypal_error', raw: data });
  }
  return data;
}

export function createPaypalProvider({ clientId, clientSecret, webhookId = '', mode = 'sandbox' }) {
  const cfg = { clientId, clientSecret, webhookId, mode };

  return {
    name: 'paypal',
    mode,

    async createCheckout({ library, plan, interval, amount, returnUrl, cancelUrl }) {
      const currency = 'USD'; // PayPal commonly USD; Super Admin can note INR via Razorpay
      const value = Number(amount).toFixed(2);
      const invoiceId = newInvoiceId();
      await SoftwareInvoice.create({
        invoiceId,
        tenantId: library.libraryId,
        planId: plan?.planId || library.planId,
        interval: interval || 'month',
        amount: Number(amount),
        currency,
        status: 'open',
        provider: 'paypal',
        dueAt: new Date(),
      });
      const order = await ppFetch('/v2/checkout/orders', cfg, {
        method: 'POST',
        body: {
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: invoiceId,
            custom_id: `${library.libraryId}|${invoiceId}|${interval || 'month'}|${plan?.planId || ''}`,
            description: `Library OS — ${plan?.name || library.planId || 'subscription'}`,
            amount: { currency_code: currency, value },
          }],
          application_context: {
            brand_name: 'Library OS',
            user_action: 'PAY_NOW',
            return_url: returnUrl || 'https://example.com/pay/return',
            cancel_url: cancelUrl || returnUrl || 'https://example.com/pay/cancel',
          },
        },
      });
      const approve = (order.links || []).find(l => l.rel === 'approve')?.href;
      await SoftwareInvoice.updateOne({ invoiceId }, { $set: { providerRef: order.id } });
      return { url: approve, reference: order.id, invoiceId, provider: 'paypal' };
    },

    async cancel() { /* PayPal order cancel is no-op for one-shot; subscriptions handled later */ },

    async verifyWebhook(rawBody, headers) {
      if (!cfg.webhookId) return false;
      const token = await paypalToken(cfg);
      const transmissionId = headers['paypal-transmission-id'] || headers['Paypal-Transmission-Id'];
      const timestamp = headers['paypal-transmission-time'] || headers['Paypal-Transmission-Time'];
      const certUrl = headers['paypal-cert-url'] || headers['Paypal-Cert-Url'];
      const authAlgo = headers['paypal-auth-algo'] || headers['Paypal-Auth-Algo'];
      const transmissionSig = headers['paypal-transmission-sig'] || headers['Paypal-Transmission-Sig'];
      let webhookEvent;
      try { webhookEvent = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody; } catch { return false; }
      try {
        const result = await ppFetch('/v1/notifications/verify-webhook-signature', cfg, {
          method: 'POST',
          token,
          body: {
            transmission_id: transmissionId,
            transmission_time: timestamp,
            cert_url: certUrl,
            auth_algo: authAlgo,
            transmission_sig: transmissionSig,
            webhook_id: cfg.webhookId,
            webhook_event: webhookEvent,
          },
        });
        return result.verification_status === 'SUCCESS';
      } catch {
        return false;
      }
    },

    async handleWebhook(event) {
      const type = event?.event_type;
      if (type === 'CHECKOUT.ORDER.APPROVED' || type === 'PAYMENT.CAPTURE.COMPLETED') {
        const resource = event.resource || {};
        // Capture if only approved
        let capture = resource;
        if (type === 'CHECKOUT.ORDER.APPROVED' && resource.id) {
          capture = await ppFetch(`/v2/checkout/orders/${resource.id}/capture`, cfg, { method: 'POST', body: {} });
        }
        const unit = capture.purchase_units?.[0] || resource.purchase_units?.[0] || {};
        const custom = String(unit.custom_id || resource.custom_id || '');
        const [tenantId, invoiceId, interval, planId] = custom.split('|');
        const amount = Number(unit.amount?.value || resource.amount?.value || 0);
        return activatePaypal({ tenantId, invoiceId, providerRef: capture.id || resource.id, amount, interval, planId, raw: event });
      }
      if (type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
        const custom = String(event.resource?.custom_id || '');
        const tenantId = custom.split('|')[0];
        if (tenantId) {
          await Library.updateOne({ libraryId: tenantId }, { $set: { 'subscription.status': 'past_due' } });
          return { ok: true, status: 'past_due', tenantId };
        }
      }
      return { ok: true, ignored: type };
    },
  };
}

async function activatePaypal({ tenantId, invoiceId, providerRef, amount, interval, planId, raw }) {
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
    provider: 'paypal',
    lastPaymentAt: now,
    lastPaymentRef: providerRef || null,
  };
  const set = { subscription: next };
  if (planId) set.planId = planId;
  await Library.updateOne({ libraryId: tenantId }, { $set: set });
  if (invoiceId) await markInvoicePaid(invoiceId, { providerRef, paidAt: now, raw });
  return { ok: true, tenantId, status: 'active', periodEnd };
}

// PayPal provider — Orders API checkout + webhook signature verify.
import { SoftwareInvoice, newInvoiceId, findUsableOpenInvoice } from './invoices.js';
import { settleInvoice } from './settlement.js';
import { Library } from '../models.js';

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
    // Reachability probe: this is not a payment, capture or charge.
    async testConnection() {
      await paypalToken(cfg);
      return true;
    },
    mode,

    async createCheckout({ library, plan, interval, amount, returnUrl, cancelUrl, invoiceId: requestedInvoiceId }) {
      // A brand-new invoice often has no provider yet. A missing, void, paid,
      // or other-library id is ignored and a new checkout is started.
      const existing = await findUsableOpenInvoice({ invoiceId: requestedInvoiceId, tenantId: library.libraryId, provider: 'paypal' });
      const invoiceId = existing ? existing.invoiceId : newInvoiceId();
      const currency = existing?.currency || 'USD';
      const gatewayMinor = Math.round(Number(amount) * 100);
      const value = (gatewayMinor / 100).toFixed(2);
      if (existing) {
        await SoftwareInvoice.updateOne({ invoiceId }, {
          $set: { amount: gatewayMinor / 100, gatewayMinor, provider: 'paypal', dueAt: new Date(),
            ...(existing.totalMinor < gatewayMinor ? { totalMinor: gatewayMinor } : {}) },
        });
      } else {
        await SoftwareInvoice.create({
          invoiceId,
          tenantId: library.libraryId,
          planId: plan?.planId || library.planId,
          interval: interval || 'month',
          amount: gatewayMinor / 100,
          totalMinor: gatewayMinor,
          baseMinor: gatewayMinor,
          taxableMinor: gatewayMinor,
          gatewayMinor,
          currency,
          status: 'open',
          provider: 'paypal',
          dueAt: new Date(),
        });
      }
      const order = await ppFetch('/v2/checkout/orders', cfg, {
        method: 'POST',
        body: {
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: invoiceId,
            custom_id: `${library.libraryId}|${invoiceId}|${interval || 'month'}|${plan?.planId || ''}`,
            description: `My Library OS — ${plan?.name || library.planId || 'subscription'}`,
            amount: { currency_code: currency, value },
          }],
          application_context: {
            brand_name: 'My Library OS',
            user_action: 'PAY_NOW',
            return_url: returnUrl || 'https://example.com/pay/return',
            cancel_url: cancelUrl || returnUrl || 'https://example.com/pay/cancel',
          },
        },
      });
      const approve = (order.links || []).find(l => l.rel === 'approve')?.href;
      await SoftwareInvoice.updateOne({ invoiceId }, { $set: { providerRef: order.id, providerOrderRef: order.id } });
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
        let resource = event.resource || {};
        const relatedOrder = (r) => r?.supplementary_data?.related_ids?.order_id
          || r?.links?.find?.(l => l.rel === 'up')?.href?.split('/').pop() || null;
        // orderId is declared once, before any use (previous TDZ bug in the capture flow).
        let orderId = null;
        let capture = null;
        let unit = {};
        if (type === 'CHECKOUT.ORDER.APPROVED' && resource.id) {
          orderId = resource.id;
          // Capture through PayPal; the capture object (not the order) is the payment evidence.
          const order = await ppFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, cfg, { method: 'POST', body: {} });
          if (order?.id && order.id !== orderId) return { ok: false, error: 'order_reference_mismatch' };
          unit = order?.purchase_units?.[0] || {};
          capture = unit.payments?.captures?.[0] || null;
          if (!capture) return { ok: false, error: 'capture_missing' };
        } else if (type === 'PAYMENT.CAPTURE.COMPLETED' && resource.id) {
          orderId = relatedOrder(resource);
          if (!orderId) return { ok: false, error: 'order_reference_missing' };
          // Fetch the capture instead of trusting arbitrary callback fields.
          capture = await ppFetch(`/v2/payments/captures/${encodeURIComponent(resource.id)}`, cfg);
          const fetchedOrder = relatedOrder(capture);
          if (fetchedOrder && fetchedOrder !== orderId) return { ok: false, error: 'order_reference_mismatch' };
        } else {
          return { ok: false, error: 'resource_missing' };
        }
        const custom = String(capture?.custom_id || unit.custom_id || '');
        const [tenantId, customInvoiceId, interval, planId] = custom.split('|');
        const invoiceId = customInvoiceId || unit.reference_id || null;
        if (!invoiceId) return { ok: false, error: 'invoice_required' };
        const saved = await SoftwareInvoice.findOne({ invoiceId }).select('providerRef providerOrderRef tenantId').lean();
        if (!saved) return { ok: false, error: 'invoice_not_found' };
        if (tenantId && saved.tenantId !== tenantId) return { ok: false, error: 'tenant_invoice_mismatch' };
        const expectedOrder = saved.providerOrderRef || saved.providerRef;
        if (!expectedOrder || expectedOrder !== orderId) return { ok: false, error: 'order_reference_mismatch' };
        // Pending/declined captures never activate anything.
        if (!capture?.id || capture.status !== 'COMPLETED') return { ok: false, error: 'payment_not_completed', status: capture?.status || null };
        const amountValue = capture.amount?.value;
        const currencyCode = capture.amount?.currency_code;
        if (amountValue == null || !currencyCode) return { ok: false, error: 'amount_unverified' };
        resource = capture;
        return activatePaypal({
          tenantId, invoiceId, providerRef: capture.id, providerOrderRef: orderId,
          amountMinor: Math.round(Number(amountValue) * 100),
          currency: currencyCode,
          interval, planId, raw: event,
        });
      }
      if (type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
        const subId = event.resource?.id || event.resource?.billing_agreement_id;
        const lib = subId ? await Library.findOne({ 'subscription.providerSubId': subId }) : null;
        if (lib) {
          await Library.updateOne({ libraryId: lib.libraryId }, { $set: { 'subscription.status': 'past_due' } });
          return { ok: true, status: 'past_due', tenantId: lib.libraryId };
        }
      }
      return { ok: true, ignored: type };
    }
  };
}

async function activatePaypal({ tenantId, invoiceId, providerRef, providerOrderRef, amountMinor, currency, interval, planId, raw }) {
  // Never create an invoice from callback fields. Require the server-created invoice.
  if (!invoiceId) return { ok: false, error: 'invoice_required' };
  const invoice = await SoftwareInvoice.findOne({ invoiceId }).lean();
  if (!invoice) return { ok: false, error: 'invoice_not_found' };
  if (tenantId && invoice.tenantId !== tenantId) return { ok: false, error: 'tenant_invoice_mismatch' };
  const settled = await settleInvoice(invoiceId, {
    providerRef, providerOrderRef, raw, source: 'paypal', provider: 'paypal',
    gatewayMinor: amountMinor, currency,
  });
  if (!settled.ok) {
    return { ok: false, error: settled.error || 'settlement_failed', tenantId: invoice.tenantId, invoiceId };
  }
  return { ok: true, tenantId: invoice.tenantId, invoiceId, status: invoice.kind === 'topup' ? 'paid' : 'active', periodEnd: settled.invoice?.periodEnd, already: settled.already, requiresRecovery: settled.requiresRecovery };
}

// Issue #19: public payment webhooks (signature verified; no auth cookie).
import express from 'express';
import { paymentProvider } from './billing.js';
import { buildProviderFromConfig, getPaymentConfig } from './paymentConfig.js';
import crypto from 'crypto';
import { claimPaymentEvent, finishPaymentEvent, providerEventId } from './payments/events.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Mount with express.raw for these paths so HMAC can use the exact bytes.
 * If JSON was already parsed, we re-serialize (tests); production should use raw.
 */
export function createPaymentsWebhookRouter() {
  const r = express.Router();

  r.post('/razorpay', wrap(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8')
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    const provider = (await buildProviderFromConfig(await getPaymentConfig())) || paymentProvider();
    if (!provider || provider.name !== 'razorpay') {
      return res.status(503).json({ error: 'Razorpay is not the active provider' });
    }
    if (!provider.verifyWebhook(raw, req.headers)) {
      return res.status(401).json({ error: 'Invalid signature', code: 'bad_signature' });
    }
    let event;
    try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    const eventId = providerEventId('razorpay', event, raw, req.headers);
    const claimed = await claimPaymentEvent({
      provider: 'razorpay', eventId, eventType: event?.event || null,
      payloadHash: crypto.createHash('sha256').update(raw).digest('hex'),
    });
    if (!claimed.claimed) {
      return res.json({ received: true, duplicate: true, eventId, status: claimed.event?.status || 'processing' });
    }
    try {
      const result = await provider.handleWebhook(event);
      await finishPaymentEvent(claimed.event._id, {
        status: result?.ok === false ? 'rejected' : 'processed',
        error: result?.ok === false ? (result.error || 'rejected') : null,
        invoiceId: result?.invoiceId || result?.invoice?.invoiceId || null,
        tenantId: result?.tenantId || null,
      });
      res.json({ received: true, eventId, ...result });
    } catch (e) {
      await finishPaymentEvent(claimed.event._id, { status: 'failed', error: e.message });
      throw e;
    }
  }));

  r.post('/paypal', wrap(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8')
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    const provider = (await buildProviderFromConfig(await getPaymentConfig())) || paymentProvider();
    if (!provider || provider.name !== 'paypal') {
      return res.status(503).json({ error: 'PayPal is not the active provider' });
    }
    const ok = await provider.verifyWebhook(raw, req.headers);
    if (!ok) return res.status(401).json({ error: 'Invalid signature', code: 'bad_signature' });
    let event;
    try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    const eventId = providerEventId('paypal', event, raw, req.headers);
    const claimed = await claimPaymentEvent({
      provider: 'paypal', eventId, eventType: event?.event_type || null,
      payloadHash: crypto.createHash('sha256').update(raw).digest('hex'),
    });
    if (!claimed.claimed) {
      return res.json({ received: true, duplicate: true, eventId, status: claimed.event?.status || 'processing' });
    }
    try {
      const result = await provider.handleWebhook(event);
      await finishPaymentEvent(claimed.event._id, {
        status: result?.ok === false ? 'rejected' : 'processed',
        error: result?.ok === false ? (result.error || 'rejected') : null,
        invoiceId: result?.invoiceId || result?.invoice?.invoiceId || null,
        tenantId: result?.tenantId || null,
      });
      res.json({ received: true, eventId, ...result });
    } catch (e) {
      await finishPaymentEvent(claimed.event._id, { status: 'failed', error: e.message });
      throw e;
    }
  }));

  return r;
}

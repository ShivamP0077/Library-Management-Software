// Stable provider-event idempotency. Provider event IDs win; missing IDs fall back to
// a scoped content hash plus signed delivery headers where available.
import crypto from 'crypto';
import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  provider: { type: String, required: true, index: true },
  eventId: { type: String, required: true },
  eventType: String,
  payloadHash: { type: String, required: true },
  status: { type: String, enum: ['processing', 'processed', 'failed', 'rejected'], default: 'processing', index: true },
  attempts: { type: Number, default: 1 },
  invoiceId: String,
  tenantId: String,
  error: String,
  receivedAt: { type: Date, default: Date.now },
  processedAt: Date,
}, { timestamps: true });
schema.index({ provider: 1, eventId: 1 }, { unique: true });
schema.index({ provider: 1, payloadHash: 1 });
export const PaymentEvent = mongoose.models.PaymentEvent || mongoose.model('PaymentEvent', schema);

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function providerEventId(provider, event, raw, headers = {}) {
  const h = (k) => headers[k] || headers[String(k).toLowerCase()];
  const fromHeader = h('x-razorpay-event-id') || h('paypal-transmission-id') || h('x-webhook-id');
  const fromEvent = event?.id || event?.event_id || null;
  if (fromHeader) return String(fromHeader);
  if (fromEvent) return String(fromEvent);
  // Fallback includes the signed delivery context, not just the financial payload.
  const time = h('paypal-transmission-time') || h('x-razorpay-event-id') || '';
  const sig = h('x-razorpay-signature') || h('paypal-transmission-sig') || '';
  return `payload_${hash(`${provider}:${time}:${sig}:${raw}`)}`;
}

export async function claimPaymentEvent({ provider, eventId, eventType, payloadHash, invoiceId, tenantId }) {
  try {
    const event = await PaymentEvent.create({ provider, eventId, eventType, payloadHash, invoiceId, tenantId, status: 'processing' });
    return { claimed: true, event };
  } catch (e) {
    if (e?.code !== 11000) throw e;
  }
  const existing = await PaymentEvent.findOne({ provider, eventId });
  if (!existing) return { claimed: false, event: null };
  if (existing.status === 'failed') {
    const retried = await PaymentEvent.findOneAndUpdate(
      { _id: existing._id, status: 'failed' },
      { $set: { status: 'processing', error: null }, $inc: { attempts: 1 } },
      { new: true },
    );
    if (retried) return { claimed: true, event: retried, retry: true };
  }
  return { claimed: false, event: existing };
}

export async function finishPaymentEvent(eventId, { status, error, invoiceId, tenantId } = {}) {
  await PaymentEvent.updateOne({ _id: eventId }, {
    $set: {
      status: status || 'processed',
      ...(error ? { error: String(error).slice(0, 500) } : {}),
      ...(invoiceId ? { invoiceId } : {}),
      ...(tenantId ? { tenantId } : {}),
      processedAt: new Date(),
    },
  });
}

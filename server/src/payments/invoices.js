// Software subscription invoices (Issue #19). Separate from student fee payments.
import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  invoiceId: { type: String, required: true, unique: true, index: true },
  tenantId: { type: String, required: true, index: true },
  kind: { type: String, enum: ['subscription', 'upgrade', 'topup'], default: 'subscription', index: true },
  planId: String,
  interval: String,
  amount: { type: Number, required: true }, // total charged (major units, legacy view)
  totalMinor: { type: Number, default: 0 },
  baseMinor: { type: Number, default: 0 },
  discountMinor: { type: Number, default: 0 },
  taxableMinor: { type: Number, default: 0 },
  taxMinor: { type: Number, default: 0 },
  taxIncluded: { type: Boolean, default: false },
  taxRate: { type: Number, default: null },
  walletMinor: { type: Number, default: 0 },
  gatewayMinor: { type: Number, default: 0 },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['open', 'settling', 'paid', 'void', 'past_due', 'requires_recovery'], default: 'open', index: true },
  provider: String,
  providerRef: String,
  providerOrderRef: String,
  paymentReceivedRef: String, // legacy: checkout reference, replaced by the payment id once paid
  providerOrderRef: String, // provider order / payment-link / subscription id
  providerPaymentRef: String, // provider payment / capture id (evidence of money received)
  paidAt: Date,
  receiptNo: { type: String },
  holdId: String,
  topupId: String,
  offerId: String,
  idempotencyKey: { type: String },
  failureReason: String,
  failureHistory: { type: [{ at: Date, reason: String, providerRef: String, source: String, gatewayMinor: Number, currency: String }], default: [] },
  paidEvidence: { type: mongoose.Schema.Types.Mixed, default: null },
  recoveredAt: Date,
  settlementStartedAt: Date,
  receiptDelivery: {
    // sent = accepted by a real transport; logged = synthetic capture (no transport configured); failed = transport error.
    status: { type: String, enum: ['pending', 'sending', 'sent', 'logged', 'failed', 'skipped'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: Date,
    sentAt: Date,
    channel: String,
    reason: String,
    history: { type: [{ attemptId: String, at: Date, finishedAt: Date, channel: String, target: String, status: String, reason: String, trigger: String, actor: String, attachment: Boolean }], default: [] },
  },
  providerEventId: String,
  changeType: String,
  historyType: { type: String, default: null }, // trial|new|renew|early_renew|upgrade (trial is not an invoice)
  dueAt: Date,
  periodStart: Date,
  periodEnd: Date,
  raw: mongoose.Schema.Types.Mixed,
  // Issue #16: when a tenant is deleted the invoice survives only as minimal,
  // pseudonymised financial metadata. raw/providerRef are removed.
  retentionSubject: String,
  redactedAt: Date,
}, { timestamps: true });

export const SoftwareInvoice = mongoose.models.SoftwareInvoice || mongoose.model('SoftwareInvoice', schema);

export function newInvoiceId() {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * An open invoice for this library can continue checkout when its provider is
 * unset or already this provider. Missing, paid, void, or other-library ids
 * are not usable — callers start a new invoice instead of failing the owner.
 */
export async function findUsableOpenInvoice({ invoiceId, tenantId, provider }) {
  if (!invoiceId || !tenantId) return null;
  const row = await SoftwareInvoice.findOne({ invoiceId, tenantId }).exec();
  if (!row || row.status !== 'open') return null;
  if (row.provider && row.provider !== provider) return null;
  return row;
}

export function newReceiptNo() {
  return `RCPT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function listInvoices(tenantId, limit = 50) {
  return SoftwareInvoice.find({ tenantId }).sort({ createdAt: -1 }).limit(limit).lean();
}

export async function markInvoicePaid(invoiceId, { providerRef, paidAt = new Date(), raw } = {}) {
  return SoftwareInvoice.findOneAndUpdate(
    { invoiceId },
    { $set: { status: 'paid', paidAt, providerRef, ...(raw ? { raw } : {}) } },
    { new: true },
  );
}

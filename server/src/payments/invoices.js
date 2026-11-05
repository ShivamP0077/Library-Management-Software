// Software subscription invoices (Issue #19). Separate from student fee payments.
import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  invoiceId: { type: String, required: true, unique: true, index: true },
  tenantId: { type: String, required: true, index: true },
  planId: String,
  interval: String,
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['open', 'paid', 'void', 'past_due'], default: 'open', index: true },
  provider: String,
  providerRef: String,
  paidAt: Date,
  dueAt: Date,
  periodStart: Date,
  periodEnd: Date,
  raw: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

export const SoftwareInvoice = mongoose.models.SoftwareInvoice || mongoose.model('SoftwareInvoice', schema);

export function newInvoiceId() {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

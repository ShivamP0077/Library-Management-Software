// Issue #11: voided payments stay in history as "Voided" and are excluded from totals.
// Admission voids also free the seat (see admissionVoid.js). Renewal voids only mark records.

/** True when a payment / renewal row should be ignored in income totals. */
export const isVoidedPayment = (p) => !!(p && (p.voided === true || p.status === 'Voided'));

/** Sum net totals, skipping voided rows (and optionally applying an extra filter). */
export function sumActivePayments(payments, pick = (p) => Number(p.netTotal || p.amount || 0)) {
  return (payments || []).reduce((sum, p) => (isVoidedPayment(p) ? sum : sum + pick(p)), 0);
}

/**
 * Mark a renewal (and its receipt) as voided without deleting anything.
 * Returns { updates, receiptNo } or null if the renewal is missing / already voided.
 * Does not change seat or plan — use buildAdmissionVoid for the first admission.
 */
export function buildRenewalVoid(student, renewalId, { today, staffName = 'Admin', reason = '' } = {}) {
  const list = student?.renewalHistory || [];
  const idx = list.findIndex(r => r.renewalId === renewalId);
  if (idx === -1 || list[idx].voided) return null;
  const rec = list[idx];
  const audit = {
    id: `VOID-${Date.now()}`,
    type: 'renewal_void',
    renewalId,
    receiptNo: rec.receiptNo,
    amount: rec.amountPaid ?? null,
    planName: rec.planName || '',
    reason,
    date: today,
    staffName,
  };
  return {
    receiptNo: rec.receiptNo,
    updates: {
      renewalHistory: list.map(r => r.renewalId === renewalId ? { ...r, voided: true, voidedAt: today, voidedBy: staffName } : r),
      paymentHistory: (student.paymentHistory || []).map(p => p.receiptNo === rec.receiptNo ? { ...p, voided: true, status: 'Voided' } : p),
      voidHistory: [audit, ...(student.voidHistory || [])],
    },
  };
}

/** Patch a payments[] entry to Voided (keeps the row). */
export const markPaymentVoided = (payment, { today, staffName } = {}) => payment ? {
  ...payment,
  voided: true,
  status: 'Voided',
  voidedAt: today || payment.voidedAt || null,
  voidedBy: staffName || payment.voidedBy || null,
} : payment;

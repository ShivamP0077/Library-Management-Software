/**
 * Issue #12: receipt view-model helpers.
 * Amounts/dates are read from the actual payment/renewal records; nothing is
 * invented. A failed/voided/unpaid receipt is never presented as settled.
 */

const str = (v) => (v == null ? '' : String(v).trim());
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const money = (v) => `₹${num(v).toLocaleString('en-IN')}`;

/** Normalise the many historical status spellings into paid/partial/unpaid/void/failed. */
export function receiptState(receipt, { payment, renewal } = {}) {
  const raw = str(receipt?.paymentStatus || receipt?.status || payment?.status || renewal?.status || '').toLowerCase();
  const voided = receipt?.voided === true || payment?.voided === true || renewal?.voided === true || raw === 'void' || raw === 'voided';
  if (voided) return { code: 'void', label: 'VOID', settled: false, tone: 'void' };
  if (raw.includes('fail') || raw === 'error') return { code: 'failed', label: 'FAILED · NOT PAID', settled: false, tone: 'failed' };
  if (raw.includes('partial')) return { code: 'partial', label: 'PARTIAL PAYMENT', settled: false, tone: 'partial' };
  if (raw.includes('unpaid') || raw.includes('pending') || raw.includes('due')) return { code: 'unpaid', label: 'UNPAID', settled: false, tone: 'unpaid' };

  const net = num(receipt?.netTotal ?? receipt?.amount ?? payment?.netTotal ?? payment?.amount);
  const paid = receipt?.paidAmount != null ? num(receipt.paidAmount)
    : payment?.paidAmount != null ? num(payment.paidAmount)
      : receipt?.amountPaid != null ? num(receipt.amountPaid)
        : null;
  if (paid != null && net > 0 && paid < net) return { code: 'partial', label: 'PARTIAL PAYMENT', settled: false, tone: 'partial' };
  if (raw === 'paid' || raw === 'settled' || raw === 'success' || raw === 'succeeded' || raw === 'completed') {
    return { code: 'paid', label: 'PAID', settled: true, tone: 'paid' };
  }
  // A saved admission/renewal payment row with no explicit failure is paid.
  if (payment || renewal || receipt) return { code: 'paid', label: 'PAID', settled: true, tone: 'paid' };
  return { code: 'unpaid', label: 'UNPAID', settled: false, tone: 'unpaid' };
}

/** Payment period + next due date, cross-checked with the saved student/renewal. */
export function receiptPeriod(receipt, { student, renewal } = {}) {
  const start = str(receipt?.periodStart || receipt?.startDate || renewal?.startDate || student?.startDate);
  const end = str(receipt?.periodEnd || receipt?.endDate || renewal?.endDate || student?.expiryDate || student?.endDate);
  const nextDue = str(receipt?.nextDueDate || receipt?.nextDue || receipt?.dueDate || end);
  return { start, end, nextDue };
}

/** Amount breakdown using the same fields the billing engine stores. */
export function receiptAmounts(receipt) {
  const base = num(receipt?.amount ?? receipt?.basePrice ?? receipt?.netTotal);
  const discount = num(receipt?.discount);
  const fine = num(receipt?.fine ?? receipt?.otherCharges);
  const netTotal = receipt?.netTotal != null ? num(receipt.netTotal) : base - discount + fine;
  return { base, discount, fine, netTotal };
}

export function receiptOperator(receipt) {
  return str(receipt?.staffName || receipt?.operatorName || 'Admin');
}

/** The complete label set used by the A5 receipt. */
export function receiptView(receipt, { student, renewal, payment, branch, settings = {} } = {}) {
  const state = receiptState(receipt, { payment, renewal });
  const period = receiptPeriod(receipt, { student, renewal });
  const amounts = receiptAmounts(receipt);
  return {
    state,
    period,
    amounts,
    operator: receiptOperator(receipt),
    studentName: str(receipt?.studentName || student?.name),
    studentId: str(receipt?.studentId || student?.id),
    phone: str(receipt?.phone || student?.phone),
    section: str(receipt?.sectionName || receipt?.section || branch?.sectionName),
    branchName: str(receipt?.branchName || branch?.name || settings.name || 'Main Branch'),
    planName: str(receipt?.planName),
    seatNo: str(receipt?.seatNo || receipt?.seatName || student?.seatNo),
    shift: str(receipt?.shift || student?.shift),
    method: str(receipt?.method || receipt?.paymentMethod),
    libraryName: str(settings?.name),
    libraryAddress: str(branch?.address || settings?.address),
    libraryPhone: str(settings?.phone),
    libraryTaxId: str(settings?.taxId),
  };
}

// Issue #11: voiding the first admission cancels the plan and frees the seat.
// The voided record is kept (marked voided) and an audit entry is added.
// Refunds are recorded separately (Cancel Admission / refund flow), never here.

const dayBefore = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** True when this renewalId is the student's initial admission and nothing newer is still active. */
export function isAdmissionVoid(student, renewalId) {
  const list = student?.renewalHistory || [];
  const idx = list.findIndex(r => r.renewalId === renewalId);
  if (idx === -1 || list[idx].voided) return false;
  const isOldest = idx === list.length - 1;
  const newerActive = list.slice(0, idx).some(r => !r.voided);
  return isOldest && !newerActive;
}

/** Student updates for an admission void. Returns null if it is not an admission void. */
export function buildAdmissionVoid(student, renewalId, { today, staffName = 'Admin', reason = '' } = {}) {
  if (!isAdmissionVoid(student, renewalId)) return null;
  const rec = student.renewalHistory.find(r => r.renewalId === renewalId);
  const start = rec.startDate || student.startDate || student.joinedDate || today;
  const audit = {
    id: `VOID-${Date.now()}`,
    type: 'admission_void',
    renewalId,
    receiptNo: rec.receiptNo,
    amount: rec.amountPaid ?? null,
    planName: rec.planName || student.planName || '',
    previousSeat: student.seatNo || 'None',
    previousExpiry: student.expiryDate || null,
    reason,
    date: today,
    staffName,
  };
  return {
    receiptNo: rec.receiptNo,
    updates: {
      renewalHistory: student.renewalHistory.map(r => r.renewalId === renewalId ? { ...r, voided: true, voidedAt: today, voidedBy: staffName } : r),
      paymentHistory: (student.paymentHistory || []).map(p => p.receiptNo === rec.receiptNo ? { ...p, voided: true } : p),
      seatNo: 'None',
      status: 'Expired',
      expiryDate: dayBefore(start) < start ? dayBefore(start) : start,
      planVoided: true,
      voidHistory: [audit, ...(student.voidHistory || [])],
    },
  };
}

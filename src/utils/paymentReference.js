/**
 * Shared by the desk UI and the API.
 * Cash does not need a reference. Every other collection mode does
 * (UPI, card, bank / net banking, cheque, and anything added later).
 * Split is only a container: each non-cash part carries its own reference.
 * Refunds are not collections.
 */

export const REFERENCE_MAX = 64;
export const REFERENCE_REQUIRED_MSG = 'Reference / UTR number is required for non-cash payments.';
export const REFERENCE_LENGTH_MSG = 'Reference / UTR number must be 64 characters or fewer.';

export const COLLECTION_METHODS = ['UPI', 'Cash', 'Card', 'Bank Transfer', 'Net Banking', 'Cheque'];

export function isCashMode(mode) {
  return String(mode ?? '').trim().toLowerCase() === 'cash';
}

export function requiresReference(mode) {
  const m = String(mode ?? '').trim().toLowerCase();
  if (!m || m === 'cash' || m === 'split' || m === 'refund') return false;
  return true;
}

export function trimReference(value) {
  return String(value ?? '').trim();
}

/** '' when allowed. Length is checked even when the reference is optional. */
export function referenceError(mode, value, { required = true } = {}) {
  const ref = trimReference(value);
  if (ref.length > REFERENCE_MAX) return REFERENCE_LENGTH_MSG;
  if (required && requiresReference(mode) && !ref) return REFERENCE_REQUIRED_MSG;
  return '';
}

function paymentMode(payment) {
  return payment?.method || payment?.mode || payment?.paymentMethod || '';
}

/**
 * Trim references on the payment (and each split row).
 * When required is true, a new non-cash payment or split part must have one.
 * Returns an error message, or '' after a successful trim.
 */
export function normalizePaymentReferences(payment, { required = false } = {}) {
  if (!payment || typeof payment !== 'object') return '';
  const rows = Array.isArray(payment.breakdown) && (payment.method === 'Split' || payment.breakdown.length)
    ? payment.breakdown
    : null;
  if (rows) {
    payment.breakdown = rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const ref = trimReference(row.referenceNo);
      const err = referenceError(row.method, ref, { required });
      if (err) {
        payment.breakdown = rows;
        throw Object.assign(new Error(err), { referenceError: err });
      }
      const next = { ...row };
      if (ref && !isCashMode(row.method)) next.referenceNo = ref;
      else delete next.referenceNo;
      return next;
    });
  }
  const mode = rows ? '' : paymentMode(payment);
  if (payment.referenceNo != null || (required && requiresReference(mode))) {
    const ref = trimReference(payment.referenceNo);
    const err = referenceError(mode, ref, { required: required && !rows });
    if (err) throw Object.assign(new Error(err), { referenceError: err });
    // A cash payment never keeps a stale reference (e.g. typed before switching from UPI to Cash).
    if (ref && !isCashMode(mode)) payment.referenceNo = ref;
    else delete payment.referenceNo;
  }
  return '';
}

/** Same rules, without throwing. Used by the forms before they save. */
export function paymentReferenceError(payment, { required = true } = {}) {
  if (!payment) return '';
  const copy = {
    ...payment,
    ...(Array.isArray(payment.breakdown) ? { breakdown: payment.breakdown.map(row => ({ ...row })) } : {}),
  };
  try {
    normalizePaymentReferences(copy, { required });
    return '';
  } catch (e) {
    return e.referenceError || e.message || REFERENCE_REQUIRED_MSG;
  }
}

/** Drop blank references and trim the ones we keep. Does not require a value. */
export function stampPaymentReference(payment) {
  if (!payment || typeof payment !== 'object') return payment;
  const copy = { ...payment, ...(Array.isArray(payment.breakdown) ? { breakdown: payment.breakdown.map(r => ({ ...r })) } : {}) };
  try { normalizePaymentReferences(copy, { required: false }); } catch { /* length problems are caught by the form / API */ }
  return copy;
}

/** "Ref: XXXX" for receipts and WhatsApp. Empty when nothing was stored. */
export function receiptReferenceText(payment) {
  if (!payment) return '';
  const parts = [];
  const rows = Array.isArray(payment.breakdown) ? payment.breakdown : [];
  const rowRefs = rows.filter(r => trimReference(r?.referenceNo));
  if (rowRefs.length) {
    for (const row of rowRefs) {
      const ref = trimReference(row.referenceNo);
      parts.push(row.method ? `${row.method} ${ref}` : ref);
    }
  } else {
    const ref = trimReference(payment.referenceNo);
    if (ref) parts.push(ref);
  }
  return parts.length ? `Ref: ${parts.join(', ')}` : '';
}

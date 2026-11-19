/** Payment proof images are optional references, never embedded file bytes. */

export const PAYMENT_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PAYMENT_PROOFS = 8;
export const PAYMENT_PROOF_MODES = ['OFF', 'OPTIONAL', 'REQUIRED'];
export const DEFAULT_PAYMENT_PROOF_MODE = 'OPTIONAL';
export const PAYMENT_PROOF_REQUIRED_MESSAGE = 'Attach at least one payment proof photo before saving this payment.';

const IMAGE = /^image\/(jpeg|png|webp)$/i;

/** Keep storage keys only. Drops data URLs, PDFs, and anything that is not an image. */
export function paymentProofRefs(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const storageKey = String(item.storageKey || item.key || '').trim().slice(0, 200);
    const fileType = String(item.fileType || '').toLowerCase().split(';')[0].trim();
    if (!storageKey || storageKey.startsWith('data:') || !IMAGE.test(fileType)) continue;
    const ref = {
      storageKey,
      fileName: String(item.fileName || item.name || 'proof').slice(0, 160),
      fileType,
    };
    const size = Number(item.fileSize || item.size || 0);
    if (Number.isFinite(size) && size > 0) ref.fileSize = size;
    out.push(ref);
    if (out.length >= MAX_PAYMENT_PROOFS) break;
  }
  return out;
}

export function sanitizePaymentProofs(list) {
  if (!Array.isArray(list)) return null;
  return paymentProofRefs(list);
}

/** Unknown or missing values default to Optional so existing libraries keep current behaviour. */
export function paymentProofModeOf(settings = {}) {
  const raw = String(settings?.paymentProofMode || '').trim().toUpperCase();
  return PAYMENT_PROOF_MODES.includes(raw) ? raw : DEFAULT_PAYMENT_PROOF_MODE;
}

export function paymentProofKeys(list) {
  return paymentProofRefs(list).map((item) => item.storageKey);
}

export function paymentProofsEqual(a, b) {
  return paymentProofKeys(a).join('\n') === paymentProofKeys(b).join('\n');
}

export function paymentProofsMissing(mode, proofs) {
  return paymentProofModeOf({ paymentProofMode: mode }) === 'REQUIRED' && paymentProofRefs(proofs).length === 0;
}

export function paymentProofModeChanged(prev = {}, next = {}) {
  return paymentProofModeOf(prev) !== paymentProofModeOf(next);
}

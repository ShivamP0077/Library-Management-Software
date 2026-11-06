// Shared identity normalisation for Issue #15 (email or mobile login, verified identities).
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const normalizeEmail = (v) => String(v || '').trim().toLowerCase();

/** Normalises a mobile number to digits without +, spaces or a leading 91/0. */
export function normalizeMobile(v) {
  let digits = String(v || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

export const isMobile = (v) => {
  const n = normalizeMobile(v);
  return n.length >= 8 && n.length <= 15;
};

export const maskEmail = (email) => String(email || '').replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.min(b.length, 6)) + c);
export const maskMobile = (mobile) => {
  const m = normalizeMobile(mobile);
  return m.length <= 4 ? '••••' : `${'•'.repeat(Math.max(0, m.length - 4))}${m.slice(-4)}`;
};
export const maskIdentifier = (identifier) => (String(identifier || '').includes('@') ? maskEmail(identifier) : maskMobile(identifier));

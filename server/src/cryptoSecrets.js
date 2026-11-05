// AES-256-GCM helpers for storing payment provider secrets at rest.
import crypto from 'crypto';

const keyFrom = (secret) => crypto.createHash('sha256').update(String(secret)).digest();

export function secretsKey() {
  const s = process.env.PAYMENT_SECRETS_KEY || process.env.JWT_SECRET || process.env.BACKUP_KEY;
  if (!s || String(s).length < 16) {
    // Dev/test fallback — never use in production without a real key.
    return keyFrom('dev-payment-secrets-key-change-me');
  }
  return keyFrom(s);
}

/** @returns {string} base64url "iv.tag.cipher" */
export function encryptSecret(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretsKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map(b => b.toString('base64url')).join('.');
}

export function decryptSecret(packed) {
  if (!packed) return '';
  const [ivB, tagB, encB] = String(packed).split('.');
  if (!ivB || !tagB || !encB) throw new Error('Corrupt encrypted secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretsKey(), Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64url')), decipher.final()]).toString('utf8');
}

export function maskSecret(s) {
  const v = String(s || '');
  if (v.length <= 4) return v ? '••••' : '';
  return `${'•'.repeat(Math.min(12, v.length - 4))}${v.slice(-4)}`;
}

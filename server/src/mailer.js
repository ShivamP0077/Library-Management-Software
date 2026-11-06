/**
 * Outgoing email via SMTP (nodemailer). Configure with
 * SMTP_HOST, SMTP_PORT, SMTP_SECURE ("true" for 465), SMTP_USER, SMTP_PASS, SMTP_FROM.
 * In tests (or when SMTP is not configured) messages are captured in memory, never logged.
 */
import nodemailer from 'nodemailer';

export const outbox = []; // test/dev capture only
let transport = null;

export const mailEnabled = () => Boolean(process.env.SMTP_HOST) && process.env.NODE_ENV !== 'test';

function getTransport() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

const cleanAttachments = (list) => (Array.isArray(list) ? list : [])
  .filter(a => a && a.filename && a.content != null)
  .map(a => ({ filename: String(a.filename), content: a.content, contentType: a.contentType || undefined }));

/** Returns true when handed to SMTP; false when captured (not configured / test). Throws on transport failure. */
export async function sendMail({ to, subject, text, html, attachments }) {
  const files = cleanAttachments(attachments);
  if (!mailEnabled()) {
    // Capture metadata only; attachment bytes and credentials are never logged.
    outbox.push({ to, subject, text, at: new Date(), attachments: files.map(f => ({ filename: f.filename, contentType: f.contentType, size: f.content?.length || 0 })) });
    if (outbox.length > 50) outbox.shift();
    return false;
  }
  await getTransport().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html, ...(files.length ? { attachments: files } : {}) });
  return true;
}

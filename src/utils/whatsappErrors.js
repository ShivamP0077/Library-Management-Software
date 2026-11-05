/** Issue #18: plain-language WhatsApp errors. Never shows raw HTML/CSS from a proxy page. */
export const isWakingError = (err) => err?.status === 429 || err?.status === 503 || err?.status === 502 || err?.status === 504;

const HTML_RE = /<\s*(!doctype|html|head|body|style|script|div|title)\b|\{[^}]*:[^}]*;[^}]*\}/i;

export function friendlyWhatsappError(err, fallback = 'Something went wrong with WhatsApp.') {
  const msg = String(err?.message || '').trim();
  if (err?.status === 403) return msg || 'You do not have permission to manage WhatsApp.';
  if (!msg || HTML_RE.test(msg) || /Unexpected token|JSON/i.test(msg)) {
    return isWakingError(err) ? 'WhatsApp service is starting up. Please try again in a minute.' : fallback;
  }
  return msg.slice(0, 200);
}

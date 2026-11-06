// Issue #15: configurable mobile delivery adapter. Never silently falls back to email.
// A provider is registered server-side (or injected by tests) and must implement:
//   name: string, send({ to, text }) -> boolean | { ok: true }
let provider = null;

export const setSmsProvider = (p) => { provider = p || null; };
export const smsProvider = () => provider;
export const smsConfigured = () => Boolean(provider);

export async function sendMobileMessage({ to, text }) {
  if (!provider) {
    console.warn('[sms] mobile provider is not configured; message was logged, not sent');
    return { sent: false, logged: true, reason: 'sms_not_configured' };
  }
  try {
    const result = await provider.send({ to: String(to), text: String(text) });
    if (result === false || result?.ok === false) {
      return { sent: false, logged: true, reason: result?.reason || 'provider_rejected' };
    }
    return { sent: true, logged: false, provider: provider.name || 'custom' };
  } catch (e) {
    console.error('[sms] delivery failed:', e.message);
    return { sent: false, logged: true, reason: e.message };
  }
}

import { OAuth2Client } from 'google-auth-library';

let client;
export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID);

/** Verifies a Google Identity Services ID token and returns { email, sub, name } for a verified email. */
export async function verifyGoogleIdToken(idToken) {
  if (!googleEnabled()) throw Object.assign(new Error('Google sign-in is not configured'), { status: 501 });
  client ||= new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID.split(',').map(s => s.trim()) });
    payload = ticket.getPayload();
  } catch {
    throw Object.assign(new Error('Invalid Google credential'), { status: 401 });
  }
  if (!payload?.email || payload.email_verified !== true) throw Object.assign(new Error('Google email is not verified'), { status: 401 });
  return { email: payload.email.toLowerCase(), sub: payload.sub, name: payload.name || '' };
}

import { OAuth2Client } from 'google-auth-library';

/** Reads the server-side Google OAuth configuration. */
export function googleConfig(env = process.env) {
  return {
    clientId: (env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (env.GOOGLE_CLIENT_SECRET || '').trim(),
    callbackUrl: (env.GOOGLE_CALLBACK_URL || '').trim(),
    frontendUrl: (env.FRONTEND_URL || '').trim().replace(/\/+$/, ''),
  };
}

/** Server-side Google sign-in requires all four settings. */
export const googleEnabled = (env = process.env) => {
  const { clientId, clientSecret, callbackUrl, frontendUrl } = googleConfig(env);
  return Boolean(clientId && clientSecret && callbackUrl && frontendUrl);
};

const defaultClientFactory = (config) => new OAuth2Client({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
  redirectUri: config.callbackUrl,
});

let clientFactory = defaultClientFactory;

/** Injectable client factory for tests. Pass nothing/null to restore the default. */
export function setGoogleClientFactory(fn) {
  clientFactory = typeof fn === 'function' ? fn : defaultClientFactory;
}

const getClient = () => clientFactory(googleConfig());

const payloadOf = (ticket) => (typeof ticket?.getPayload === 'function' ? ticket.getPayload() : ticket) || null;

const googleError = (code, message, cause) => Object.assign(new Error(message), { status: 401, code, cause });

/** Builds the Google authorization URL for the server-side authorization-code flow. */
export function buildAuthUrl({ state, codeChallenge }) {
  return getClient().generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    access_type: 'online',
    include_granted_scopes: true,
  });
}

/** Exchanges an authorization code (with PKCE verifier) for a verified Google identity. */
export async function exchangeCode({ code, codeVerifier }) {
  const { clientId } = googleConfig();
  let payload;
  try {
    const client = getClient();
    const result = await client.getToken({ code, codeVerifier });
    const tokens = result?.tokens || result || {};
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
    payload = payloadOf(ticket);
  } catch (err) {
    throw googleError('google_failed', 'Google sign-in failed', err);
  }
  if (!payload?.email || payload.email_verified !== true) {
    throw googleError('email_unverified', 'Google email is not verified');
  }
  return { email: payload.email.toLowerCase(), sub: payload.sub, name: payload.name || '' };
}

/** Verifies a Google Identity Services ID token and returns { email, sub, name } for a verified email. */
export async function verifyGoogleIdToken(idToken) {
  const { clientId } = googleConfig();
  if (!googleEnabled()) throw Object.assign(new Error('Google sign-in is not configured'), { status: 501 });
  let payload;
  try {
    const ticket = await getClient().verifyIdToken({
      idToken,
      audience: clientId.split(',').map(s => s.trim()),
    });
    payload = payloadOf(ticket);
  } catch {
    throw googleError('google_failed', 'Invalid Google credential');
  }
  if (!payload?.email || payload.email_verified !== true) {
    throw googleError('email_unverified', 'Google email is not verified');
  }
  return { email: payload.email.toLowerCase(), sub: payload.sub, name: payload.name || '' };
}

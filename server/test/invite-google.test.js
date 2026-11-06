// Issue #13: a staff member can accept an invite with Google (only for the invited email).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { setGoogleClientFactory } from '../src/google.js';
import { User } from '../src/models.js';

const COOKIE = 'lms_g_oauth';
const tokenFrom = (link) => link.split('#invite=')[1];
const client = (payload) => ({
  generateAuthUrl: (o) => `https://accounts.google.com/o/oauth2/v2/auth?state=${o.state}`,
  getToken: async () => ({ tokens: { id_token: 'x' } }),
  verifyIdToken: async () => ({ getPayload: () => payload }),
});

before(async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_CALLBACK_URL = 'http://localhost:5000/api/auth/google/callback';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  await setup('invite_google');
});
after(async () => { setGoogleClientFactory(null); await teardown(); });

async function googleJoin(invite, payload) {
  setGoogleClientFactory(() => client(payload));
  const start = await fetch(`${ctx.base}/api/auth/google/start${invite ? `?invite=${invite}` : ''}`, { redirect: 'manual' });
  const cookie = (start.headers.get('set-cookie') || '').split(';')[0];
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cb = await fetch(`${ctx.base}/api/auth/google/callback?code=c&state=${state}`, { redirect: 'manual', headers: { cookie } });
  return new URLSearchParams((cb.headers.get('location') || '').split('#')[1] || '');
}

const invite = async (email) => tokenFrom((await call('POST', '/api/invites', { token: ctx.tokens.a, body: { email, name: 'G Staff', staffId: 'ST-G' } })).body.link);
const g = (email, sub = 'sub-' + email) => ({ email, email_verified: true, sub, name: 'Google Name', aud: 'test-id' });

test('start keeps the invite token only inside the HttpOnly state cookie', async () => {
  const t = await invite('cookie@test.local');
  setGoogleClientFactory(() => client({}));
  const start = await fetch(`${ctx.base}/api/auth/google/start?invite=${t}`, { redirect: 'manual' });
  assert.ok(!start.headers.get('location').includes(t), 'token not sent to Google');
  const v = JSON.parse(Buffer.from(start.headers.get('set-cookie').split(';')[0].split('=')[1], 'base64url').toString());
  assert.equal(v.i, t);
  assert.match(start.headers.get('set-cookie'), /HttpOnly/i);
});

test('invited email joins with Google: right library, role and staff link; invite is single-use', async () => {
  const t = await invite('gjoin@test.local');
  const p = await googleJoin(t, g('gjoin@test.local'));
  assert.ok(p.get('google_token'), p.toString());
  const me = await call('GET', '/api/auth/me', { token: p.get('google_token') });
  assert.equal(me.status, 200);
  const u = await User.findOne({ email: 'gjoin@test.local' }).lean();
  assert.equal(u.tenantId, 'lib-a'); assert.equal(u.role, 'staff'); assert.equal(u.staffId, 'ST-G'); assert.equal(u.googleSub, 'sub-gjoin@test.local');
  assert.deepEqual(u.authProviders, ['google']);
  // staff of lib-a cannot invite or reach lib-b
  assert.equal((await call('POST', '/api/invites', { token: p.get('google_token'), body: { email: 'z@test.local' } })).status, 403);
  // reuse of the same invite by password is refused
  assert.equal((await call('POST', '/api/auth/invite/accept', { body: { token: t, password: 'Password-123' } })).status, 410);
  // the account can sign in again with Google (no invite needed)
  assert.ok((await googleJoin(null, g('gjoin@test.local'))).get('google_token'));
});

test('a different Google email cannot use the invite, and the invite stays usable', async () => {
  const t = await invite('owner-of-invite@test.local');
  const p = await googleJoin(t, g('someone.else@test.local'));
  assert.equal(p.get('google_error'), 'invite_email_mismatch');
  assert.equal(await User.exists({ email: 'someone.else@test.local' }), null);
  assert.equal((await call('POST', '/api/auth/invite/accept', { body: { token: t, password: 'Password-123' } })).status, 200);
});

test('Google without an invite still never creates accounts; bad invites fail cleanly', async () => {
  assert.equal((await googleJoin(null, g('nobody@test.local'))).get('google_error'), 'not_registered');
  assert.equal((await googleJoin('A'.repeat(43), g('nobody@test.local'))).get('google_error'), 'invite_invalid');
  assert.equal(await User.exists({ email: 'nobody@test.local' }), null);
});

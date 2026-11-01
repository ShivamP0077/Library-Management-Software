// Unit tests for the server-side Google OAuth flow.
// No network calls to Google and no MongoDB: the Google client is injected and
// the User/Library models are stubbed.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { User, Library } from '../src/models.js';
import { googleEnabled, setGoogleClientFactory } from '../src/google.js';

const FRONTEND = 'http://localhost:5173';
const COOKIE = 'lms_g_oauth';

const originalUserFindOne = User.findOne;
const originalUserCreate = User.create;
const originalUserUpdateOne = User.updateOne;
const originalLibraryFindOne = Library.findOne;

let server, base;
let user, library, findOneCalls, saveCalls, createCalls;

function makeClient({ payload = {} } = {}) {
  const calls = {};
  return {
    calls,
    client: {
      generateAuthUrl(opts) {
        calls.generateAuthUrl = opts;
        const params = new URLSearchParams({
          client_id: 'test-id',
          redirect_uri: 'http://localhost:5000/api/auth/google/callback',
          response_type: 'code',
          scope: Array.isArray(opts.scope) ? opts.scope.join(' ') : String(opts.scope),
          state: opts.state,
          code_challenge: opts.code_challenge,
          code_challenge_method: opts.code_challenge_method,
          prompt: opts.prompt,
          access_type: opts.access_type,
          include_granted_scopes: String(opts.include_granted_scopes),
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      },
      async getToken(args) {
        calls.getToken = args;
        return { tokens: { id_token: 'fake-id-token' } };
      },
      async verifyIdToken(args) {
        calls.verifyIdToken = args;
        return { getPayload: () => payload };
      },
    },
  };
}

function cookieFor(state, verifier) {
  const value = Buffer.from(JSON.stringify({ s: state, v: verifier }), 'utf8').toString('base64url');
  return `${COOKIE}=${value}`;
}

function makeUser(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439011',
    email: 'owner@example.com',
    name: '',
    role: 'client_admin',
    libraryId: 'lib-a',
    status: 'Active',
    googleSub: null,
    authProviders: ['password'],
    save: async () => { saveCalls += 1; },
    ...overrides,
  };
}

async function callbackRequest({ payload = {}, state = 'state-1', verifier = 'verifier-1', cookie, code = 'auth-code', query = {} } = {}) {
  const { client } = makeClient({ payload });
  setGoogleClientFactory(() => client);

  const url = new URL(`${base}/api/auth/google/callback`);
  if (code !== null) url.searchParams.set('code', code);
  if (state !== null) url.searchParams.set('state', state);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const headers = {};
  if (cookie !== null) headers.cookie = cookie === undefined ? cookieFor(state, verifier) : cookie;

  const res = await fetch(url, { redirect: 'manual', headers });
  const location = res.headers.get('location') || '';
  const hash = location.split('#')[1] || '';
  return {
    res,
    location,
    hash,
    params: new URLSearchParams(hash),
    setCookie: res.headers.get('set-cookie') || '',
  };
}

before(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_CALLBACK_URL = 'http://localhost:5000/api/auth/google/callback';
  process.env.FRONTEND_URL = FRONTEND;
  process.env.JWT_SECRET = 'test';
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  user = null;
  library = { libraryId: 'lib-a', name: 'Library A', status: 'Active' };
  findOneCalls = [];
  saveCalls = 0;
  createCalls = 0;

  User.findOne = async (filter) => { findOneCalls.push(filter); return user; };
  User.create = async () => { createCalls += 1; throw new Error('User.create must not be called'); };
  User.updateOne = async () => ({ acknowledged: true });
  Library.findOne = () => ({ lean: async () => library });
  setGoogleClientFactory(null);
});

afterEach(() => {
  User.findOne = originalUserFindOne;
  User.create = originalUserCreate;
  User.updateOne = originalUserUpdateOne;
  Library.findOne = originalLibraryFindOne;
  setGoogleClientFactory(null);
});

after(() => {
  server?.close();
});

test('start sets the HttpOnly state/PKCE cookie and redirects to Google', async () => {
  const { client, calls } = makeClient();
  setGoogleClientFactory(() => client);

  const res = await fetch(`${base}/api/auth/google/start`, { redirect: 'manual' });
  assert.equal(res.status, 302);

  const url = new URL(res.headers.get('location'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(url.searchParams.get('access_type'), 'online');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.ok(url.searchParams.get('state'));
  assert.ok(url.searchParams.get('code_challenge'));

  assert.equal(calls.generateAuthUrl.code_challenge, url.searchParams.get('code_challenge'));
  assert.equal(calls.generateAuthUrl.state, url.searchParams.get('state'));

  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /lms_g_oauth=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\/api\/auth\/google/i);
  assert.match(setCookie, /Max-Age=600/);

  const cookieValue = setCookie.match(/lms_g_oauth=([^;]+)/)[1];
  const data = JSON.parse(Buffer.from(cookieValue, 'base64url').toString('utf8'));
  assert.equal(data.s, url.searchParams.get('state'));
  const expectedChallenge = crypto.createHash('sha256').update(data.v).digest('base64url');
  assert.equal(url.searchParams.get('code_challenge'), expectedChallenge);

  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});

test('callback rejects mismatched and missing state and clears the cookie', async () => {
  const mismatch = await callbackRequest({
    state: 'state-2',
    cookie: cookieFor('state-1', 'verifier-1'),
  });
  assert.equal(mismatch.res.status, 302);
  assert.equal(mismatch.params.get('google_error'), 'invalid_state');
  assert.match(mismatch.setCookie, /lms_g_oauth=;/);
  assert.match(mismatch.setCookie, /Path=\/api\/auth\/google/);
  assert.match(mismatch.setCookie, /Expires=Thu, 01 Jan 1970/);
  assert.equal(findOneCalls.length, 0);

  const missing = await callbackRequest({ cookie: null });
  assert.equal(missing.params.get('google_error'), 'invalid_state');
  assert.equal(findOneCalls.length, 0);
});

test('callback rejects an unverified Google email', async () => {
  user = makeUser();
  const out = await callbackRequest({
    payload: { email: 'owner@example.com', email_verified: false, sub: 'google-sub-1' },
  });
  assert.equal(out.params.get('google_error'), 'email_unverified');
  assert.equal(findOneCalls.length, 0);
  assert.equal(saveCalls, 0);
});

test('callback rejects unknown emails without creating a user', async () => {
  user = null;
  const out = await callbackRequest({
    payload: { email: 'stranger@example.com', email_verified: true, sub: 'google-sub-x', name: 'Stranger' },
  });
  assert.equal(out.params.get('google_error'), 'not_registered');
  assert.equal(findOneCalls.length, 1);
  assert.equal(findOneCalls[0].email, 'stranger@example.com');
  assert.equal(createCalls, 0);
  assert.equal(saveCalls, 0);
});

test('callback links an existing user and returns a valid JWT in the fragment', async () => {
  user = makeUser();
  const out = await callbackRequest({
    payload: { email: 'owner@example.com', email_verified: true, sub: 'google-sub-1', name: 'Owner Name' },
  });

  assert.equal(out.res.status, 302);
  assert.ok(out.location.startsWith(`${FRONTEND}/#google_token=`));
  assert.equal(out.params.get('google_token') !== null, true);

  const decoded = jwt.verify(out.params.get('google_token'), 'test');
  assert.equal(decoded.sub, String(user._id));
  assert.equal(decoded.role, user.role);

  assert.equal(user.googleSub, 'google-sub-1');
  assert.ok(user.authProviders.includes('google'));
  assert.equal(user.name, 'Owner Name');
  assert.ok(user.lastLoginAt instanceof Date);
  assert.equal(saveCalls, 1);

  assert.match(out.setCookie, /lms_g_oauth=;/);
  assert.equal(out.res.headers.get('cache-control'), 'no-store');
  assert.equal(out.res.headers.get('referrer-policy'), 'no-referrer');
});

test('callback rejects an email linked to a different Google account', async () => {
  user = makeUser({ googleSub: 'other-sub' });
  const out = await callbackRequest({
    payload: { email: 'owner@example.com', email_verified: true, sub: 'google-sub-1' },
  });
  assert.equal(out.params.get('google_error'), 'account_mismatch');
  assert.equal(saveCalls, 0);
});

test('callback rejects a disabled account', async () => {
  user = makeUser({ status: 'Disabled' });
  const out = await callbackRequest({
    payload: { email: 'owner@example.com', email_verified: true, sub: 'google-sub-1' },
  });
  assert.equal(out.params.get('google_error'), 'account_disabled');
  assert.equal(saveCalls, 0);
});

test('callback rejects a disabled library', async () => {
  user = makeUser();
  library = { libraryId: 'lib-a', name: 'Library A', status: 'Disabled' };
  const out = await callbackRequest({
    payload: { email: 'owner@example.com', email_verified: true, sub: 'google-sub-1' },
  });
  assert.equal(out.params.get('google_error'), 'library_disabled');
  assert.equal(saveCalls, 0);
});

test('auth config reports Google off when the client secret is missing', async () => {
  const saved = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    assert.equal(googleEnabled(), false);

    const config = await fetch(`${base}/api/auth/config`).then(r => r.json());
    assert.deepEqual(config, { googleEnabled: false, passwordLogin: true });

    const start = await fetch(`${base}/api/auth/google/start`, { redirect: 'manual' });
    assert.equal(start.headers.get('location'), `${FRONTEND}/#google_error=not_configured`);
  } finally {
    process.env.GOOGLE_CLIENT_SECRET = saved;
  }
});

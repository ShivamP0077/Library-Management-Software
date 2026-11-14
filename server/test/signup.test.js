// Issue #15: owner signup with email code + plan choice. Off by default.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx, login } from './helpers.js';
import { outbox } from '../src/mailer.js';
import { resetRateLimits } from '../src/accounts.js';
import { initialSubscription } from '../src/billing.js';
import { Library } from '../src/models.js';
import { SignupOtp } from '../src/signup.js';

before(async () => {
  await setup('signup');
  for (const p of [{ name: 'Free', priceMonthly: 0 }, { name: 'Pro', priceMonthly: 999, priceYearly: 9990, trialDays: 14, studentLimit: 300 }, { name: 'Secret', priceMonthly: 1, public: false }])
    assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: p })).status, 201);
});
after(async () => { delete process.env.OWNER_SIGNUP_ENABLED; await teardown(); });
beforeEach(() => resetRateLimits());

const codeFor = (email) => outbox.filter(m => m.to === email).at(-1)?.text.match(/code is (\d{6})/)?.[1];
const complete = (body) => call('POST', '/api/auth/signup/complete', { body: { name: 'Owner', password: 'OwnerPass-123', libraryName: 'My Library', planId: 'pro', ...body } });

test('signup is off unless OWNER_SIGNUP_ENABLED=true', async () => {
  delete process.env.OWNER_SIGNUP_ENABLED;
  const off = (await call('GET', '/api/auth/signup/config')).body;
  assert.equal(off.enabled, false); assert.deepEqual(off.plans, []); assert.equal(off.googleSignup, false);
  assert.equal((await call('POST', '/api/auth/signup/start', { body: { email: 'x@test.local' } })).status, 403);
  assert.equal((await complete({ email: 'x@test.local', code: '000000' })).status, 403);
});

test('config lists only active public plans', async () => {
  process.env.OWNER_SIGNUP_ENABLED = 'true';
  const c = (await call('GET', '/api/auth/signup/config')).body;
  assert.equal(c.enabled, true);
  assert.deepEqual(c.plans.map(p => p.planId).sort(), ['free', 'pro']);
});

test('email code -> plan -> library + owner session; code is single use', async () => {
  process.env.OWNER_SIGNUP_ENABLED = 'true';
  const email = 'new.owner@test.local';
  assert.equal((await call('POST', '/api/auth/signup/start', { body: { email } })).status, 200);
  const code = codeFor(email); assert.match(code, /^\d{6}$/);
  assert.equal((await complete({ email, code: '000000' === code ? '111111' : '000000' })).status, 400, 'wrong code');
  assert.equal((await complete({ email, code, planId: 'secret' })).body.code, 'plan_required', 'hidden plan refused');
  assert.equal((await complete({ email, code, password: 'short' })).status, 400);
  const r = await complete({ email, code });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.token);
  assert.equal((await complete({ email, code })).status, 400, 'code reused');
  const me = (await call('GET', '/api/auth/me', { token: r.body.token })).body;
  const tenant = me.user?.tenantId || me.tenantId;
  const lib = await Library.findOne({ libraryId: tenant }).lean();
  assert.equal(lib.name, 'My Library'); assert.equal(lib.planId, 'pro');
  assert.equal(lib.subscription.status, 'trialing'); assert.equal(lib.subscription.price, 999);
  assert.ok(await login(email, 'OwnerPass-123'));
  // the new owner only sees their own library
  assert.equal((await call('GET', '/api/students', { token: r.body.token })).body.length, 0);
  assert.equal((await call('GET', '/api/admin/libraries', { token: r.body.token })).status, 403);
});

test('existing accounts get no code and the same answer; attempts are capped', async () => {
  process.env.OWNER_SIGNUP_ENABLED = 'true';
  const before = outbox.length;
  const r = await call('POST', '/api/auth/signup/start', { body: { email: 'admin-a@test.local' } });
  assert.equal(r.status, 200);
  assert.equal(codeFor('admin-a@test.local'), undefined, 'no code for existing account');
  assert.equal(outbox.length, before + 1);
  const email = 'brute@test.local';
  await call('POST', '/api/auth/signup/start', { body: { email } });
  const code = codeFor(email);
  for (let i = 0; i < 5; i++) await complete({ email, code: code === '999999' ? '888888' : '999999' });
  assert.equal((await complete({ email, code })).status, 400, 'locked after 5 wrong tries');
  assert.equal((await call('POST', '/api/auth/signup/start', { body: { email } })).status, 429, 'resend throttled');
});

test('initialSubscription: trial, free and paid-without-provider', () => {
  const now = new Date('2026-11-05T00:00:00Z');
  assert.equal(initialSubscription({ planId: 'p', priceMonthly: 999, trialDays: 14 }, 'month', now).trialEndsAt.toISOString(), '2026-11-19T00:00:00.000Z');
  const free = initialSubscription({ planId: 'f', priceMonthly: 0 }, 'month', now);
  assert.equal(free.status, 'active'); assert.equal(free.currentPeriodEnd.toISOString(), '2026-12-05T00:00:00.000Z');
  assert.equal(initialSubscription({ planId: 'x', priceMonthly: 500, priceYearly: 5000 }, 'year', now).status, 'pending_payment');
  assert.equal(initialSubscription(null), null);
});

test('config exposes googleSignup and paymentsConfigured flags', async () => {
  process.env.OWNER_SIGNUP_ENABLED = 'true';
  const c = (await call('GET', '/api/auth/signup/config')).body;
  assert.equal(c.enabled, true);
  assert.equal(typeof c.googleSignup, 'boolean');
  assert.equal(c.paymentsConfigured, false);
});

test('paid plan without trial returns needsPayment + paymentHook', async () => {
  process.env.OWNER_SIGNUP_ENABLED = 'true';
  // Create a paid public plan with no trial
  assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: { name: 'PayNow', priceMonthly: 500, trialDays: 0, public: true } })).status, 201);
  const email = 'paynow.owner@test.local';
  await call('POST', '/api/auth/signup/start', { body: { email } });
  const code = codeFor(email);
  const r = await complete({ email, code, planId: 'paynow', libraryName: 'Pay Lib' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.needsPayment, true);
  assert.equal(r.body.paymentHook?.path, '/api/subscription/checkout');
  assert.equal(r.body.paymentsConfigured, false);
  // Checkout without provider → 402
  const chk = await call('POST', '/api/subscription/checkout', { token: r.body.token });
  assert.equal(chk.status, 402);
  assert.equal(chk.body.code, 'payments_not_configured');
});

test('google signup pending -> complete-google creates library', async () => {
  process.env.OWNER_SIGNUP_ENABLED = 'true';
  const { createGoogleSignupPending } = await import('../src/signup.js');
  const pending = await createGoogleSignupPending({ email: 'g.owner@test.local', sub: 'google-sub-15', name: 'G Owner' });
  const r = await call('POST', '/api/auth/signup/complete-google', {
    body: { pendingToken: pending, libraryName: 'Google Lib', planId: 'free', name: 'G Owner' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token);
  assert.equal(r.body.needsPayment, false);
  const me = (await call('GET', '/api/auth/me', { token: r.body.token })).body;
  assert.equal(me.user.email, 'g.owner@test.local');
  assert.ok((me.user.authProviders || []).includes('google'));
  // pending token single-use
  assert.equal((await call('POST', '/api/auth/signup/complete-google', {
    body: { pendingToken: pending, libraryName: 'X', planId: 'free' },
  })).status, 400);
});

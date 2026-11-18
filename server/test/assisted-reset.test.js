import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { setup, teardown, call, login, ctx, SA } from './helpers.js';
import { User, Library } from '../src/models.js';
import { outbox } from '../src/mailer.js';
import { resetThrottles } from '../src/throttle.js';
import { AuditLog } from '../src/audit.js';
import { PasswordResetOtp } from '../src/accounts.js';
import { setSystemEvolutionClient } from '../src/systemWhatsapp.js';
import { signToken } from '../src/auth.js';

before(() => setup('assisted-reset'));
after(() => { setSystemEvolutionClient(null); return teardown(); });

const codeFrom = (text) => {
  const m = String(text || '').match(/\b(\d{6})\b/);
  return m ? m[1] : '';
};

test('password step-up resets owner, bumps tokenVersion, kills old JWT', async () => {
  const owner = await User.findOne({ email: 'admin-a@test.local' });
  assert.equal(owner.tokenVersion ?? 0, 0);
  const oldToken = signToken(owner);
  assert.equal(jwt.decode(oldToken).tokenVersion, 0);
  assert.equal((await call('GET', '/api/auth/me', { token: oldToken })).status, 200);

  const start = await call('POST', '/api/admin/assisted-password-reset/start', {
    token: ctx.tokens.sa,
    body: { userId: String(owner._id), libraryId: 'lib-a', method: 'password', reason: 'Owner locked out of email' },
  });
  assert.equal(start.status, 200, JSON.stringify({ status: start.status, error: start.body?.error }));
  const done = await call('POST', '/api/admin/assisted-password-reset/complete', {
    token: ctx.tokens.sa,
    body: { challengeId: start.body.challengeId, proof: SA.password, newPassword: 'Owner-new-pass-1' },
  });
  assert.equal(done.status, 200, JSON.stringify({ status: done.status, error: done.body?.error }));
  assert.equal((await call('GET', '/api/auth/me', { token: oldToken })).status, 401);
  const fresh = await login('admin-a@test.local', 'Owner-new-pass-1');
  assert.ok(fresh);
  assert.equal(jwt.decode(fresh).tokenVersion, 1);
  const saved = await User.findById(owner._id).lean();
  assert.equal(saved.tokenVersion, 1);
  assert.ok(saved.passwordChangedAt);
  const log = await AuditLog.findOne({ action: 'superadmin.assisted_password_reset', target: 'admin-a@test.local' }).lean();
  assert.ok(log);
  assert.equal(log.actorEmail, SA.email);
  assert.equal(log.reason, 'Owner locked out of email');
  assert.ok(log.at);
});

test('email step-up accepts only the Super Admin code', async () => {
  outbox.length = 0;
  const owner = await User.findOne({ email: 'admin-b@test.local' });
  const forgot = await call('POST', '/api/auth/forgot-password', { body: { email: 'admin-b@test.local' } });
  assert.equal(forgot.status, 200);
  const customerCode = codeFrom(outbox.at(-1)?.text);
  assert.ok(customerCode);
  outbox.length = 0;
  const start = await call('POST', '/api/admin/assisted-password-reset/start', {
    token: ctx.tokens.sa,
    body: { userId: String(owner._id), libraryId: 'lib-b', method: 'email', reason: 'Phone stolen, owner asked in person' },
  });
  assert.equal(start.status, 200, JSON.stringify({ status: start.status, error: start.body?.error }));
  assert.equal(outbox.at(-1)?.to, SA.email);
  const saCode = codeFrom(outbox.at(-1)?.text);
  assert.ok(saCode);
  assert.notEqual(saCode, customerCode);
  const rejected = await call('POST', '/api/admin/assisted-password-reset/complete', {
    token: ctx.tokens.sa,
    body: { challengeId: start.body.challengeId, proof: customerCode, newPassword: 'Owner-b-new-pass' },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'step_up_failed');
  const otpStill = await PasswordResetOtp.findOne({ userId: String(owner._id), usedAt: null });
  assert.ok(otpStill);
  const done = await call('POST', '/api/admin/assisted-password-reset/complete', {
    token: ctx.tokens.sa,
    body: { challengeId: start.body.challengeId, proof: saCode, newPassword: 'Owner-b-new-pass' },
  });
  assert.equal(done.status, 200, JSON.stringify({ status: done.status, error: done.body?.error }));
  assert.ok(await login('admin-b@test.local', 'Owner-b-new-pass'));
});

test('WhatsApp step-up uses the Super Admin number', async () => {
  const sent = [];
  setSystemEvolutionClient({
    sendText: async (_instance, number, text) => { sent.push({ number, text }); },
  });
  await User.updateOne({ email: SA.email }, { $set: { mobile: '9876500099' } });
  const staffRes = await call('POST', '/api/admin/libraries/lib-a/users', {
    token: ctx.tokens.sa,
    body: { email: 'staff-a@test.local', name: 'Staff A', role: 'staff', password: 'Staff-pass-123' },
  });
  assert.equal(staffRes.status, 201, JSON.stringify(staffRes.body));
  const start = await call('POST', '/api/admin/assisted-password-reset/start', {
    token: ctx.tokens.sa,
    body: { userId: staffRes.body.user.id, libraryId: 'lib-a', method: 'whatsapp', reason: 'Staff forgot password at the desk' },
  });
  assert.equal(start.status, 200, JSON.stringify({ status: start.status, error: start.body?.error }));
  assert.equal(sent.at(-1)?.number.endsWith('9876500099') || sent.at(-1)?.number === '9876500099', true);
  const saCode = codeFrom(sent.at(-1)?.text);
  assert.ok(saCode);
  const done = await call('POST', '/api/admin/assisted-password-reset/complete', {
    token: ctx.tokens.sa,
    body: { challengeId: start.body.challengeId, proof: saCode, newPassword: 'Staff-new-pass-1' },
  });
  assert.equal(done.status, 200, JSON.stringify({ status: done.status, error: done.body?.error }));
  assert.ok(await login('staff-a@test.local', 'Staff-new-pass-1'));
  setSystemEvolutionClient(null);
});

test('cannot reset a platform user or a mismatched library', async () => {
  const partner = await User.create({ email: 'partner-reset@test.local', name: 'Partner', role: 'partner', status: 'Active' });
  const denied = await call('POST', '/api/admin/assisted-password-reset/start', {
    token: ctx.tokens.sa,
    body: { userId: String(partner._id), libraryId: 'lib-a', method: 'password', reason: 'Should not work' },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'platform_user');
  const owner = await User.findOne({ email: 'admin-a@test.local' });
  const mismatch = await call('POST', '/api/admin/assisted-password-reset/start', {
    token: ctx.tokens.sa,
    body: { userId: String(owner._id), libraryId: 'lib-b', method: 'password', reason: 'Wrong library' },
  });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.code, 'library_mismatch');
  const ownerToken = await login('admin-a@test.local', 'Owner-new-pass-1');
  const other = await call('POST', '/api/admin/assisted-password-reset/start', {
    token: ownerToken,
    body: { userId: String(owner._id), libraryId: 'lib-a', method: 'password', reason: 'Owner trying' },
  });
  assert.equal(other.status, 403);
});

test('direct password patch is refused', async () => {
  const owner = await User.findOne({ email: 'admin-a@test.local' });
  const r = await call('PATCH', `/api/admin/users/${owner._id}`, {
    token: ctx.tokens.sa,
    body: { password: 'Bypass-pass-123' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'assisted_reset_required');
});

test('rate limit is per target and a second code waits 30 seconds', async () => {
  await resetThrottles();
  const lib = await Library.findOne({ libraryId: 'lib-a' }).lean();
  assert.ok(lib);
  const make = async (email) => {
    const r = await call('POST', '/api/admin/libraries/lib-a/users', {
      token: ctx.tokens.sa,
      body: { email, name: email, role: 'staff', password: 'Staff-pass-123' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.user.id;
  };
  const first = await make('rate-a@test.local');
  const second = await make('rate-b@test.local');
  const startFor = (userId) => call('POST', '/api/admin/assisted-password-reset/start', {
    token: ctx.tokens.sa,
    body: { userId, libraryId: 'lib-a', method: 'password', reason: 'Rate limit check' },
  });
  assert.equal((await startFor(first)).status, 200);
  assert.equal((await startFor(first)).status, 200);
  assert.equal((await startFor(first)).status, 200);
  assert.equal((await startFor(first)).status, 429);
  assert.equal((await startFor(second)).status, 200);

  await resetThrottles();
  outbox.length = 0;
  const emailUser = await make('rate-c@test.local');
  const one = await call('POST', '/api/admin/assisted-password-reset/start', {
    token: ctx.tokens.sa,
    body: { userId: emailUser, libraryId: 'lib-a', method: 'email', reason: 'Resend check' },
  });
  assert.equal(one.status, 200, JSON.stringify({ status: one.status, error: one.body?.error }));
  const two = await call('POST', '/api/admin/assisted-password-reset/start', {
    token: ctx.tokens.sa,
    body: { userId: emailUser, libraryId: 'lib-a', method: 'email', reason: 'Resend check again' },
  });
  assert.equal(two.status, 429);
});

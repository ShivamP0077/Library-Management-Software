// Issue #15: mobile/email registration, profile confirmation and OTP password setup.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx, login } from './helpers.js';
import { outbox } from '../src/mailer.js';
import { setSmsProvider, smsProvider } from '../src/messaging.js';
import { resetRateLimits } from '../src/accounts.js';
import { User, Library } from '../src/models.js';
import { signToken } from '../src/auth.js';
import { hashPassword } from '../src/services.js';

import { textToPdf } from '../src/pdf.js';
const smsOutbox = [];
before(async () => {
  await setup('account-registration');
  process.env.OWNER_SIGNUP_ENABLED = 'true';
  setSmsProvider({ name: 'test-sms', send: async ({ to, text }) => { smsOutbox.push({ to, text, at: new Date() }); return { ok: true }; } });
  for (const p of [{ name: 'Free', priceMonthly: 0 }, { name: 'Pro', priceMonthly: 999 }])
    assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: p })).status, 201);
});
after(async () => { delete process.env.OWNER_SIGNUP_ENABLED; setSmsProvider(null); await teardown(); });
beforeEach(() => resetRateLimits());

const smsCode = (mobile) => smsOutbox.filter(m => m.to === mobile).at(-1)?.text.match(/code is (\d{6})/)?.[1];
const emailCode = (email) => outbox.filter(m => m.to === email).at(-1)?.text.match(/code is (\d{6})/)?.[1];

test('AUTH: mobile OTP signup creates owner and persistent non-receipt confirmation', async () => {
  const mobile = '9876543210';
  const start = await call('POST', '/api/auth/signup/start-mobile', { body: { mobile } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const code = smsCode(mobile);
  assert.match(code, /^\d{6}$/);

  const done = await call('POST', '/api/auth/signup/complete-mobile', {
    body: { mobile, code, name: 'Mobile Owner', libraryName: 'Mobile Library', password: 'OwnerPass-123', planId: 'free' },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.ok(done.body.token);
  assert.ok(done.body.registrationConfirmation?.confirmationNumber);
  assert.equal(done.body.registrationConfirmation.paymentStatus, 'free');
  assert.equal(done.body.registrationConfirmation.deliveryStatus, 'sent');
  assert.equal(done.body.needsPayment, false);

  const me = (await call('GET', '/api/auth/me', { token: done.body.token })).body;
  assert.equal(me.user.mobile, mobile);
  assert.equal(me.user.mobileVerified, true);
  assert.equal(me.user.email, null);
  assert.ok(await login(mobile, 'OwnerPass-123'), 'login accepts mobile identifier');

  const confirmation = (await call('GET', '/api/account/registration-confirmation', { token: done.body.token })).body;
  assert.equal(confirmation.isPaymentReceipt, false);
  assert.equal(confirmation.paymentStatus, 'free');
  assert.equal(confirmation.downloadPath, '/api/account/registration-confirmation/download');

  const dl = await fetch(`${ctx.base}/api/account/registration-confirmation/download`, { headers: { Authorization: `Bearer ${done.body.token}` } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-type'), /text\/plain/);
  const text = await dl.text();
  assert.match(text, /REGISTRATION CONFIRMATION/);
  assert.match(text, /NOT proof of plan payment/);
});

test('AUTH: email signup confirmation survives failed delivery and can be retried/downloaded', async () => {
  const email = 'mail.owner@test.local';
  await call('POST', '/api/auth/signup/start', { body: { email } });
  const code = emailCode(email);
  const done = await call('POST', '/api/auth/signup/complete', {
    body: { email, code, name: 'Mail Owner', libraryName: 'Mail Library', password: 'OwnerPass-123', planId: 'free' },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.registrationConfirmation.deliveryStatus, 'logged');
  const profile = (await call('GET', '/api/account/profile', { token: done.body.token })).body;
  assert.equal(profile.registrationConfirmation.confirmationNumber, done.body.registrationConfirmation.confirmationNumber);
  assert.equal(profile.registrationConfirmation.isPaymentReceipt, false);
  const retry = await call('POST', '/api/account/registration-confirmation/retry', { token: done.body.token });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.isPaymentReceipt, false);
  assert.ok(retry.body.delivery.attempts >= 1);
  assert.ok((await call('GET', '/api/account/registration-confirmation/download', { token: done.body.token })).status === 200);
});

test('PROF: Google-only owner sets a password only after a verified OTP', async () => {
  const user = await User.create({
    email: 'google.only@test.local', name: 'Google Only', role: 'client_admin', tenantId: 'lib-a', libraryId: 'lib-a',
    emailVerified: true, authProviders: ['google'],
  });
  const token = signToken(user);
  const before = (await call('GET', '/api/account/profile', { token })).body;
  assert.equal(before.user.hasPassword, false);
  assert.equal((await call('POST', '/api/account/password/setup/complete', { token, body: { code: '000000', newPassword: 'NewPass-123' } })).status, 400);
  const start = await call('POST', '/api/account/password/setup/start', { token, body: {} });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const code = emailCode('google.only@test.local');
  assert.match(code, /^\d{6}$/);
  const done = await call('POST', '/api/account/password/setup/complete', { token, body: { code, newPassword: 'NewPass-123' } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await call('GET', '/api/account/profile', { token })).body.user.hasPassword, true);
  assert.ok(await login('google.only@test.local', 'NewPass-123'));
  const changed = await call('POST', '/api/auth/change-password', { token, body: { currentPassword: '', newPassword: 'Another-123' } });
  assert.equal(changed.status, 400, 'current password is required once set');
});

test('PROF: profile is tenant-scoped and cannot expose another library confirmation', async () => {
  const a = (await call('GET', '/api/account/profile', { token: ctx.tokens.a })).body;
  const b = (await call('GET', '/api/account/profile', { token: ctx.tokens.b })).body;
  assert.notEqual(a.registrationConfirmation.confirmationNumber, b.registrationConfirmation.confirmationNumber);
  const libA = await Library.findOne({ libraryId: 'lib-a' }).lean();
  const libB = await Library.findOne({ libraryId: 'lib-b' }).lean();
  assert.notEqual(libA.referralCode, libB.referralCode);
});


test('PROF: contact verification is bound to the authenticated user/target, and mobile never falls back to email', async () => {
  const password = 'Contact-Pass-123';
  const passwordHash = await hashPassword(password);
  const userA = await User.create({
    email: 'contact.a@test.local', name: 'Contact A', role: 'client_admin', tenantId: 'lib-a', libraryId: 'lib-a',
    emailVerified: true, mobile: '9000000011', mobileVerified: true, passwordHash, authProviders: ['email', 'mobile', 'password'],
  });
  const userB = await User.create({
    email: 'contact.b@test.local', name: 'Contact B', role: 'client_admin', tenantId: 'lib-b', libraryId: 'lib-b',
    emailVerified: true, passwordHash, authProviders: ['email', 'password'],
  });
  const tokenA = signToken(userA);
  const tokenB = signToken(userB);

  const inUse = await call('POST', '/api/account/contact/start', {
    token: tokenA, body: { channel: 'email', value: 'contact.b@test.local', currentPassword: password },
  });
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.code, 'contact_in_use');

  const newEmail = 'contact.a.new@test.local';
  const start = await call('POST', '/api/account/contact/start', {
    token: tokenA, body: { channel: 'email', value: newEmail, currentPassword: password },
  });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const code = emailCode(newEmail);
  assert.match(code, /^\d{6}$/);

  const stolen = await call('POST', '/api/account/contact/verify', {
    token: tokenB, body: { channel: 'email', value: newEmail, code },
  });
  assert.equal(stolen.status, 400, 'another user cannot consume the code');
  assert.equal((await User.findById(userB._id).lean()).email, 'contact.b@test.local');

  const verified = await call('POST', '/api/account/contact/verify', {
    token: tokenA, body: { channel: 'email', value: newEmail, code },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.ownerDetails.email, newEmail);
  assert.equal(verified.body.ownerDetails.emailVerified, true);

  const originalSms = smsProvider();
  setSmsProvider(null);
  try {
    const noSms = await call('POST', '/api/account/contact/start', {
      token: tokenA, body: { channel: 'mobile', value: '9000000099', currentPassword: password },
    });
    assert.equal(noSms.status, 503);
    assert.equal(noSms.body.code, 'mobile_otp_not_configured');
    assert.equal((await User.findById(userA._id).lean()).pendingMobile, null, 'no fake pending verification');
  } finally { setSmsProvider(originalSms); }
});

test('PROF: sensitive library contact edits need owner+reauth; confirmation PDF/history are real', async () => {
  const original = await Library.findOne({ libraryId: 'lib-a' }).lean();
  const wrong = await call('PATCH', '/api/account/profile', {
    token: ctx.tokens.a, body: { library: { phone: '9000001234' }, currentPassword: 'wrong-password' },
  });
  assert.equal(wrong.status, 400);
  assert.equal((await Library.findOne({ libraryId: 'lib-a' }).lean()).phone, original.phone || null);

  const staff = await User.create({
    email: 'profile.staff@test.local', name: 'Profile Staff', role: 'staff', tenantId: 'lib-a', libraryId: 'lib-a',
    emailVerified: true, passwordHash: await hashPassword('Staff-Pass-123'), authProviders: ['email', 'password'],
  });
  const staffToken = signToken(staff);
  const forbidden = await call('PATCH', '/api/account/profile', {
    token: staffToken, body: { library: { phone: '9000001234' }, currentPassword: 'Staff-Pass-123' },
  });
  assert.equal(forbidden.status, 403);

  const ok = await call('PATCH', '/api/account/profile', {
    token: ctx.tokens.a, body: { library: { phone: '9000001234' }, currentPassword: 'Password-a-123' },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.libraryDetails.phone, '9000001234');
  await call('PATCH', '/api/account/profile', {
    token: ctx.tokens.a, body: { library: { phone: original.phone || '' }, currentPassword: 'Password-a-123' },
  });

  const pdf = await fetch(`${ctx.base}/api/account/registration-confirmation/download?format=pdf`, {
    headers: { Authorization: `Bearer ${ctx.tokens.a}` },
  });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const history = await call('GET', '/api/account/registration-confirmation/history', { token: ctx.tokens.a });
  assert.equal(history.status, 200);
  assert.equal(Array.isArray(history.body.delivery.history), true);
});

test('PDF writer preserves readable heading punctuation and INR text', () => {
  const pdf = textToPdf('LIBRARY OS — RECEIPT\nStatus: paid · Imported text: ₹999').toString('ascii');
  assert.match(pdf, /LIBRARY OS - RECEIPT/);
  assert.match(pdf, /Status: paid - Imported text: INR 999/);
});

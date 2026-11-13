// One free trial per normalised email, phone and Google sub. Hashes only.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { outbox } from '../src/mailer.js';
import { resetRateLimits } from '../src/accounts.js';
import { User, Library } from '../src/models.js';
import { normalizeTrialEmail, normalizeTrialPhone, hashTrialValue, gmailVariantPattern, TRIAL_USED_MESSAGE, TrialUsage, trialIdentityUsed } from '../src/trialUsage.js';
import { deleteLibraryData } from '../src/deleteLibrary.js';
import { AuditLog } from '../src/audit.js';

before(async () => {
  await setup('trial_usage');
  process.env.OWNER_SIGNUP_ENABLED = 'true';
  assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: { name: 'Pro', priceMonthly: 999, trialDays: 14, public: true } })).status, 201);
});
after(async () => { delete process.env.OWNER_SIGNUP_ENABLED; delete process.env.TRIAL_HASH_PEPPER; await teardown(); });
beforeEach(() => resetRateLimits());

const codeFor = (email) => outbox.filter(m => m.to === email).at(-1)?.text.match(/code is (\d{6})/)?.[1];
const signup = async (email, extra = {}) => {
  assert.equal((await call('POST', '/api/auth/signup/start', { body: { email } })).status, 200);
  return call('POST', '/api/auth/signup/complete', {
    body: { email, code: codeFor(email), name: 'Owner', password: 'OwnerPass-123', libraryName: `Lib ${email}`, planId: 'pro', ...extra },
  });
};

test('gmail variant pattern allows optional dots and a plus tag, and escapes the local part', () => {
  const re = new RegExp(gmailVariantPattern('user'), 'i');
  assert.match('user@gmail.com', re);
  assert.match('u.s.e.r+tag@gmail.com', re);
  assert.match('user+news@googlemail.com', re);
  assert.doesNotMatch('userx@gmail.com', re);
  assert.doesNotMatch('other@gmail.com', re);
  assert.doesNotMatch('user@example.com', re);
  const plus = new RegExp(gmailVariantPattern('a+b'), 'i');
  assert.match('a+b@gmail.com', plus);
  assert.match('a.+b+tag@gmail.com', plus);
  assert.doesNotMatch('aaab@gmail.com', plus);
  assert.equal(gmailVariantPattern(''), null);
  assert.equal(gmailVariantPattern('a'.repeat(65)), null);
});

test('normalises gmail dots, plus tags and googlemail.com; Indian phones become 91XXXXXXXXXX', () => {
  assert.equal(normalizeTrialEmail('  US.ER+tag@GoogleMail.com '), 'user@gmail.com');
  assert.equal(normalizeTrialEmail('user@gmail.com'), normalizeTrialEmail('u.s.e.r+news@gmail.com'));
  assert.equal(normalizeTrialEmail('A.B@Example.com'), 'a.b@example.com');
  assert.equal(normalizeTrialPhone('+91 98765 43210'), '919876543210');
  assert.equal(normalizeTrialPhone('09876543210'), '919876543210');
  assert.equal(normalizeTrialPhone('9876543210'), '919876543210');
  const plain = hashTrialValue('email', 'user@gmail.com');
  process.env.TRIAL_HASH_PEPPER = 'pepper-for-test';
  const mac = hashTrialValue('email', 'user@gmail.com');
  delete process.env.TRIAL_HASH_PEPPER;
  assert.notEqual(plain, mac);
  assert.equal(hashTrialValue('email', 'user@gmail.com'), plain);
  assert.equal(plain.length, 64);
});

test('a second gmail variant does not get another trial', async () => {
  const first = await signup('us.er+news@gmail.com', { mobile: '9876500001' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.needsPayment, false);
  const me = (await call('GET', '/api/auth/me', { token: first.body.token })).body;
  const lib = await Library.findOne({ libraryId: me.user.tenantId }).lean();
  assert.equal(lib.subscription.status, 'trialing');
  assert.ok(lib.subscription.trialGrantedAt);
  const hashes = await TrialUsage.find().lean();
  assert.ok(hashes.length >= 2);
  assert.equal(hashes.every(h => !('email' in h) && h.hash && h.kind), true);

  const second = await signup('user@gmail.com');
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.needsPayment, true);
  assert.equal(second.body.message, TRIAL_USED_MESSAGE);
  const me2 = (await call('GET', '/api/auth/me', { token: second.body.token })).body;
  const lib2 = await Library.findOne({ libraryId: me2.user.tenantId }).lean();
  assert.equal(lib2.subscription.status, 'awaiting_payment');
  assert.equal(lib2.subscription.trialEndsAt || null, null);
});

test('same phone on a new email does not get a trial', async () => {
  const first = await signup('phone.one@test.local', { mobile: '9876500002' });
  assert.equal(first.body.needsPayment, false);
  const me = (await call('GET', '/api/auth/me', { token: first.body.token })).body;
  // The phone is unique on the live account. Free it, but the trial hash stays.
  await User.updateOne({ _id: me.user.id }, { $unset: { mobile: 1 } });
  const second = await signup('phone.two@test.local', { mobile: '+91 98765 00002' });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.needsPayment, true);
  assert.equal(second.body.message, TRIAL_USED_MESSAGE);
});

test('lazy backfill: an existing disabled owner with the same gmail or Google sub blocks the trial', async () => {
  await Library.create({ libraryId: 'lib-old', name: 'Old', status: 'Disabled', contactEmail: 'old.owner@example.com' });
  await User.create({
    email: 'old.owner@example.com', name: 'Old', role: 'client_admin', status: 'Disabled',
    tenantId: 'lib-old', libraryId: 'lib-old', googleSub: 'google-sub-used',
  });
  const before = await TrialUsage.countDocuments({ kind: 'google' });
  const { createGoogleSignupPending } = await import('../src/signup.js');
  const pending = await createGoogleSignupPending({ email: 'fresh.google@example.com', sub: 'google-sub-used', name: 'New' });
  const r = await call('POST', '/api/auth/signup/complete-google', {
    body: { pendingToken: pending, libraryName: 'Google Again', planId: 'pro', name: 'New' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.needsPayment, true);
  assert.equal(r.body.message, TRIAL_USED_MESSAGE);
  assert.ok(await TrialUsage.countDocuments({ kind: 'google' }) > before);
});

test('lazy backfill counts owners and library contacts, not staff, partners or agents', async () => {
  await User.create({
    email: 'staff.person@gmail.com', name: 'Staff', role: 'staff', status: 'Active',
    tenantId: 'lib-staff', libraryId: 'lib-staff', mobile: '919876511111', googleSub: 'staff-google-sub',
  });
  await User.create({ email: 'agent.one@example.com', name: 'Agent', role: 'agent', mobile: '919876511112' });
  await User.create({ email: 'partner.one@example.com', name: 'Partner', role: 'partner', mobile: '9876511113' });
  assert.equal((await trialIdentityUsed({ email: 'staffperson@gmail.com' })).used, false);
  assert.equal((await trialIdentityUsed({ email: 'staff.person+news@googlemail.com' })).used, false);
  assert.equal((await trialIdentityUsed({ mobile: '9876511111' })).used, false);
  assert.equal((await trialIdentityUsed({ googleSub: 'staff-google-sub' })).used, false);
  assert.equal((await trialIdentityUsed({ email: 'agent.one@example.com' })).used, false);
  assert.equal((await trialIdentityUsed({ mobile: '9876511112' })).used, false);
  assert.equal((await trialIdentityUsed({ mobile: '9876511113' })).used, false);

  await User.create({
    email: 'own.er+x@gmail.com', name: 'Owner', role: 'client_admin', status: 'Disabled',
    tenantId: 'lib-gmail-owner', libraryId: 'lib-gmail-owner',
  });
  const owner = await trialIdentityUsed({ email: 'owner@gmail.com' });
  assert.equal(owner.used, true);
  assert.equal(owner.source, 'backfill');
  assert.equal((await trialIdentityUsed({ email: 'other.person@gmail.com' })).used, false);

  await Library.create({
    libraryId: 'lib-contact-mail', name: 'Contact', status: 'Disabled',
    contactEmail: 'lib.contact+news@gmail.com',
  });
  assert.equal((await trialIdentityUsed({ email: 'libcontact@gmail.com' })).used, true);

  await Library.create({
    libraryId: 'lib-contact-phone', name: 'Phone', status: 'Active',
    contactEmail: 'front-desk@library.test', phone: '+91 98765 00099',
  });
  const byPhone = await trialIdentityUsed({ mobile: '9876500099' });
  assert.equal(byPhone.used, true);
  assert.equal(byPhone.source, 'backfill');

  await AuditLog.create({
    action: 'library.deleted', target: 'lib-gone-mail', at: new Date(),
    detail: { contactEmail: 'gone.owner@example.com', name: 'Gone' },
  });
  assert.equal((await trialIdentityUsed({ email: 'gone.owner@example.com' })).used, true);
  await AuditLog.create({
    action: 'library.deleted', target: 'lib-gone-phone', at: new Date(),
    detail: { phone: '09876500088' },
  });
  assert.equal((await trialIdentityUsed({ mobile: '9876500088' })).used, true);

  const longLocal = 'b'.repeat(65);
  await User.create({
    email: `${longLocal}@gmail.com`, name: 'Long', role: 'client_admin', status: 'Active',
    tenantId: 'lib-long', libraryId: 'lib-long',
  });
  await User.create({
    email: `${'c'.repeat(65)}@gmail.com`, name: 'Long staff', role: 'staff', status: 'Active',
    tenantId: 'lib-staff', libraryId: 'lib-staff',
  });
  assert.equal((await trialIdentityUsed({ email: `${longLocal}@gmail.com` })).used, true);
  assert.equal((await trialIdentityUsed({ email: `${'c'.repeat(65)}@gmail.com` })).used, false);
});

test('deleting the library does not remove trial hashes', async () => {
  const r = await signup('delete.me@example.com');
  assert.equal(r.body.needsPayment, false);
  const me = (await call('GET', '/api/auth/me', { token: r.body.token })).body;
  const before = await TrialUsage.countDocuments();
  assert.ok(before > 0);
  await deleteLibraryData(me.user.tenantId);
  assert.equal(await Library.countDocuments({ libraryId: me.user.tenantId }), 0);
  assert.equal(await TrialUsage.countDocuments(), before);
  // Same email may request another code only after the one-per-minute window. The hash must still block a second trial.
  resetRateLimits();
  const again = await signup('delete.me@example.com');
  assert.equal(again.body.needsPayment, true);
  assert.equal(again.body.message, TRIAL_USED_MESSAGE);
});

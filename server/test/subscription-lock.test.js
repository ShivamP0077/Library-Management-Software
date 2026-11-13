// Locked libraries can only use the allowlist. Paying unlocks without deleting data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx, login } from './helpers.js';
import { Library, models } from '../src/models.js';
import { isRouteAllowedWhenLocked, LOCKED_ROUTE_ALLOWLIST } from '../src/subscriptionAccess.js';
import { creditWallet } from '../src/wallet.js';
import { setPaymentProvider } from '../src/billing.js';

before(async () => {
  await setup('sub_lock');
  assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: { planId: 'basic', name: 'Basic', priceMonthly: 500, public: true } })).status, 201);
  assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: { planId: 'pro', name: 'Pro', priceMonthly: 1000, public: true } })).status, 201);
  assert.equal((await call('PUT', '/api/admin/billing/config', { token: ctx.tokens.sa, body: { currency: 'INR', taxMode: 'none' } })).status, 200);
});
after(async () => { setPaymentProvider(null); await teardown(); });

const key = () => `idem-${Math.random().toString(36).slice(2)}`;

test('allowlist is explicit and isRouteAllowedWhenLocked is pure', () => {
  assert.ok(LOCKED_ROUTE_ALLOWLIST.length >= 8);
  assert.equal(isRouteAllowedWhenLocked('GET', '/api/students'), false);
  assert.equal(isRouteAllowedWhenLocked('POST', '/students'), false);
  assert.equal(isRouteAllowedWhenLocked('GET', '/api/payments'), false);
  assert.equal(isRouteAllowedWhenLocked('GET', '/api/seats'), false);
  assert.equal(isRouteAllowedWhenLocked('GET', '/api/reports/pnl'), false);
  assert.equal(isRouteAllowedWhenLocked('GET', '/api/whatsapp/status'), false);
  assert.equal(isRouteAllowedWhenLocked('GET', '/api/users'), false);
  assert.equal(isRouteAllowedWhenLocked('GET', '/api/enquiries'), false);
  assert.equal(isRouteAllowedWhenLocked('PUT', '/api/settings'), true);
  assert.equal(isRouteAllowedWhenLocked('GET', '/settings'), true);
  assert.equal(isRouteAllowedWhenLocked('POST', '/api/settings'), false);
  assert.equal(isRouteAllowedWhenLocked('GET', '/api/dashboard'), true);
  assert.equal(isRouteAllowedWhenLocked('POST', '/api/dashboard'), false);
  assert.equal(isRouteAllowedWhenLocked('GET', '/api/notifications/unread-count'), true);
  assert.equal(isRouteAllowedWhenLocked('POST', '/api/notifications/read-all'), false);
  assert.equal(isRouteAllowedWhenLocked('POST', '/api/software-plan/checkout'), true);
  assert.equal(isRouteAllowedWhenLocked('POST', '/api/subscription/renew'), true);
  assert.equal(isRouteAllowedWhenLocked('GET', '/api/account/profile'), true);
  assert.equal(isRouteAllowedWhenLocked('POST', '/api/support/tickets'), true);
  assert.equal(isRouteAllowedWhenLocked('POST', '/api/auth/change-password'), true);
  assert.equal(isRouteAllowedWhenLocked('POST', '/api/public/enquiry/abc'), true);
  assert.equal(isRouteAllowedWhenLocked('PUT', '/api/shifts/morning'), true);
  assert.equal(isRouteAllowedWhenLocked('DELETE', '/api/staffMembers/s1'), false);
});

test('expired library: allowlist only, staff locked, super admin not locked', async () => {
  await call('POST', '/api/students', { token: ctx.tokens.a, body: { id: 'KEEP1', name: 'Kept Student' } });
  await call('POST', '/api/users', { token: ctx.tokens.a, body: { email: 'staff-lock@test.local', name: 'Lock Staff', role: 'staff', password: 'StaffPass-123' } });
  const staff = await login('staff-lock@test.local', 'StaffPass-123');
  const oldEnd = new Date(Date.now() - 5 * 864e5);
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { planId: 'basic', subscription: {
    planId: 'basic', interval: 'month', status: 'expired', price: 500,
    currentPeriodStart: new Date(Date.now() - 35 * 864e5), currentPeriodEnd: oldEnd, startedAt: new Date(Date.now() - 35 * 864e5),
  } } });

  assert.equal((await call('GET', '/api/students', { token: ctx.tokens.a })).status, 402);
  assert.equal((await call('GET', '/api/students', { token: staff })).status, 402);
  assert.equal((await call('GET', '/api/payments', { token: ctx.tokens.a })).status, 402);
  assert.equal((await call('GET', '/api/whatsapp/status', { token: ctx.tokens.a })).status, 402);
  assert.equal((await call('POST', '/api/notifications/read-all', { token: ctx.tokens.a })).status, 402);
  assert.equal((await call('GET', '/api/notifications', { token: ctx.tokens.a })).status, 200);
  assert.equal((await call('GET', '/api/dashboard', { token: ctx.tokens.a })).body.students, 1);
  const saved = await call('PUT', '/api/settings', { token: ctx.tokens.a, body: { logo: 'LOGO', libraryName: 'Library A' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await call('GET', '/api/settings', { token: ctx.tokens.a })).body.logo, 'LOGO');
  assert.equal((await call('GET', '/api/subscription/summary', { token: ctx.tokens.a })).status, 200);

  const sa = await call('GET', '/api/students', { token: ctx.tokens.sa, headers: { 'X-Library-Id': 'lib-a' } });
  assert.equal(sa.status, 200, JSON.stringify(sa.body));
  assert.ok(sa.body.some(s => s.id === 'KEEP1'));
});

test('wallet renewal from expired starts now, keeps data, and unlocks', async () => {
  const oldEnd = new Date(Date.now() - 5 * 864e5);
  await creditWallet({ tenantId: 'lib-a', amountMinor: 50000, bucket: 'cash', reason: 'renew', source: 'test', idempotencyKey: key() });
  const before = await models.students.countDocuments({ tenantId: 'lib-a' });
  const r = await call('POST', '/api/subscription/renew', { token: ctx.tokens.a, headers: { 'Idempotency-Key': key() }, body: { useWallet: true } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.walletOnly, true);
  assert.equal(r.body.quote.historyType, 'renew');
  const sub = (await Library.findOne({ libraryId: 'lib-a' }).lean()).subscription;
  assert.equal(sub.status, 'active');
  assert.ok(new Date(sub.currentPeriodStart).getTime() > oldEnd.getTime());
  assert.ok(Math.abs(new Date(sub.currentPeriodStart).getTime() - Date.now()) < 60_000);
  const students = await call('GET', '/api/students', { token: ctx.tokens.a });
  assert.equal(students.status, 200);
  assert.equal(students.body.length, before);
  assert.ok(students.body.some(s => s.name === 'Kept Student'));
  const summary = (await call('GET', '/api/subscription/summary', { token: ctx.tokens.a })).body;
  assert.equal(summary.status, 'active');
  assert.equal(summary.planName, 'Basic');
  assert.equal(summary.billingCycle, 'month');
  assert.equal(summary.price, 500);
  assert.ok(summary.daysLeft >= 27);
  assert.equal(summary.locked, false);
});

test('early renewal continues from the current expiry; upgrade while open keeps that end', async () => {
  const oldEnd = new Date(Date.now() + 10 * 864e5);
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { subscription: {
    planId: 'basic', interval: 'month', status: 'active', price: 500,
    currentPeriodStart: new Date(Date.now() - 20 * 864e5), currentPeriodEnd: oldEnd, startedAt: new Date(Date.now() - 20 * 864e5),
  } } });
  await creditWallet({ tenantId: 'lib-a', amountMinor: 50000, bucket: 'cash', reason: 'early', source: 'test', idempotencyKey: key() });
  const early = await call('POST', '/api/subscription/renew-early', { token: ctx.tokens.a, headers: { 'Idempotency-Key': key() }, body: {} });
  assert.equal(early.status, 201, JSON.stringify(early.body));
  assert.equal(early.body.quote.historyType, 'early_renew');
  const sub = (await Library.findOne({ libraryId: 'lib-a' }).lean()).subscription;
  assert.equal(new Date(sub.currentPeriodStart).getTime(), oldEnd.getTime());
  const hist = (await call('GET', '/api/subscription/history', { token: ctx.tokens.a })).body;
  assert.ok(hist.items.some(i => i.type === 'early_renew' && i.plan === 'Basic' && i.status === 'paid'));

  await creditWallet({ tenantId: 'lib-a', amountMinor: 200000, bucket: 'cash', reason: 'upgrade', source: 'test', idempotencyKey: key() });
  const up = await call('POST', '/api/subscription/upgrade', { token: ctx.tokens.a, headers: { 'Idempotency-Key': key() }, body: { planId: 'pro', useWallet: true } });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.quote.historyType, 'upgrade');
  const after = (await Library.findOne({ libraryId: 'lib-a' }).lean()).subscription;
  assert.equal(after.planId, 'pro');
  assert.equal(new Date(after.currentPeriodEnd).getTime(), new Date(sub.currentPeriodEnd).getTime());
});

test('expired upgrade charges a full period that starts now', async () => {
  const oldEnd = new Date(Date.now() - 3 * 864e5);
  await Library.updateOne({ libraryId: 'lib-b' }, { $set: { planId: 'basic', subscription: {
    planId: 'basic', interval: 'month', status: 'expired', price: 500, currentPeriodEnd: oldEnd, startedAt: oldEnd,
  } } });
  await creditWallet({ tenantId: 'lib-b', amountMinor: 100000, bucket: 'cash', reason: 'switch', source: 'test', idempotencyKey: key() });
  const up = await call('POST', '/api/subscription/upgrade', { token: ctx.tokens.b, headers: { 'Idempotency-Key': key() }, body: { planId: 'pro' } });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.quote.historyType, 'upgrade');
  assert.equal(up.body.quote.changeType, 'new');
  assert.equal(up.body.quote.baseMinor, 100000);
  const sub = (await Library.findOne({ libraryId: 'lib-b' }).lean()).subscription;
  assert.equal(sub.status, 'active');
  assert.equal(sub.planId, 'pro');
  assert.ok(new Date(sub.currentPeriodStart).getTime() > oldEnd.getTime());
  assert.ok(new Date(sub.currentPeriodEnd).getTime() > Date.now());
});

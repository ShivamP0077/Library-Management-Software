// Issue #14: subscription lock, feature gate, staff limit on user-creation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { Library } from '../src/models.js';
import { accessFor, effectiveStatus, planHasFeature, featureKeys } from '../src/subscriptionAccess.js';

before(() => setup('sub_access'));
after(teardown);
const A = () => ctx.tokens.a;
const SA = () => ctx.tokens.sa;

test('effectiveStatus expires trials and ended periods', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  assert.equal(effectiveStatus({ status: 'trialing', trialEndsAt: '2026-11-01' }, now), 'expired');
  assert.equal(effectiveStatus({ status: 'trialing', trialEndsAt: '2026-11-10' }, now), 'trialing');
  assert.equal(effectiveStatus({ status: 'active', currentPeriodEnd: '2026-11-01', cancelAtPeriodEnd: true }, now), 'cancelled');
  assert.equal(effectiveStatus({ status: 'active', currentPeriodEnd: '2026-11-10' }, now), 'active');
  assert.equal(accessFor({ subscription: null }).ok, true, 'legacy libraries open');
  assert.equal(accessFor({ subscription: { status: 'pending_payment' } }).ok, false);
  assert.equal(accessFor({ subscription: { status: 'pending_payment' } }, { role: 'superadmin' }).ok, true);
});

test('plan features: empty = all; listed = only those', () => {
  assert.deepEqual(featureKeys(['WhatsApp Messages', 'Reports']), ['whatsapp_messages', 'reports']);
  assert.equal(planHasFeature({ features: [] }, 'whatsapp'), true);
  assert.equal(planHasFeature({ features: ['Receipts', 'Reports'] }, 'whatsapp'), false);
  assert.equal(planHasFeature({ features: ['WhatsApp'] }, 'whatsapp'), true);
  assert.equal(planHasFeature(null, 'whatsapp'), true);
});

test('pending_payment blocks reads and writes outside the allowlist', async () => {
  await call('POST', '/api/admin/plans', { token: SA(), body: { planId: 'locked', name: 'Locked', priceMonthly: 100, features: ['Receipts'] } });
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { planId: 'locked', subscription: { planId: 'locked', status: 'pending_payment', price: 100, interval: 'month' } } });

  const read = await call('GET', '/api/students', { token: A() });
  assert.equal(read.status, 402, 'reads locked');
  assert.equal(read.body.error, 'subscription_locked');
  assert.equal(read.body.code, 'SUBSCRIPTION_LOCKED');
  assert.equal(read.body.message, 'Your My Library OS plan has expired. Renew to continue.');
  const w = await call('POST', '/api/students', { token: A(), body: { id: 'LOCK1', name: 'Lock' } });
  assert.equal(w.status, 402, JSON.stringify(w.body));
  assert.equal(w.body.code, 'SUBSCRIPTION_LOCKED');

  assert.equal((await call('GET', '/api/subscription', { token: A() })).status, 200, 'subscription still readable');
  // Changing to a free plan must still work while locked (escape hatch).
  await call('POST', '/api/admin/plans', { token: SA(), body: { planId: 'free14', name: 'Free14', priceMonthly: 0, public: true, active: true } });
  const ch = await call('POST', '/api/subscription/change', { token: A(), body: { planId: 'free14' } });
  assert.equal(ch.status, 200, JSON.stringify(ch.body));
  assert.equal((await call('POST', '/api/students', { token: A(), body: { id: 'LOCK2', name: 'Ok' } })).status, 201, 'unlocked after free plan');
});

test('expired trial is persisted and blocks writes', async () => {
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { planId: 'locked', subscription: { planId: 'locked', status: 'trialing', trialEndsAt: new Date(Date.now() - 864e5), currentPeriodEnd: new Date(Date.now() - 864e5), price: 0, interval: 'month' } } });
  const me = await call('GET', '/api/auth/me', { token: A() });
  assert.equal(me.status, 200);
  assert.equal(me.body.subscriptionAccess.ok, false);
  assert.equal(me.body.subscriptionAccess.locked, true);
  assert.equal(me.body.subscriptionAccess.status, 'expired');
  assert.deepEqual(me.body.subscriptionAccess.allowedSections, ['dashboard', 'settings', 'profile']);
  assert.equal((await Library.findOne({ libraryId: 'lib-a' }).lean()).subscription.status, 'expired');
  assert.equal((await call('POST', '/api/students', { token: A(), body: { id: 'LOCK3', name: 'Nope' } })).status, 402);
});

test('feature gate blocks WhatsApp when plan omits it', async () => {
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { planId: 'locked', subscription: { planId: 'locked', status: 'active', price: 100, interval: 'month', currentPeriodEnd: new Date(Date.now() + 30 * 864e5) } } });
  const r = await call('GET', '/api/whatsapp/status', { token: A() });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, 'feature_not_in_plan');
});

test('POST /users enforces staffLimit', async () => {
  await call('PATCH', '/api/admin/plans/locked', { token: SA(), body: { staffLimit: 0 } }); // 0 → unlimited in planInput… use 1
  await call('PATCH', '/api/admin/plans/locked', { token: SA(), body: { staffLimit: 1 } });
  // Clear leftover staff from other tests by using lib-b
  await call('PATCH', '/api/admin/libraries/lib-b', { token: SA(), body: { planId: 'locked' } });
  await Library.updateOne({ libraryId: 'lib-b' }, { $set: { subscription: { planId: 'locked', status: 'active', currentPeriodEnd: new Date(Date.now() + 864e5) } } });
  const u1 = await call('POST', '/api/users', { token: ctx.tokens.b, body: { email: 'staffb1@test.local', name: 'B1', role: 'staff', password: 'StaffPass-123' } });
  assert.equal(u1.status, 201, JSON.stringify(u1.body));
  const u2 = await call('POST', '/api/users', { token: ctx.tokens.b, body: { email: 'staffb2@test.local', name: 'B2', role: 'staff', password: 'StaffPass-123' } });
  assert.equal(u2.status, 409, JSON.stringify(u2.body));
  assert.equal(u2.body.code, 'staff_limit');
});

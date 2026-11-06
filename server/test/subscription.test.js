// Issue #19: My Subscription (no payment provider connected).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { Library } from '../src/models.js';
import { setPaymentProvider } from '../src/billing.js';
import { overLimits } from '../src/subscription.js';

before(() => setup('subscription'));
after(teardown);
const A = () => ctx.tokens.a;
const mk = (body) => call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: { public: true, active: true, ...body } });

test('overLimits', () => {
  assert.deepEqual(overLimits({ studentLimit: 2 }, { students: 3, staff: 0, branches: 0 }), [{ kind: 'students', limit: 2, used: 3 }]);
  assert.deepEqual(overLimits({ studentLimit: null, staffLimit: 5 }, { students: 900, staff: 5, branches: 1 }), []);
});

test('view: plan, usage, empty invoices, payments disabled; owner only', async () => {
  await mk({ planId: 'free', name: 'Free', priceMonthly: 0, studentLimit: 50 });
  await mk({ planId: 'pro', name: 'Pro', priceMonthly: 999, priceYearly: 9990 });
  await mk({ planId: 'tiny', name: 'Tiny', priceMonthly: 0, studentLimit: 1 });
  const v = await call('GET', '/api/subscription', { token: A() });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.paymentsEnabled, false); assert.deepEqual(v.body.invoices, []);
  assert.equal(v.body.plan, null); assert.equal(typeof v.body.usage.students, 'number');
  assert.ok(v.body.plans.some(p => p.planId === 'pro'));
  assert.equal((await call('GET', '/api/subscription')).status, 401);
});

test('free plan switch works; paid upgrade says payments not set up; nothing changes', async () => {
  const f = await call('POST', '/api/subscription/change', { token: A(), body: { planId: 'free' } });
  assert.equal(f.status, 200, JSON.stringify(f.body)); assert.equal(f.body.plan.planId, 'free'); assert.equal(f.body.subscription.status, 'active');
  const p = await call('POST', '/api/subscription/change', { token: A(), body: { planId: 'pro', interval: 'year' } });
  assert.equal(p.status, 402); assert.equal(p.body.code, 'payments_not_configured');
  assert.equal((await Library.findOne({ libraryId: 'lib-a' }).lean()).planId, 'free');
  assert.equal((await call('POST', '/api/subscription/change', { token: A(), body: { planId: 'nope' } })).status, 400);
  assert.equal((await call('POST', '/api/subscription/change', { token: A(), body: { planId: 'free' } })).status, 400);
});

test('a configured provider creates a tenant-bound invoice for a paid upgrade', async () => {
  await call('PUT', '/api/admin/billing/config', { token: ctx.tokens.sa, body: { currency: 'INR', taxMode: 'none', taxRatePct: null } });
  setPaymentProvider({ name: 'fake', createCheckout: async ({ library, invoiceId }) => ({ url: 'https://checkout.test/' + invoiceId, reference: 'test:' + library.libraryId + ':' + invoiceId, invoiceId }), cancel: async () => {} });
  try {
    const r = await call('POST', '/api/subscription/change', { token: A(), body: { planId: 'pro' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.checkout.amountMinor, 99900);
    assert.ok(r.body.checkout.reference.startsWith('test:lib-a:'));
    assert.ok((await Library.findOne({ libraryId: 'lib-a' }).lean()).subscription.planId !== 'pro');
  } finally { setPaymentProvider(null); }
});

test('downgrade blocked when usage exceeds the target plan', async () => {
  for (const id of ['s1', 's2']) assert.equal((await call('POST', '/api/students', { token: A(), body: { id, name: id } })).status, 201);
  const r = await call('POST', '/api/subscription/change', { token: A(), body: { planId: 'tiny' } });
  if (r.status !== 409) assert.fail('expected 409 got ' + r.status + ' ' + JSON.stringify(r.body));
  assert.equal(r.body.code, 'over_limit');
});

test('paid active period: downgrade is scheduled, not immediate; cancel/resume', async () => {
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { planId: 'pro', subscription: { planId: 'pro', interval: 'month', price: 999, status: 'active', currentPeriodEnd: new Date(Date.now() + 10 * 864e5) } } });
  const d = await call('POST', '/api/subscription/change', { token: A(), body: { planId: 'free' } });
  assert.equal(d.status, 200, JSON.stringify(d.body)); assert.equal(d.body.plan.planId, 'pro'); assert.equal(d.body.subscription.pendingPlanId, 'free');
  const c = await call('POST', '/api/subscription/cancel', { token: A() });
  assert.equal(c.body.subscription.cancelAtPeriodEnd, true); assert.equal(c.body.subscription.pendingPlanId, null);
  assert.equal((await call('POST', '/api/subscription/cancel', { token: A(), body: { resume: true } })).body.subscription.cancelAtPeriodEnd, false);
});

test('deletion is only a request: needs exact name, deletes nothing, visible to super admin', async () => {
  assert.equal((await call('POST', '/api/subscription/deletion-request', { token: A(), body: { confirmName: 'wrong' } })).status, 400);
  const r = await call('POST', '/api/subscription/deletion-request', { token: A(), body: { confirmName: 'Library A', reason: 'Closing' } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.deletionRequest.reason, 'Closing');
  assert.ok(await Library.exists({ libraryId: 'lib-a' }));
  const libs = (await call('GET', '/api/admin/libraries', { token: ctx.tokens.sa })).body;
  const a = libs.find(l => l.libraryId === 'lib-a');
  assert.equal(a.deletionRequest.by, 'admin-a@test.local'); assert.equal(a.billing.planId, 'pro');
  const sum = (await call('GET', '/api/admin/saas-summary', { token: ctx.tokens.sa })).body.list.find(l => l.libraryId === 'lib-a');
  assert.equal(sum.subscription, 'Pro (active)'); assert.equal(sum.paymentStatus, 'active'); assert.ok(sum.expiry); assert.equal(sum.deletionRequested, true);
  assert.equal((await call('DELETE', '/api/subscription/deletion-request', { token: A() })).body.deletionRequest, null);
});

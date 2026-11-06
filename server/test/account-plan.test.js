// Issue #19: billing config, wallet ordering/expiry, split payments, referrals, plan changes.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx, login } from './helpers.js';
import { Library } from '../src/models.js';
import { PlatformBillingConfig, getBillingConfig } from '../src/billingConfig.js';
import { Wallet, WalletLedger, WalletHold, WalletTopup, Referral, ReferralCampaign, OfferRedemption } from '../src/commerce.js';
import { SoftwareInvoice } from '../src/payments/invoices.js';
import { creditWallet, walletSnapshot } from '../src/wallet.js';
import { setPaymentProvider } from '../src/billing.js';

// Opt in to the NODE_ENV=test-only settle/fail helpers even when run directly with `node --test`.
process.env.NODE_ENV = 'test';

const keys = () => `idem-${Math.random().toString(36).slice(2)}`;
const providerCalls = [];
const resetTenant = async (tenantId) => {
  await Promise.all([
    Wallet.deleteMany({ tenantId }), WalletLedger.deleteMany({ tenantId }), WalletHold.deleteMany({ tenantId }),
    WalletTopup.deleteMany({ tenantId }), SoftwareInvoice.deleteMany({ tenantId }), OfferRedemption.deleteMany({ tenantId }),
    Referral.deleteMany({ $or: [{ referrerTenantId: tenantId }, { referredTenantId: tenantId }] }), ReferralCampaign.deleteMany({}),
  ]);
  await Library.updateOne({ libraryId: tenantId }, { $set: { planId: null }, $unset: { subscription: 1 } });
};
const configure = (body) => call('PUT', '/api/admin/billing/config', { token: ctx.tokens.sa, body });

before(async () => {
  await setup('account-plan');
  for (const p of [
    { name: 'Basic', priceMonthly: 500, priceYearly: 5000 },
    { name: 'Pro', priceMonthly: 1000, priceYearly: 10000 },
  ]) assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: p })).status, 201);
});
after(async () => { setPaymentProvider(null); await teardown(); });
beforeEach(async () => {
  providerCalls.length = 0;
  await PlatformBillingConfig.deleteOne({ _id: 'default' });
  await resetTenant('lib-a'); await resetTenant('lib-b');
  setPaymentProvider({ name: 'fake', createCheckout: async (args) => { providerCalls.push(args); return { url: 'https://pay.test/checkout', reference: `fake_${providerCalls.length}` }; } });
});

test('PLAN: no default tax; conscious config is required before activation', async () => {
  const cfg = await getBillingConfig();
  assert.equal(cfg.taxMode, null);
  assert.equal(cfg.taxRatePct, null);
  const quote = (await call('POST', '/api/software-plan/quote', { token: ctx.tokens.a, body: { planId: 'basic' } })).body;
  assert.equal(quote.ready, false);
  assert.equal(quote.currency, 'INR');
  assert.equal((await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.a, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic' } })).body.code, 'billing_not_configured');
  assert.equal(await SoftwareInvoice.countDocuments({ tenantId: 'lib-a' }), 0);

  const saved = (await configure({ currency: 'INR', taxMode: 'none' })).body;
  assert.equal(saved.configured, true);
  assert.equal(saved.taxMode, 'none');
  const ready = (await call('POST', '/api/software-plan/quote', { token: ctx.tokens.a, body: { planId: 'basic' } })).body;
  assert.equal(ready.ready, true);
});

test('PLAN: GST included/excluded uses the configured rate and integer rounding', async () => {
  await configure({ currency: 'INR', taxMode: 'excluded', taxRatePct: 18 });
  let q = (await call('POST', '/api/software-plan/quote', { token: ctx.tokens.a, body: { planId: 'basic' } })).body;
  assert.equal(q.baseMinor, 50000);
  assert.equal(q.taxMinor, 9000);
  assert.equal(q.totalMinor, 59000);
  await configure({ taxMode: 'included', taxRatePct: 18 });
  q = (await call('POST', '/api/software-plan/quote', { token: ctx.tokens.a, body: { planId: 'basic' } })).body;
  assert.equal(q.totalMinor, 50000);
  assert.equal(q.taxMinor, 7627);
  assert.equal(Number.isInteger(q.taxMinor), true);
});

test('PLAN: wallet spends soonest-expiring bonus first, then oldest cash; wallet-only is providerless and idempotent', async () => {
  await configure({ taxMode: 'none' });
  const now = Date.now();
  await creditWallet({ tenantId: 'lib-a', amountMinor: 30000, bucket: 'bonus', expiresAt: new Date(now + 864e5), reason: 'early bonus', source: 'test' });
  await creditWallet({ tenantId: 'lib-a', amountMinor: 20000, bucket: 'bonus', expiresAt: new Date(now + 30 * 864e5), reason: 'late bonus', source: 'test' });
  await creditWallet({ tenantId: 'lib-a', amountMinor: 50000, bucket: 'cash', reason: 'cash', source: 'test' });
  const key = keys();
  const done = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.a, headers: { 'Idempotency-Key': key }, body: { planId: 'pro' } });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.walletOnly, true);
  assert.equal(done.body.invoice.status, 'paid');
  assert.equal(done.body.invoice.walletMinor, 100000);
  assert.equal(done.body.invoice.gatewayMinor, 0);
  assert.equal(providerCalls.length, 0, 'full wallet payment never calls the gateway');
  assert.equal((await walletSnapshot('lib-a')).availableMinor, 0);
  assert.equal((await walletSnapshot('lib-b')).availableMinor, 0, 'tenant isolation');

  const debits = await WalletHold.findOne({ invoiceId: done.body.invoice.invoiceId }).lean();
  const expectedCredits = [];
  for (const [reason, bucket] of [['early bonus', 'bonus'], ['late bonus', 'bonus'], ['cash', 'cash']]) {
    expectedCredits.push(await WalletLedger.findOne({ tenantId: 'lib-a', kind: 'credit', bucket, reason }).lean());
  }
  assert.deepEqual(debits.allocations.map(a => a.entryId), expectedCredits.map(c => c.entryId), 'earliest absolute bonus expiry, then cash');
  assert.deepEqual(debits.allocations.map(a => [a.bucket, a.amountMinor]), [['bonus', 30000], ['bonus', 20000], ['cash', 50000]]);
  const lib = await Library.findOne({ libraryId: 'lib-a' }).lean();
  assert.equal(lib.planId, 'pro');
  assert.equal(lib.subscription.status, 'active');

  const replay = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.a, headers: { 'Idempotency-Key': key }, body: { planId: 'pro' } });
  assert.equal(replay.body.replay, true);
  assert.equal(await WalletLedger.countDocuments({ tenantId: 'lib-a', kind: 'debit' }), 3);
});

test('PLAN: partial wallet charges only the gateway remainder; failure releases hold; late failure after success is ignored', async () => {
  await configure({ taxMode: 'none' });
  await creditWallet({ tenantId: 'lib-b', amountMinor: 20000, bucket: 'cash', reason: 'cash', source: 'test' });
  const first = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.b, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic' } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.invoice.walletMinor, 20000);
  assert.equal(first.body.invoice.gatewayMinor, 30000);
  assert.equal(first.body.checkout.amountMinor, 30000);
  assert.equal(providerCalls[0].amount, 300);
  const held = await WalletHold.findOne({ invoiceId: first.body.invoice.invoiceId }).lean();
  assert.equal(held.status, 'held');
  assert.equal((await walletSnapshot('lib-b')).availableMinor, 0);

  const failed = await call('POST', `/api/software-plan/invoices/${first.body.invoice.invoiceId}/test-fail`, { token: ctx.tokens.b, body: {} });
  assert.equal(failed.status, 200);
  assert.equal((await walletSnapshot('lib-b')).availableMinor, 20000);
  assert.equal((await Library.findOne({ libraryId: 'lib-b' }).lean()).subscription, undefined);

  const second = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.b, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic' } });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const settle = await call('POST', `/api/software-plan/invoices/${second.body.invoice.invoiceId}/test-settle`, { token: ctx.tokens.b, body: { gatewayMinor: 30000 } });
  assert.equal(settle.status, 200, JSON.stringify(settle.body));
  assert.equal(settle.body.status, 'paid');
  assert.equal((await walletSnapshot('lib-b')).availableMinor, 0);
  const lib = await Library.findOne({ libraryId: 'lib-b' }).lean();
  assert.equal(lib.subscription.status, 'active');
  assert.equal(lib.subscription.planId, 'basic');

  const again = await call('POST', `/api/software-plan/invoices/${second.body.invoice.invoiceId}/test-settle`, { token: ctx.tokens.b, body: { gatewayMinor: 30000 } });
  assert.equal(again.body.already, true);
  assert.equal(await WalletLedger.countDocuments({ tenantId: 'lib-b', kind: 'debit' }), 1, 'no double debit');
  const lateFail = await call('POST', `/api/software-plan/invoices/${second.body.invoice.invoiceId}/test-fail`, { token: ctx.tokens.b, body: {} });
  assert.equal(lateFail.body.alreadyPaid, true);
  assert.equal((await SoftwareInvoice.findOne({ invoiceId: second.body.invoice.invoiceId }).lean()).status, 'paid');
});

test('PLAN: fully wallet-funded subscription qualifies a referral; campaigns are SA-controlled', async () => {
  await configure({ taxMode: 'none' });
  const c = await call('POST', '/api/admin/referral-campaigns', { token: ctx.tokens.sa, body: { name: 'Launch', rewardMinor: 10000, rewardBucket: 'bonus' } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  await Library.updateOne({ libraryId: 'lib-b' }, { $set: { referralCode: 'LIB-REF' } });
  await Referral.create({ referralId: 'ref_test_1', code: 'LIB-REF', referrerTenantId: 'lib-b', referredTenantId: 'lib-a', status: 'pending' });
  await creditWallet({ tenantId: 'lib-a', amountMinor: 50000, bucket: 'cash', reason: 'cash', source: 'test' });
  const done = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.a, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic' } });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.invoice.status, 'paid');
  const ref = await Referral.findOne({ referralId: 'ref_test_1' }).lean();
  assert.equal(ref.status, 'credited');
  assert.equal(ref.rewardMinor, 10000);
  assert.equal((await walletSnapshot('lib-b')).bonusMinor, 10000);
});

test('PLAN: upgrade prorates the unused period; downgrade is scheduled with no charge or refund', async () => {
  await configure({ taxMode: 'none' });
  const now = Date.now();
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: {
    planId: 'basic',
    subscription: { planId: 'basic', interval: 'month', status: 'active', price: 500, startedAt: new Date(now - 10 * 864e5), currentPeriodEnd: new Date(now + 20 * 864e5) },
  } });
  const quote = (await call('POST', '/api/software-plan/quote', { token: ctx.tokens.a, body: { planId: 'pro' } })).body;
  assert.equal(quote.changeType, 'upgrade');
  assert.ok(quote.baseMinor > 0 && quote.baseMinor < 50000, `prorated amount was ${quote.baseMinor}`);
  await creditWallet({ tenantId: 'lib-a', amountMinor: quote.totalMinor, bucket: 'cash', reason: 'upgrade cash', source: 'test' });
  const periodEnd = (await Library.findOne({ libraryId: 'lib-a' }).lean()).subscription.currentPeriodEnd;
  const up = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.a, headers: { 'Idempotency-Key': keys() }, body: { planId: 'pro' } });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const afterUp = await Library.findOne({ libraryId: 'lib-a' }).lean();
  assert.equal(afterUp.planId, 'pro');
  assert.equal(new Date(afterUp.subscription.currentPeriodEnd).toISOString(), new Date(periodEnd).toISOString(), 'upgrade keeps the paid period end');

  const walletBefore = (await walletSnapshot('lib-a')).availableMinor;
  const invoicesBefore = await SoftwareInvoice.countDocuments({ tenantId: 'lib-a' });
  const down = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.a, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic' } });
  assert.equal(down.status, 200, JSON.stringify(down.body));
  assert.equal(down.body.changeType, 'downgrade');
  assert.equal((await walletSnapshot('lib-a')).availableMinor, walletBefore);
  assert.equal(await SoftwareInvoice.countDocuments({ tenantId: 'lib-a' }), invoicesBefore, 'downgrade creates no invoice');
  const scheduled = await Library.findOne({ libraryId: 'lib-a' }).lean();
  assert.equal(scheduled.planId, 'pro');
  assert.equal(scheduled.subscription.pendingPlanId, 'basic');
});

test('PLAN: top-ups credit only after verified settlement, once', async () => {
  await configure({ taxMode: 'none' });
  const start = await call('POST', '/api/software-plan/wallet/topups', { token: ctx.tokens.b, headers: { 'Idempotency-Key': keys() }, body: { amountMinor: 12345 } });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  assert.equal(start.body.checkout.amountMinor, 12345);
  assert.equal((await walletSnapshot('lib-b')).cashMinor, 0);
  await call('POST', `/api/software-plan/invoices/${start.body.invoiceId}/test-settle`, { token: ctx.tokens.b, body: { gatewayMinor: 12345 } });
  assert.equal((await walletSnapshot('lib-b')).cashMinor, 12345);
  await call('POST', `/api/software-plan/invoices/${start.body.invoiceId}/test-settle`, { token: ctx.tokens.b, body: { gatewayMinor: 12345 } });
  assert.equal((await walletSnapshot('lib-b')).cashMinor, 12345);
  const top = await WalletTopup.findOne({ tenantId: 'lib-b' }).lean();
  assert.equal(top.status, 'paid');
});

// Owners cannot self-declare read-only; staff lack financial access; a Super Admin's
// explicit read-only drill-in must never create financial records.
test('PLAN: financial writes are rejected for staff and superadmin read-only sessions', async () => {
  await configure({ taxMode: 'none' });
  await call('POST', '/api/users', { token: ctx.tokens.a, body: { email: 'staff-finance@test.local', password: 'StaffFinance-123', role: 'staff' } });
  const staff = await login('staff-finance@test.local', 'StaffFinance-123');
  for (const token of [staff, ctx.tokens.sa]) {
    const headers = { 'Idempotency-Key': keys(), ...(token === ctx.tokens.sa ? { 'X-Library-Id': 'lib-a', 'X-Read-Only': '1' } : {}) };
    const before = await SoftwareInvoice.countDocuments({ tenantId: 'lib-a' });
    const c = await call('POST', '/api/software-plan/checkout', { token, headers, body: { planId: 'basic' } });
    assert.equal(c.status, 403, JSON.stringify(c.body));
    const t = await call('POST', '/api/software-plan/wallet/topups', { token, headers: { ...headers, 'Idempotency-Key': keys() }, body: { amountMinor: 12345 } });
    assert.equal(t.status, 403, JSON.stringify(t.body));
    assert.equal(await SoftwareInvoice.countDocuments({ tenantId: 'lib-a' }), before);
  }
});

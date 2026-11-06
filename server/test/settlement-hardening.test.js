// Isolated hardening: settlement concurrency, provider-ref null guards, owner-only plan routes,
// referralCode from lib.referralCode, and single software receipt delivery. Synthetic mocks only.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { Library, User } from '../src/models.js';
import { PlatformBillingConfig } from '../src/billingConfig.js';
import { Wallet, WalletLedger, WalletHold, Referral, ReferralCampaign, OfferRedemption } from '../src/commerce.js';
import { SoftwareInvoice } from '../src/payments/invoices.js';
import { settleInvoice, deliverSoftwareReceipt } from '../src/payments/settlement.js';
import { creditWallet, holdWallet, walletSnapshot } from '../src/wallet.js';
import { setPaymentProvider } from '../src/billing.js';
import { hashPassword } from '../src/services.js';
import { signToken } from '../src/auth.js';
import { outbox } from '../src/mailer.js';

// validateFinancials is not exported — exercise via settleInvoice instead.

const keys = () => `idem-${Math.random().toString(36).slice(2)}`;
const resetTenant = async (tenantId) => {
  await Promise.all([
    Wallet.deleteMany({ tenantId }), WalletLedger.deleteMany({ tenantId }), WalletHold.deleteMany({ tenantId }),
    SoftwareInvoice.deleteMany({ tenantId }), OfferRedemption.deleteMany({ tenantId }),
    Referral.deleteMany({ $or: [{ referrerTenantId: tenantId }, { referredTenantId: tenantId }] }),
  ]);
  await Library.updateOne({ libraryId: tenantId }, { $set: { planId: null }, $unset: { subscription: 1 } });
};

before(async () => {
  await setup('settlement-hardening');
  for (const p of [
    { name: 'Basic', priceMonthly: 500, priceYearly: 5000 },
    { name: 'Pro', priceMonthly: 1000, priceYearly: 10000 },
  ]) assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: p })).status, 201);
});
after(async () => { setPaymentProvider(null); await teardown(); });
beforeEach(async () => {
  await PlatformBillingConfig.deleteOne({ _id: 'default' });
  await ReferralCampaign.deleteMany({});
  await resetTenant('lib-a'); await resetTenant('lib-b');
  await call('PUT', '/api/admin/billing/config', { token: ctx.tokens.sa, body: { currency: 'INR', taxMode: 'none' } });
  setPaymentProvider({
    name: 'fake',
    createCheckout: async () => ({ url: 'https://pay.test/checkout', reference: `fake_${Date.now()}` }),
  });
});

test('SETTLE: concurrent settleInvoice with delayed Library.updateOne never double-captures, refers, or entitles', async () => {
  await call('POST', '/api/admin/referral-campaigns', {
    token: ctx.tokens.sa, body: { name: 'Race', rewardMinor: 10000, rewardBucket: 'bonus' },
  });
  await Library.updateOne({ libraryId: 'lib-b' }, { $set: { referralCode: 'LIB-RACE' } });
  await Referral.create({
    referralId: 'ref_race_1', code: 'LIB-RACE', referrerTenantId: 'lib-b', referredTenantId: 'lib-a', status: 'pending',
  });
  await creditWallet({ tenantId: 'lib-a', amountMinor: 50000, bucket: 'cash', reason: 'cash', source: 'test' });
  const hold = await holdWallet({ tenantId: 'lib-a', amountMinor: 50000, purpose: 'race', invoiceId: 'inv_race' });
  await SoftwareInvoice.create({
    invoiceId: 'inv_race', tenantId: 'lib-a', kind: 'subscription', planId: 'basic', interval: 'month',
    amount: 500, totalMinor: 50000, baseMinor: 50000, walletMinor: 50000, gatewayMinor: 0,
    discountMinor: 0, taxMinor: 0, currency: 'INR', status: 'open', holdId: hold.holdId,
  });
  await WalletHold.updateOne({ holdId: hold.holdId }, { $set: { invoiceId: 'inv_race' } });

  const originalUpdate = Library.updateOne.bind(Library);
  let releaseGate;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  let hitUpdate;
  const hit = new Promise((resolve) => { hitUpdate = resolve; });
  let updateCalls = 0;
  Library.updateOne = async function patchedUpdateOne(...args) {
    // Only gate entitlement writes for lib-a during this race.
    const filter = args[0] || {};
    if (filter.libraryId === 'lib-a' && args[1]?.$set?.subscription) {
      updateCalls += 1;
      hitUpdate();
      await gate;
    }
    return originalUpdate(...args);
  };

  try {
    const opts = { providerRef: 'wallet:race', gatewayMinor: 0, source: 'wallet' };
    const first = settleInvoice('inv_race', opts);
    await hit; // first settle is inside Library.updateOne
    const second = settleInvoice('inv_race', opts);
    // Give the second a moment to contend while first still holds the gate.
    await new Promise((r) => setTimeout(r, 30));
    releaseGate();
    const [r1, r2] = await Promise.all([first, second]);
    // Delay is after markPaid, so the contender should see paid/already — never a silent inProgress success.
    assert.ok(r1.ok || r2.ok, JSON.stringify({ r1, r2 }));
    assert.ok((r1.ok && r1.status === 'paid') || (r2.ok && r2.status === 'paid'));
    const loser = r1.status === 'paid' && !r1.already ? r2 : r1;
    assert.ok(loser.already || loser.status === 'paid' || (loser.ok === false && loser.inProgress),
      `contender must be already/paid or honest inProgress failure, got ${JSON.stringify(loser)}`);

    const debits = await WalletLedger.countDocuments({ tenantId: 'lib-a', kind: 'debit', holdId: hold.holdId });
    // Capture writes one debit ledger row per allocation entry; cash-only hold => 1.
    assert.equal(debits, 1, 'wallet capture must not double');
    const holdDoc = await WalletHold.findOne({ holdId: hold.holdId }).lean();
    assert.equal(holdDoc.status, 'captured');

    const refs = await Referral.find({ referralId: 'ref_race_1' }).lean();
    assert.equal(refs.length, 1);
    assert.equal(refs[0].status, 'credited');
    assert.equal(await WalletLedger.countDocuments({ tenantId: 'lib-b', source: 'referral' }), 1, 'referral credited once');

    const lib = await Library.findOne({ libraryId: 'lib-a' }).lean();
    assert.equal(lib.subscription?.status, 'active');
    assert.equal(lib.planId, 'basic');
    assert.equal(updateCalls, 1, 'Library entitlement written once');

    const inv = await SoftwareInvoice.findOne({ invoiceId: 'inv_race' }).lean();
    assert.equal(inv.status, 'paid');
  } finally {
    Library.updateOne = originalUpdate;
  }
});

test('SETTLE: providerRef guard rejects null/mismatched event refs when invoice has a stored ref', async () => {
  await SoftwareInvoice.create({
    invoiceId: 'inv_pref', tenantId: 'lib-a', kind: 'subscription', planId: 'basic', interval: 'month',
    amount: 500, totalMinor: 50000, baseMinor: 50000, walletMinor: 0, gatewayMinor: 50000,
    currency: 'INR', status: 'open', provider: 'razorpay', providerRef: 'order_stored_1',
  });
  const missing = await settleInvoice('inv_pref', {
    provider: 'razorpay', currency: 'INR', source: 'razorpay', gatewayMinor: 50000,
    providerRef: null, providerOrderRef: null,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'amount_or_provider_mismatch');
  assert.match(String(missing.invoice?.failureReason || ''), /provider_reference_mismatch/);

  const wrong = await settleInvoice('inv_pref', {
    provider: 'razorpay', currency: 'INR', source: 'razorpay', gatewayMinor: 50000,
    providerRef: 'pay_other', providerOrderRef: 'order_other',
  });
  assert.equal(wrong.ok, false);
  assert.match(String(wrong.invoice?.failureReason || ''), /provider_reference_mismatch/);

  // Matching stored order ref is accepted (synthetic — no live provider).
  const ok = await settleInvoice('inv_pref', {
    provider: 'razorpay', currency: 'INR', source: 'razorpay', gatewayMinor: 50000,
    providerRef: 'pay_1', providerOrderRef: 'order_stored_1',
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.invoice.status, 'paid');
});

test('OWNER: staff cannot access software-plan routes; owner can', async () => {
  const staff = await User.create({
    email: 'plan.staff@test.local', name: 'Plan Staff', role: 'staff', tenantId: 'lib-a', libraryId: 'lib-a',
    emailVerified: true, passwordHash: await hashPassword('Staff-Pass-123'), authProviders: ['email', 'password'],
  });
  const staffToken = signToken(staff);
  for (const [method, path, body] of [
    ['GET', '/api/software-plan', undefined],
    ['POST', '/api/software-plan/quote', { planId: 'basic' }],
    ['GET', '/api/software-plan/referrals', undefined],
    ['GET', '/api/software-plan/wallet', undefined],
  ]) {
    const denied = await call(method, path, { token: staffToken, body });
    assert.equal(denied.status, 403, `${method} ${path} => ${denied.status}`);
  }
  const owner = await call('GET', '/api/software-plan', { token: ctx.tokens.a });
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
});

test('REFERRAL: software-plan summary exposes lib.referralCode, not referred-by referral.code', async () => {
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { referralCode: 'LIB-OWNERA' } });
  await Library.updateOne({ libraryId: 'lib-b' }, { $set: { referralCode: 'LIB-OWNERB' } });
  await Referral.create({
    referralId: 'ref_sum_1', code: 'LIB-OWNERB', referrerTenantId: 'lib-b', referredTenantId: 'lib-a', status: 'pending',
  });
  const summary = await call('GET', '/api/software-plan', { token: ctx.tokens.a });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.referralCode, 'LIB-OWNERA');
  assert.equal(summary.body.referral.code, 'LIB-OWNERA', 'Refer & Earn must show the library own code');
  assert.equal(summary.body.referral.referredBy.code, 'LIB-OWNERB');
  const list = await call('GET', '/api/software-plan/referrals', { token: ctx.tokens.a });
  assert.equal(list.body.code, 'LIB-OWNERA');
});

test('RECEIPT: paid settlement delivers/logs exactly one software receipt (synthetic outbox, no live SMS)', async () => {
  await creditWallet({ tenantId: 'lib-b', amountMinor: 50000, bucket: 'cash', reason: 'cash', source: 'test' });
  const before = outbox.length;
  const done = await call('POST', '/api/software-plan/checkout', {
    token: ctx.tokens.b, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic' },
  });
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal(done.body.invoice.status, 'paid');
  const invId = done.body.invoice.invoiceId;
  const inv = await SoftwareInvoice.findOne({ invoiceId: invId }).lean();
  assert.ok(inv.receiptDelivery, 'receipt delivery recorded');
  assert.ok(['sent', 'logged'].includes(inv.receiptDelivery.status), inv.receiptDelivery.status);
  assert.equal(inv.receiptDelivery.attempts, 1);
  assert.ok(outbox.length > before, 'receipt captured in synthetic mail outbox');
  assert.ok(outbox.some((m) => /payment receipt/i.test(m.subject) && String(m.text || '').includes(inv.receiptNo)));

  const again = await deliverSoftwareReceipt(invId);
  assert.equal(again.already, true);
  const after = await SoftwareInvoice.findOne({ invoiceId: invId }).lean();
  assert.equal(after.receiptDelivery.attempts, 1, 'second deliver is a no-op');

  // Owner resend is an explicit, real new attempt (force), recorded before send then finalised.
  const resend = await call('POST', `/api/software-plan/invoices/${invId}/receipt/deliver`, { token: ctx.tokens.b });
  assert.equal(resend.status, 200, JSON.stringify(resend.body));
  assert.equal(resend.body.status, 'logged');
  const afterResend = await SoftwareInvoice.findOne({ invoiceId: invId }).lean();
  assert.equal(afterResend.receiptDelivery.attempts, 2);
  assert.equal(afterResend.receiptDelivery.history.at(-1).trigger, 'owner_resend');
  assert.equal(afterResend.receiptDelivery.history.at(-1).status, 'logged');
});

test('SETTLE: live settling claim returns ok:false inProgress (not success); stale reclaim retries idempotently', async () => {
  await creditWallet({ tenantId: 'lib-a', amountMinor: 50000, bucket: 'cash', reason: 'cash', source: 'test' });
  const hold = await holdWallet({ tenantId: 'lib-a', amountMinor: 50000, purpose: 'stuck', invoiceId: 'inv_stuck' });
  await SoftwareInvoice.create({
    invoiceId: 'inv_stuck', tenantId: 'lib-a', kind: 'subscription', planId: 'basic', interval: 'month',
    amount: 500, totalMinor: 50000, baseMinor: 50000, walletMinor: 50000, gatewayMinor: 0,
    discountMinor: 0, taxMinor: 0, currency: 'INR', status: 'settling', holdId: hold.holdId,
    settlementStartedAt: new Date(), // live claim
  });
  await WalletHold.updateOne({ holdId: hold.holdId }, { $set: { invoiceId: 'inv_stuck' } });

  const live = await settleInvoice('inv_stuck', { providerRef: 'wallet:stuck', gatewayMinor: 0, source: 'wallet' });
  assert.equal(live.ok, false, JSON.stringify(live));
  assert.equal(live.error, 'settlement_in_progress');
  assert.equal(live.inProgress, true);
  assert.equal(live.retryable, true);
  assert.equal((await SoftwareInvoice.findOne({ invoiceId: 'inv_stuck' }).lean()).status, 'settling');
  assert.equal(await WalletLedger.countDocuments({ tenantId: 'lib-a', kind: 'debit', holdId: hold.holdId }), 0,
    'live inProgress must not capture');

  // OS-level interrupt left settling; age the claim past STALE_SETTLING_MS (default 60s).
  await SoftwareInvoice.updateOne(
    { invoiceId: 'inv_stuck' },
    { $set: { settlementStartedAt: new Date(Date.now() - 120_000) } },
  );
  const resumed = await settleInvoice('inv_stuck', { providerRef: 'wallet:stuck', gatewayMinor: 0, source: 'wallet' });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.status, 'paid');
  assert.equal(await WalletLedger.countDocuments({ tenantId: 'lib-a', kind: 'debit', holdId: hold.holdId }), 1);
  assert.equal((await Library.findOne({ libraryId: 'lib-a' }).lean()).subscription?.status, 'active');

  const again = await settleInvoice('inv_stuck', { providerRef: 'wallet:stuck', gatewayMinor: 0, source: 'wallet' });
  assert.equal(again.ok, true);
  assert.equal(again.already, true);
  assert.equal(await WalletLedger.countDocuments({ tenantId: 'lib-a', kind: 'debit', holdId: hold.holdId }), 1);
  const inv = await SoftwareInvoice.findOne({ invoiceId: 'inv_stuck' }).lean();
  assert.ok(['sent', 'logged'].includes(inv.receiptDelivery?.status));
  const attempts = inv.receiptDelivery.attempts;
  const redeploy = await deliverSoftwareReceipt('inv_stuck');
  assert.equal(redeploy.already, true);
  assert.equal((await SoftwareInvoice.findOne({ invoiceId: 'inv_stuck' }).lean()).receiptDelivery.attempts, attempts,
    'delivery must not repeat after sent/logged');
});

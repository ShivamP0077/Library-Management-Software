// Final billing hardening: PayPal capture flow, renewal interval, receipt delivery truthfulness,
// admin billing history + resend, and offer quota reservation. All providers mocked; no live calls.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { Library } from '../src/models.js';
import { PlatformBillingConfig } from '../src/billingConfig.js';
import { Wallet, WalletLedger, WalletHold, Offer, OfferRedemption } from '../src/commerce.js';
import { SoftwareInvoice } from '../src/payments/invoices.js';
import { settleInvoice, failInvoice, deliverSoftwareReceipt, softwareReceiptText } from '../src/payments/settlement.js';
import { reserveOffer } from '../src/payments/offers.js';
import { createPaypalProvider } from '../src/payments/paypalProvider.js';
import { creditWallet } from '../src/wallet.js';
import { setPaymentProvider } from '../src/billing.js';
import { AuditLog } from '../src/audit.js';
import * as mailer from '../src/mailer.js';

const keys = () => `idem-${Math.random().toString(36).slice(2)}`;
const reset = async (tenantId) => {
  await Promise.all([
    Wallet.deleteMany({ tenantId }), WalletLedger.deleteMany({ tenantId }), WalletHold.deleteMany({ tenantId }),
    SoftwareInvoice.deleteMany({ tenantId }), OfferRedemption.deleteMany({ tenantId }),
  ]);
  await Library.updateOne({ libraryId: tenantId }, { $set: { planId: null }, $unset: { subscription: 1 } });
};

before(async () => {
  await setup('billing-final');
  for (const p of [{ name: 'Basic', priceMonthly: 500, priceYearly: 5000 }, { name: 'Pro', priceMonthly: 1000, priceYearly: 10000 }]) {
    assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: p })).status, 201);
  }
});
after(async () => { setPaymentProvider(null); await teardown(); });
beforeEach(async () => {
  await PlatformBillingConfig.deleteOne({ _id: 'default' });
  await Offer.deleteMany({});
  await reset('lib-a'); await reset('lib-b');
  await call('PUT', '/api/admin/billing/config', { token: ctx.tokens.sa, body: { currency: 'INR', taxMode: 'none' } });
  setPaymentProvider({ name: 'fake', createCheckout: async () => ({ url: 'https://pay.test/c', reference: `order_${Math.random().toString(36).slice(2)}` }) });
});

function mockPaypalFetch(routes) {
  const orig = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); seen.push({ url: u, method: opts.method || 'GET' });
    if (u.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    for (const [re, body] of routes) if (re.test(u)) return new Response(JSON.stringify(typeof body === 'function' ? body() : body), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  return { seen, restore: () => { globalThis.fetch = orig; } };
}

async function paypalInvoice(invoiceId, orderId) {
  return SoftwareInvoice.create({
    invoiceId, tenantId: 'lib-a', kind: 'subscription', planId: 'basic', interval: 'month',
    amount: 500, totalMinor: 50000, baseMinor: 50000, taxableMinor: 50000, gatewayMinor: 50000, walletMinor: 0,
    currency: 'USD', status: 'open', provider: 'paypal', providerRef: orderId, providerOrderRef: orderId,
  });
}

test('PAYPAL: order approval captures, stores capture id + order id separately; receipt shows both', async () => {
  await paypalInvoice('inv_pp1', 'ORDER1');
  const capture = { id: 'CAP1', status: 'COMPLETED', custom_id: 'lib-a|inv_pp1|month|basic', amount: { value: '500.00', currency_code: 'USD' } };
  const m = mockPaypalFetch([[/\/v2\/checkout\/orders\/ORDER1\/capture$/, { id: 'ORDER1', status: 'COMPLETED', purchase_units: [{ reference_id: 'inv_pp1', payments: { captures: [capture] } }] }]]);
  try {
    const pp = createPaypalProvider({ clientId: 'x', clientSecret: 'y', webhookId: 'w' });
    const r = await pp.handleWebhook({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER1' } });
    assert.equal(r.ok, true, JSON.stringify(r));
  } finally { m.restore(); }
  const inv = await SoftwareInvoice.findOne({ invoiceId: 'inv_pp1' }).lean();
  assert.equal(inv.status, 'paid');
  assert.equal(inv.providerPaymentRef, 'CAP1');
  assert.equal(inv.providerOrderRef, 'ORDER1');
  const text = softwareReceiptText(inv, { name: 'Library A' });
  assert.match(text, /Payment\/capture ID: CAP1/);
  assert.match(text, /Order ID: ORDER1/);
});

test('PAYPAL: capture-completed webhook re-fetches capture; pending, wrong order, wrong amount never activate', async () => {
  await paypalInvoice('inv_pp2', 'ORDER2');
  const capOf = (status, value = '500.00', order = 'ORDER2') => ({ id: 'CAP2', status, custom_id: 'lib-a|inv_pp2|month|basic', amount: { value, currency_code: 'USD' }, supplementary_data: { related_ids: { order_id: order } } });
  const pp = createPaypalProvider({ clientId: 'x', clientSecret: 'y', webhookId: 'w' });
  const evt = { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP2', supplementary_data: { related_ids: { order_id: 'ORDER2' } } } };
  let m = mockPaypalFetch([[/\/v2\/payments\/captures\/CAP2$/, capOf('PENDING')]]);
  try { assert.equal((await pp.handleWebhook(evt)).error, 'payment_not_completed'); } finally { m.restore(); }
  assert.equal((await SoftwareInvoice.findOne({ invoiceId: 'inv_pp2' }).lean()).status, 'open');
  assert.equal((await Library.findOne({ libraryId: 'lib-a' }).lean()).subscription?.status, undefined);
  m = mockPaypalFetch([[/\/v2\/payments\/captures\/CAP2$/, capOf('COMPLETED', '500.00', 'OTHER')]]);
  try { assert.equal((await pp.handleWebhook(evt)).error, 'order_reference_mismatch'); } finally { m.restore(); }
  m = mockPaypalFetch([[/\/v2\/payments\/captures\/CAP2$/, capOf('COMPLETED', '1.00')]]);
  try { assert.equal((await pp.handleWebhook(evt)).ok, false); } finally { m.restore(); }
  await SoftwareInvoice.updateOne({ invoiceId: 'inv_pp2' }, { $set: { status: 'open' } });
  m = mockPaypalFetch([[/\/v2\/payments\/captures\/CAP2$/, capOf('COMPLETED')]]);
  try { const ok = await pp.handleWebhook(evt); assert.equal(ok.ok, true, JSON.stringify(ok)); } finally { m.restore(); }
  const inv = await SoftwareInvoice.findOne({ invoiceId: 'inv_pp2' }).lean();
  assert.equal(inv.status, 'paid'); assert.equal(inv.providerPaymentRef, 'CAP2'); assert.equal(inv.providerOrderRef, 'ORDER2');
  m = mockPaypalFetch([]);
  try { assert.equal((await pp.handleWebhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP9' } })).error, 'order_reference_missing'); } finally { m.restore(); }
});

test('RENEWAL: early renewal extends from old periodEnd; invoice and subscription periods agree', async () => {
  const oldEnd = new Date(Date.now() + 10 * 864e5);
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { planId: 'basic', subscription: {
    planId: 'basic', interval: 'month', status: 'active', price: 500, currentPeriodStart: new Date(Date.now() - 20 * 864e5), currentPeriodEnd: oldEnd, startedAt: new Date(Date.now() - 20 * 864e5),
  } } });
  await creditWallet({ tenantId: 'lib-a', amountMinor: 50000, bucket: 'cash', reason: 'cash', source: 'test' });
  const r = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.a, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic', interval: 'month' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.invoice.changeType, 'renewal');
  const inv = await SoftwareInvoice.findOne({ invoiceId: r.body.invoice.invoiceId }).lean();
  const sub = (await Library.findOne({ libraryId: 'lib-a' }).lean()).subscription;
  assert.equal(new Date(inv.periodStart).getTime(), oldEnd.getTime());
  assert.equal(new Date(sub.currentPeriodStart).getTime(), new Date(inv.periodStart).getTime());
  assert.equal(new Date(sub.currentPeriodEnd).getTime(), new Date(inv.periodEnd).getTime());
  assert.ok(new Date(inv.periodEnd) > new Date(oldEnd.getTime() + 27 * 864e5));
});

test('RECEIPT: concurrent automatic delivery claims once; transport failure is failed; force resend records attempt; PDF independent', async () => {
  await creditWallet({ tenantId: 'lib-b', amountMinor: 50000, bucket: 'cash', reason: 'cash', source: 'test' });
  const r = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.b, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.invoice.invoiceId;
  await SoftwareInvoice.updateOne({ invoiceId: id }, { $set: { 'receiptDelivery.status': 'pending', 'receiptDelivery.attempts': 0, 'receiptDelivery.history': [] } });
  const rs = await Promise.all([deliverSoftwareReceipt(id), deliverSoftwareReceipt(id), deliverSoftwareReceipt(id)]);
  assert.equal(rs.filter(x => !x.already).length, 1, JSON.stringify(rs));
  let inv = await SoftwareInvoice.findOne({ invoiceId: id }).lean();
  assert.equal(inv.receiptDelivery.attempts, 1);
  assert.equal(inv.receiptDelivery.status, 'logged');
  assert.equal(inv.receiptDelivery.reason, 'email_transport_not_configured');
  const last = mailer.outbox.at(-1);
  assert.equal(last.attachments?.[0]?.filename, `receipt-${inv.receiptNo}.pdf`);

  // Simulate a real SMTP transport that throws: final status must be failed, attempt not lost.
  process.env.NODE_ENV = 'production'; process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '1';
  try {
    const fail = await deliverSoftwareReceipt(id, { force: true, trigger: 'owner_resend' });
    assert.equal(fail.status, 'failed', JSON.stringify(fail));
  } finally { process.env.NODE_ENV = 'test'; delete process.env.SMTP_HOST; delete process.env.SMTP_PORT; }
  inv = await SoftwareInvoice.findOne({ invoiceId: id }).lean();
  assert.equal(inv.receiptDelivery.attempts, 2);
  assert.equal(inv.receiptDelivery.history.at(-1).status, 'failed');
  assert.ok(inv.receiptDelivery.history.at(-1).finishedAt);

  const pdf = await call('GET', `/api/software-plan/invoices/${id}/receipt?format=pdf`, { token: ctx.tokens.b });
  assert.equal(pdf.status, 200);
  const otherTenant = await call('GET', `/api/software-plan/invoices/${id}/receipt?format=pdf`, { token: ctx.tokens.a });
  assert.equal(otherTenant.status, 404);
});

test('ADMIN: billing history is a JSON array matching owner values; admin resend respects invoice tenant + audit', async () => {
  await creditWallet({ tenantId: 'lib-b', amountMinor: 50000, bucket: 'cash', reason: 'cash', source: 'test' });
  const r = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.b, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic' } });
  const id = r.body.invoice.invoiceId;
  await SoftwareInvoice.create({ invoiceId: 'inv_legacy_b', tenantId: 'lib-b', amount: 250, status: 'paid', receiptNo: 'RCPT-LEGACY', provider: 'razorpay', providerRef: 'pay_legacy', currency: 'INR' });
  const admin = await call('GET', '/api/admin/software-plan/invoices?tenantId=lib-b', { token: ctx.tokens.sa });
  assert.equal(admin.status, 200);
  assert.ok(Array.isArray(admin.body));
  const owner = await call('GET', '/api/software-plan/invoices', { token: ctx.tokens.b });
  for (const inv of owner.body) {
    const a = admin.body.find(x => x.invoiceId === inv.invoiceId);
    for (const k of ['totalMinor', 'walletMinor', 'gatewayMinor', 'taxMinor', 'status', 'receiptNo', 'libraryName', 'providerOrderRef', 'providerPaymentRef']) assert.deepEqual(a[k], inv[k], k);
    assert.equal(a.raw, undefined);
  }
  const legacy = admin.body.find(x => x.invoiceId === 'inv_legacy_b');
  assert.equal(legacy.totalMinor, 25000); assert.equal(legacy.gatewayMinor, 25000); assert.equal(legacy.legacy, true);
  assert.equal(admin.body.find(x => x.invoiceId === id).libraryName, 'Library B');
  const legacyReceipt = await call('GET', '/api/admin/software-plan/invoices/inv_legacy_b/receipt', { token: ctx.tokens.sa });
  assert.match(String(legacyReceipt.body), /Total: 250\.00 INR/);

  const deliver = await call('POST', `/api/admin/software-plan/invoices/${id}/receipt/deliver`, { token: ctx.tokens.sa });
  assert.equal(deliver.status, 200, JSON.stringify(deliver.body));
  const inv = await SoftwareInvoice.findOne({ invoiceId: id }).lean();
  assert.equal(inv.receiptDelivery.history.at(-1).trigger, 'admin_resend');
  assert.equal(mailer.outbox.at(-1).to, 'admin-b@test.local');
  assert.ok(await AuditLog.findOne({ action: 'software_plan.receipt_resent', tenantId: 'lib-b', target: id }));
  assert.equal((await call('GET', '/api/admin/software-plan/invoices', { token: ctx.tokens.b })).status, 403);
  assert.equal((await call('POST', `/api/admin/software-plan/invoices/${id}/receipt/deliver`, { token: ctx.tokens.b })).status, 403);
});

test('OFFER: quote has no side effects; checkout reserves capacity atomically; failure revokes; settle counts once', async () => {
  await call('POST', '/api/admin/offers', { token: ctx.tokens.sa, body: { name: 'One', code: 'ONLY1', discountType: 'percentage', discountValue: 10, usageLimit: 1, perTenantLimit: 1 } });
  const q = await call('POST', '/api/software-plan/quote', { token: ctx.tokens.a, body: { planId: 'basic', offerCode: 'ONLY1' } });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  let offer = await Offer.findOne({ code: 'ONLY1' }).lean();
  assert.equal(offer.reservedCount, 0); assert.equal(offer.usedCount, 0);
  assert.equal(await OfferRedemption.countDocuments({}), 0);

  // Two libraries race for the last slot: exactly one reservation wins.
  const results = await Promise.allSettled([
    reserveOffer({ offerId: offer.offerId, tenantId: 'lib-a', invoiceId: 'inv_o_a', discountMinor: 5000 }),
    reserveOffer({ offerId: offer.offerId, tenantId: 'lib-b', invoiceId: 'inv_o_b', discountMinor: 5000 }),
  ]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  offer = await Offer.findOne({ code: 'ONLY1' }).lean();
  assert.equal(offer.reservedCount, 1);
  const winner = results.find(x => x.status === 'fulfilled').value;
  // Other library now sees limit reached on quote (pending counts against capacity), no leak of who holds it.
  const loserTok = winner.tenantId === 'lib-a' ? ctx.tokens.b : ctx.tokens.a;
  const blocked = await call('POST', '/api/software-plan/quote', { token: loserTok, body: { planId: 'basic', offerCode: 'ONLY1' } });
  assert.equal(blocked.status, 400); assert.doesNotMatch(JSON.stringify(blocked.body), /lib-/);

  // Same tenant concurrent: per-tenant slot is unique.
  await Offer.updateOne({ offerId: offer.offerId }, { $set: { usageLimit: 10 } });
  const same = await Promise.allSettled([
    reserveOffer({ offerId: offer.offerId, tenantId: 'lib-b', invoiceId: 'inv_s1', discountMinor: 1 }),
    reserveOffer({ offerId: offer.offerId, tenantId: 'lib-b', invoiceId: 'inv_s2', discountMinor: 1 }),
  ]);
  const winnerIsB = winner.tenantId === 'lib-b';
  assert.equal(same.filter(x => x.status === 'fulfilled').length, winnerIsB ? 0 : 1);
  await OfferRedemption.deleteMany({ invoiceId: { $in: ['inv_s1', 'inv_s2', 'inv_o_a', 'inv_o_b'] } });
  await Offer.updateOne({ offerId: offer.offerId }, { $set: { usageLimit: 1, reservedCount: 0, usedCount: 0 } });

  // Real checkout through the gateway: fail releases, then a fresh checkout settles and counts exactly once.
  const c1 = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.a, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic', offerCode: 'ONLY1' } });
  assert.equal(c1.status, 201, JSON.stringify(c1.body));
  assert.equal((await Offer.findOne({ offerId: offer.offerId }).lean()).reservedCount, 1);
  await failInvoice(c1.body.invoice.invoiceId, { reason: 'declined' });
  offer = await Offer.findOne({ offerId: offer.offerId }).lean();
  assert.equal(offer.reservedCount, 0); assert.equal(offer.usedCount, 0);
  const c2 = await call('POST', '/api/software-plan/checkout', { token: ctx.tokens.a, headers: { 'Idempotency-Key': keys() }, body: { planId: 'basic', offerCode: 'ONLY1' } });
  assert.equal(c2.status, 201, JSON.stringify(c2.body));
  const inv = c2.body.invoice;
  const fake = { providerRef: 'pay_x', providerOrderRef: inv.providerRef, gatewayMinor: inv.gatewayMinor, currency: 'INR', provider: 'fake', source: 'fake' };
  const [s1, s2] = await Promise.all([settleInvoice(inv.invoiceId, fake), settleInvoice(inv.invoiceId, fake)]);
  assert.ok(s1.ok || s2.ok);
  offer = await Offer.findOne({ offerId: offer.offerId }).lean();
  assert.equal(offer.usedCount, 1); assert.equal(offer.reservedCount, 0);
  assert.equal(await OfferRedemption.countDocuments({ offerId: offer.offerId, status: 'applied' }), 1);
  const multi = await call('POST', '/api/software-plan/quote', { token: ctx.tokens.b, body: { planId: 'basic', offerCode: ['A', 'B'] } });
  assert.equal(multi.status, 400);
});

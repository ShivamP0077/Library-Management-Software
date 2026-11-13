// A saved invoice id must not block checkout. New invoices often have no provider yet,
// and a missing or stale id should start a new payment link instead of invoice_conflict.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { SoftwareInvoice } from '../src/payments/invoices.js';
import { createRazorpayProvider } from '../src/payments/razorpayProvider.js';
import { createPaypalProvider } from '../src/payments/paypalProvider.js';
import { setPaymentProvider } from '../src/billing.js';
import { Library } from '../src/models.js';

const library = { libraryId: 'lib-a', name: 'Library A', contactEmail: 'admin-a@test.local', planId: null };
const plan = { planId: 'standard', name: 'Standard' };

const razorpay = () => createRazorpayProvider({ keyId: 'rzp_test_key', keySecret: 'test_secret', mode: 'test' });
const paypal = () => createPaypalProvider({ clientId: 'paypal_test', clientSecret: 'test_secret', mode: 'sandbox' });

async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

function razorpayFetch(url, opts) {
  if (!String(url).includes('api.razorpay.com')) throw new Error(`unexpected ${url}`);
  const body = JSON.parse(opts.body);
  const invoiceId = body.notes.invoiceId;
  return {
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ id: `plink_${invoiceId}`, short_url: `https://rzp.io/i/${invoiceId}` }); },
  };
}

function paypalFetch(url, opts) {
  const u = String(url);
  if (u.endsWith('/v1/oauth2/token')) return { ok: true, status: 200, async json() { return { access_token: 'tok' }; } };
  if (u.includes('/v2/checkout/orders')) {
    const invoiceId = JSON.parse(opts.body).purchase_units[0].reference_id;
    return {
      ok: true,
      status: 201,
      async json() { return { id: `ORDER_${invoiceId}`, links: [{ rel: 'approve', href: `https://paypal.test/${invoiceId}` }] }; },
    };
  }
  throw new Error(`unexpected ${u}`);
}

before(async () => {
  await setup('checkout-invoice');
  assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.sa, body: { name: 'Standard', priceMonthly: 499, priceYearly: 4990 } })).status, 201);
  assert.equal((await call('PUT', '/api/admin/billing/config', { token: ctx.tokens.sa, body: { currency: 'INR', taxMode: 'none' } })).status, 200);
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { planId: null }, $unset: { subscription: 1 } });
});
after(async () => { setPaymentProvider(null); await teardown(); });

test('a new open invoice with no provider still starts Razorpay checkout', async () => {
  await SoftwareInvoice.deleteOne({ invoiceId: 'inv_open_unset' });
  await SoftwareInvoice.create({
    invoiceId: 'inv_open_unset', tenantId: 'lib-a', amount: 499, totalMinor: 49900, gatewayMinor: 49900,
    currency: 'INR', status: 'open', planId: 'standard', interval: 'month',
  });
  const result = await withFetch(razorpayFetch, () => razorpay().createCheckout({
    library, plan, interval: 'month', amount: 499, invoiceId: 'inv_open_unset',
  }));
  assert.equal(result.invoiceId, 'inv_open_unset');
  assert.equal(result.url, 'https://rzp.io/i/inv_open_unset');
  assert.equal(result.provider, 'razorpay');
  const saved = await SoftwareInvoice.findOne({ invoiceId: 'inv_open_unset' }).lean();
  assert.equal(saved.provider, 'razorpay');
  assert.equal(saved.status, 'open');
  assert.equal(saved.providerRef, 'plink_inv_open_unset');
  assert.doesNotMatch(JSON.stringify(result), /Saved checkout invoice was not found/);
});

test('missing, stale, void, paid, and wrong-library invoice ids start a fresh Razorpay checkout', async () => {
  await SoftwareInvoice.deleteMany({ invoiceId: { $in: ['inv_other_lib', 'inv_voided', 'inv_already_paid'] } });
  await SoftwareInvoice.create({ invoiceId: 'inv_other_lib', tenantId: 'lib-b', amount: 10, currency: 'INR', status: 'open', provider: 'razorpay' });
  await SoftwareInvoice.create({ invoiceId: 'inv_voided', tenantId: 'lib-a', amount: 10, currency: 'INR', status: 'void', provider: 'razorpay' });
  await SoftwareInvoice.create({ invoiceId: 'inv_already_paid', tenantId: 'lib-a', amount: 10, currency: 'INR', status: 'paid', provider: 'razorpay' });

  for (const requested of ['inv_missing', 'inv_other_lib', 'inv_voided', 'inv_already_paid']) {
    const result = await withFetch(razorpayFetch, () => razorpay().createCheckout({
      library, plan, interval: 'month', amount: 499, invoiceId: requested,
    }));
    assert.notEqual(result.invoiceId, requested, requested);
    assert.match(result.url, /^https:\/\/rzp\.io\/i\//);
    assert.doesNotMatch(JSON.stringify(result), /Saved checkout invoice was not found/);
    const fresh = await SoftwareInvoice.findOne({ invoiceId: result.invoiceId }).lean();
    assert.equal(fresh.tenantId, 'lib-a');
    assert.equal(fresh.provider, 'razorpay');
    assert.equal(fresh.status, 'open');
    assert.ok(fresh.providerRef);
  }

  const other = await SoftwareInvoice.findOne({ invoiceId: 'inv_other_lib' }).lean();
  assert.equal(other.tenantId, 'lib-b');
  assert.equal(other.providerRef || null, null);
  assert.equal((await SoftwareInvoice.findOne({ invoiceId: 'inv_voided' }).lean()).status, 'void');
  assert.equal((await SoftwareInvoice.findOne({ invoiceId: 'inv_already_paid' }).lean()).status, 'paid');
});

test('PayPal uses an open invoice with no provider and starts fresh when the id is not usable', async () => {
  await SoftwareInvoice.deleteOne({ invoiceId: 'inv_pp_unset' });
  await SoftwareInvoice.create({
    invoiceId: 'inv_pp_unset', tenantId: 'lib-a', amount: 499, totalMinor: 49900, gatewayMinor: 49900,
    currency: 'INR', status: 'open', planId: 'standard',
  });
  const reused = await withFetch(paypalFetch, () => paypal().createCheckout({
    library, plan, interval: 'month', amount: 499, invoiceId: 'inv_pp_unset',
  }));
  assert.equal(reused.invoiceId, 'inv_pp_unset');
  assert.equal(reused.url, 'https://paypal.test/inv_pp_unset');
  assert.equal((await SoftwareInvoice.findOne({ invoiceId: 'inv_pp_unset' }).lean()).provider, 'paypal');

  const fresh = await withFetch(paypalFetch, () => paypal().createCheckout({
    library, plan, interval: 'month', amount: 499, invoiceId: 'inv_pp_missing',
  }));
  assert.notEqual(fresh.invoiceId, 'inv_pp_missing');
  assert.match(fresh.url, /^https:\/\/paypal\.test\//);
  const saved = await SoftwareInvoice.findOne({ invoiceId: fresh.invoiceId }).lean();
  assert.equal(saved.tenantId, 'lib-a');
  assert.equal(saved.provider, 'paypal');
  assert.equal(saved.status, 'open');
});

test('a failed checkout replay with no payment link starts a new checkout', async () => {
  setPaymentProvider({
    name: 'razorpay',
    createCheckout: async ({ invoiceId }) => ({ url: 'https://pay.test/fresh', reference: 'ref_fresh', invoiceId, provider: 'razorpay' }),
  });
  const key = 'idem-dead-checkout';
  await SoftwareInvoice.deleteMany({ tenantId: 'lib-a' });
  await SoftwareInvoice.create({
    invoiceId: 'inv_dead_replay', tenantId: 'lib-a', amount: 499, totalMinor: 49900, gatewayMinor: 49900,
    currency: 'INR', status: 'open', planId: 'standard', interval: 'month', idempotencyKey: key,
    failureReason: 'Saved checkout invoice was not found for this library',
  });
  const r = await call('POST', '/api/software-plan/checkout', {
    token: ctx.tokens.a,
    headers: { 'Idempotency-Key': key },
    body: { planId: 'standard', useWallet: false },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.notEqual(r.body.replay, true);
  assert.equal(r.body.checkout.url, 'https://pay.test/fresh');
  assert.notEqual(r.body.invoice.invoiceId, 'inv_dead_replay');
  assert.doesNotMatch(JSON.stringify(r.body), /Saved checkout invoice was not found/);
  const dead = await SoftwareInvoice.findOne({ invoiceId: 'inv_dead_replay' }).lean();
  assert.equal(dead.idempotencyKey || null, null);
  assert.equal(dead.status, 'void');
});

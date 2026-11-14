// Issue #19: payment config encryption, webhook signatures, checkout security, deletion alerts.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { setup, teardown, call, ctx } from './helpers.js';
import { setPaymentProvider } from '../src/billing.js';
import { updatePaymentConfig, refreshPaymentProvider, getPaymentConfigPublic } from '../src/paymentConfig.js';
import { encryptSecret, decryptSecret } from '../src/cryptoSecrets.js';
import { verifyRazorpaySignature, verifyPaymentSignature, createRazorpayProvider } from '../src/payments/razorpayProvider.js';
import { Library } from '../src/models.js';
import { SoftwareInvoice } from '../src/payments/invoices.js';
import { outbox } from '../src/mailer.js';
import { resetRateLimits } from '../src/accounts.js';

before(async () => { await setup('payments19'); });
after(async () => { setPaymentProvider(null); await teardown(); });
beforeEach(async () => {
  resetRateLimits();
  setPaymentProvider(null);
  await updatePaymentConfig({ activeProvider: 'none', razorpay: { enabled: false }, paypal: { enabled: false } }, { updatedBy: 'test' });
});

test('encryptSecret round-trips', () => {
  const enc = encryptSecret('rzp_test_secret_abc');
  assert.notEqual(enc, 'rzp_test_secret_abc');
  assert.equal(decryptSecret(enc), 'rzp_test_secret_abc');
});

test('Super Admin can save Razorpay config without echoing secrets', async () => {
  const r = await call('PUT', '/api/admin/payments/config', {
    token: ctx.tokens.sa,
    body: {
      activeProvider: 'razorpay',
      razorpay: { enabled: true, keyId: 'rzp_test_key', keySecret: 'super-secret-key', webhookSecret: 'whsec_abc', mode: 'test' },
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.activeProvider, 'razorpay');
  assert.equal(r.body.razorpay.keyId, 'rzp_test_key');
  assert.equal(r.body.razorpay.keySecretSet, true);
  assert.ok(!JSON.stringify(r.body).includes('super-secret-key'));
  assert.equal(r.body.paymentsEnabled, true);
  const pub = await getPaymentConfigPublic();
  assert.equal(pub.razorpay.keySecretSet, true);
});

test('non-superadmin cannot read or write payment config', async () => {
  assert.equal((await call('GET', '/api/admin/payments/config', { token: ctx.tokens.a })).status, 403);
  assert.equal((await call('PUT', '/api/admin/payments/config', { token: ctx.tokens.a, body: { activeProvider: 'none' } })).status, 403);
});

test('Razorpay webhook rejects bad signatures and activates on valid payment_link.paid', async () => {
  await updatePaymentConfig({
    activeProvider: 'razorpay',
    razorpay: { enabled: true, keyId: 'rzp_test', keySecret: 'keysec', webhookSecret: 'hooksec', mode: 'test' },
  }, { updatedBy: 'test' });
  await refreshPaymentProvider();

  await Library.updateOne({ libraryId: 'lib-a' }, {
    $set: { planId: 'pro', subscription: { status: 'pending_payment', interval: 'month', price: 999, planId: 'pro' } },
  });
  await SoftwareInvoice.create({
    invoiceId: 'inv_test_1', tenantId: 'lib-a', amount: 999, currency: 'INR', status: 'open', provider: 'razorpay',
  });

  const event = {
    event: 'payment_link.paid',
    payload: {
      payment_link: { entity: { id: 'plink_1', currency: 'INR', notes: { tenantId: 'lib-a', invoiceId: 'inv_test_1', interval: 'month', planId: 'pro' } } },
      payment: { entity: { id: 'pay_1', amount: 99900, currency: 'INR', notes: { tenantId: 'lib-a', invoiceId: 'inv_test_1' } } },
    },
  };
  const raw = JSON.stringify(event);

  const badRes = await fetch(`${ctx.base}/api/payments/webhook/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'deadbeef' },
    body: raw,
  });
  assert.equal(badRes.status, 401);

  assert.equal(verifyRazorpaySignature(raw, crypto.createHmac('sha256', 'hooksec').update(raw).digest('hex'), 'hooksec'), true);

  const sig = crypto.createHmac('sha256', 'hooksec').update(raw).digest('hex');
  const okRes = await fetch(`${ctx.base}/api/payments/webhook/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig },
    body: raw,
  });
  const okBody = await okRes.json();
  assert.equal(okRes.status, 200, JSON.stringify(okBody));
  assert.equal(okBody.status, 'active');

  const lib = await Library.findOne({ libraryId: 'lib-a' }).lean();
  assert.equal(lib.subscription.status, 'active');
  assert.ok(lib.subscription.currentPeriodEnd);
  const inv = await SoftwareInvoice.findOne({ invoiceId: 'inv_test_1' }).lean();
  assert.equal(inv.status, 'paid');
});

async function postRazorpay(event, secret = 'hooksec') {
  const raw = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const res = await fetch(`${ctx.base}/api/payments/webhook/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': sig },
    body: raw,
  });
  const body = await res.json();
  return { status: res.status, body };
}

function mockPaymentLinkLookup(plinkId, linkBody) {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.razorpay.com') && u.includes(`/payment_links/${plinkId}`)) {
      calls += 1;
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify(linkBody); },
      };
    }
    return realFetch(url, opts);
  };
  return { calls: () => calls, restore: () => { globalThis.fetch = realFetch; } };
}

test('payment.captured settles when the payment is on the stored payment link', async () => {
  await updatePaymentConfig({
    activeProvider: 'razorpay',
    razorpay: { enabled: true, keyId: 'rzp_test', keySecret: 'keysec', webhookSecret: 'hooksec', mode: 'test' },
  }, { updatedBy: 'test' });
  await refreshPaymentProvider();
  await Library.updateOne({ libraryId: 'lib-a' }, {
    $set: { planId: 'pro', subscription: { status: 'pending_payment', interval: 'month', price: 1, planId: 'pro' } },
  });
  await SoftwareInvoice.create({
    invoiceId: 'inv_cap_ok', tenantId: 'lib-a', planId: 'pro', interval: 'month',
    amount: 1, totalMinor: 100, baseMinor: 100, taxableMinor: 100, gatewayMinor: 100,
    currency: 'INR', status: 'open', provider: 'razorpay',
    providerRef: 'plink_x', providerOrderRef: 'plink_x',
  });
  const mock = mockPaymentLinkLookup('plink_x', {
    id: 'plink_x',
    status: 'paid',
    amount: 100,
    amount_paid: 100,
    order_id: 'order_for_plink_x',
    payments: [{ payment_id: 'pay_x', amount: 100, status: 'captured' }],
  });
  try {
    const res = await postRazorpay({
      id: 'evt_cap_ok',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_x',
            order_id: 'order_for_plink_x',
            amount: 100,
            currency: 'INR',
            status: 'captured',
            notes: { tenantId: 'lib-a', invoiceId: 'inv_cap_ok', planId: 'pro', interval: 'month' },
          },
        },
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true, JSON.stringify(res.body));
    assert.equal(res.body.status, 'active');
    assert.equal(mock.calls(), 1);
  } finally {
    mock.restore();
  }
  const inv = await SoftwareInvoice.findOne({ invoiceId: 'inv_cap_ok' }).lean();
  assert.equal(inv.status, 'paid');
  const lib = await Library.findOne({ libraryId: 'lib-a' }).lean();
  assert.equal(lib.subscription.status, 'active');
  assert.equal(lib.planId, 'pro');
});

test('payment.captured rejects when the payment is not on the stored payment link', async () => {
  await updatePaymentConfig({
    activeProvider: 'razorpay',
    razorpay: { enabled: true, keyId: 'rzp_test', keySecret: 'keysec', webhookSecret: 'hooksec', mode: 'test' },
  }, { updatedBy: 'test' });
  await refreshPaymentProvider();
  await Library.updateOne({ libraryId: 'lib-b' }, {
    $set: { planId: 'pro', subscription: { status: 'pending_payment', interval: 'month', price: 1, planId: 'pro' } },
  });
  await SoftwareInvoice.create({
    invoiceId: 'inv_cap_bad', tenantId: 'lib-b', planId: 'pro', interval: 'month',
    amount: 1, totalMinor: 100, baseMinor: 100, taxableMinor: 100, gatewayMinor: 100,
    currency: 'INR', status: 'open', provider: 'razorpay',
    providerRef: 'plink_x', providerOrderRef: 'plink_x',
  });
  const mock = mockPaymentLinkLookup('plink_x', {
    id: 'plink_x',
    status: 'paid',
    amount: 100,
    order_id: 'order_for_plink_x',
    payments: [{ payment_id: 'pay_other', amount: 100, status: 'captured' }],
  });
  try {
    const res = await postRazorpay({
      id: 'evt_cap_bad',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_x',
            order_id: 'order_unrelated',
            amount: 100,
            currency: 'INR',
            status: 'captured',
            notes: { tenantId: 'lib-b', invoiceId: 'inv_cap_bad', planId: 'pro', interval: 'month' },
          },
        },
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, false, JSON.stringify(res.body));
    assert.equal(mock.calls(), 1);
  } finally {
    mock.restore();
  }
  const inv = await SoftwareInvoice.findOne({ invoiceId: 'inv_cap_bad' }).lean();
  assert.equal(inv.status, 'past_due');
  assert.match(String(inv.failureReason || ''), /provider_reference_mismatch/);
  const lib = await Library.findOne({ libraryId: 'lib-b' }).lean();
  assert.equal(lib.subscription.status, 'pending_payment');
});

test('payment amount tampering: order|payment HMAC must match key secret', () => {
  const keySecret = 'keysec';
  const orderId = 'order_1';
  const paymentId = 'pay_1';
  const good = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  assert.equal(verifyPaymentSignature({ orderId, paymentId, signature: good, keySecret }), true);
  assert.equal(verifyPaymentSignature({ orderId, paymentId, signature: good, keySecret: 'other' }), false);
  assert.equal(verifyPaymentSignature({ orderId, paymentId: 'pay_TAMPERED', signature: good, keySecret }), false);
});

test('checkout uses server subscription amount (ignores client amount) and returns payment link', async () => {
  await Library.updateOne({ libraryId: 'lib-a' }, {
    $set: { subscription: { status: 'pending_payment', interval: 'month', price: 500, planId: 'pro' }, planId: 'pro' },
  });
  const tok = ctx.tokens.a;
  assert.equal((await call('POST', '/api/subscription/checkout', { token: tok })).status, 402);

  await updatePaymentConfig({
    activeProvider: 'razorpay',
    razorpay: { enabled: true, keyId: 'rzp_test', keySecret: 'sec', webhookSecret: 'wh', mode: 'test' },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('razorpay.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      // Create sends the amount. The follow-up notes update does not.
      if (body.amount != null) assert.equal(body.amount, 50000); // paise from server price 500 — not client-tampered
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ id: 'plink_x', short_url: 'https://rzp.io/x' }); },
        async json() { return { id: 'plink_x', short_url: 'https://rzp.io/x' }; },
      };
    }
    return realFetch(url, opts);
  };
  try {
    const r = await call('POST', '/api/subscription/checkout', { token: tok, body: { amount: 1 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.url, 'https://rzp.io/x');
    assert.ok(r.body.invoiceId);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('deletion request emails Super Admin and lists in admin API', async () => {
  const before = outbox.length;
  const lib = await Library.findOne({ libraryId: 'lib-a' }).lean();
  const r = await call('POST', '/api/subscription/deletion-request', {
    token: ctx.tokens.a,
    body: { confirmName: lib.name, reason: 'Closing shop' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(outbox.length > before, 'super admin emailed');
  assert.ok(outbox.some(m => m.to === 'super@test.local' && /Deletion requested/i.test(m.subject)));
  const list = await call('GET', '/api/admin/payments/deletion-requests', { token: ctx.tokens.sa });
  assert.equal(list.status, 200);
  assert.ok(list.body.some(x => x.libraryId === 'lib-a'));
  const res = await call('POST', '/api/admin/payments/deletion-requests/lib-a/resolve', {
    token: ctx.tokens.sa,
    body: { action: 'acknowledge' },
  });
  assert.equal(res.status, 200);
  const dismissed = await call('POST', '/api/admin/payments/deletion-requests/lib-a/resolve', {
    token: ctx.tokens.sa,
    body: { action: 'dismiss' },
  });
  assert.equal(dismissed.status, 200);
});

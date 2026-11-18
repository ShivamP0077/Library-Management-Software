import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { addInterval, priceQuote } from '../src/billing.js';
import { pubPlan } from '../src/plans.js';
import { SoftwareInvoice } from '../src/payments/invoices.js';
import { Library } from '../src/models.js';
import { inferredYearRow } from '../scripts/backfill-software-plan-durations.mjs';

before(() => setup('plan-durations'));
after(teardown);
const SA = () => ctx.tokens.sa;

test('infers 1, 3 and 12 month prices from legacy fields without inventing a quarter discount', () => {
  const plan = { priceMonthly: 200, priceYearly: 2000 };
  const month = priceQuote(plan, 'month');
  const quarter = priceQuote(plan, 'quarter');
  const year = priceQuote(plan, 'year');
  assert.equal(month.finalMinor, 20000);
  assert.equal(month.discountType, 'none');
  assert.equal(quarter.originalMinor, 60000);
  assert.equal(quarter.discountMinor, 0);
  assert.equal(quarter.finalMinor, 60000);
  assert.equal(year.originalMinor, 240000);
  assert.equal(year.discountMinor, 40000);
  assert.equal(year.finalMinor, 200000);
  assert.equal(year.discountType, 'fixed');
  assert.equal(priceQuote({ priceMonthly: 200, priceYearly: null }, 'year').available, false);
});

test('a quarter adds three months', () => {
  const start = new Date('2026-01-15T00:00:00.000Z');
  assert.equal(addInterval(start, 'quarter').toISOString(), '2026-04-15T00:00:00.000Z');
  assert.equal(addInterval(start, 'month').toISOString(), '2026-02-15T00:00:00.000Z');
  assert.equal(addInterval(start, 'year').toISOString(), '2027-01-15T00:00:00.000Z');
});

test('rejects discounts over 100%, over the original, or negative', async () => {
  const overPct = await call('POST', '/api/admin/plans', { token: SA(), body: { name: 'Over Pct', priceMonthly: 100, durationPricing: { month: { discountType: 'percent', discountValue: 101 } } } });
  assert.equal(overPct.status, 400);
  const negative = await call('POST', '/api/admin/plans', { token: SA(), body: { name: 'Negative', priceMonthly: 100, durationPricing: { quarter: { discountType: 'fixed', discountValue: -1 } } } });
  assert.equal(negative.status, 400);
  const overFixed = await call('POST', '/api/admin/plans', { token: SA(), body: { name: 'Over Fixed', priceMonthly: 100, durationPricing: { quarter: { discountType: 'fixed', discountValue: 301 } } } });
  assert.equal(overFixed.status, 400);
});

test('only one public active plan is recommended', async () => {
  const a = await call('POST', '/api/admin/plans', { token: SA(), body: { name: 'Rec A', priceMonthly: 100, recommended: true, public: true } });
  const b = await call('POST', '/api/admin/plans', { token: SA(), body: { name: 'Rec B', priceMonthly: 120, recommended: true, public: true } });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const list = (await call('GET', '/api/admin/plans', { token: SA() })).body;
  const flagged = list.filter(p => p.recommended && p.active && p.public);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].planId, b.body.planId);
});

test('pubPlan exposes computed prices and highlight order', () => {
  const pub = pubPlan({
    planId: 'growth', name: 'Growth', priceMonthly: 200, priceYearly: 2000,
    branchLimit: 2, staffLimit: 3, studentLimit: 40, deskLimit: 10,
    features: ['Reports', 'WhatsApp reminders'], trialDays: 7, recommended: true, active: true, public: true,
  });
  assert.equal(pub.intervals.find(row => row.interval === 'year').finalMinor, 200000);
  assert.equal(pub.recommended, true);
  assert.equal(pub.trialDays, 7);
  assert.deepEqual(pub.highlights.slice(0, 5), ['10 desks', '2 branches', '3 staff', '40 students', 'WhatsApp reminders']);
});

test('quote ignores a client-typed amount', async () => {
  const created = await call('POST', '/api/admin/plans', { token: SA(), body: { name: 'Quoted', priceMonthly: 250, public: true } });
  assert.equal(created.status, 201);
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { planId: null }, $unset: { subscription: 1 } });
  const quote = await call('POST', '/api/software-plan/quote', {
    token: ctx.tokens.a,
    body: { planId: created.body.planId, interval: 'quarter', amount: 1, totalMinor: 1, price: 1, gatewayDueMinor: 1 },
  });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.durationQuote.finalMinor, 75000);
  assert.equal(quote.body.baseMinor, 75000);
});

test('a paid invoice keeps its stored amounts after the plan price changes', async () => {
  const created = await call('POST', '/api/admin/plans', { token: SA(), body: { name: 'Frozen', priceMonthly: 80 } });
  await SoftwareInvoice.create({
    invoiceId: 'inv_frozen_test', tenantId: 'lib-a', planId: created.body.planId, interval: 'month',
    amount: 80, totalMinor: 8000, baseMinor: 8000, discountMinor: 0, taxableMinor: 8000, taxMinor: 0,
    walletMinor: 0, gatewayMinor: 8000, status: 'paid', currency: 'INR',
  });
  await call('PATCH', `/api/admin/plans/${created.body.planId}`, { token: SA(), body: { priceMonthly: 90 } });
  const saved = await SoftwareInvoice.findOne({ invoiceId: 'inv_frozen_test' }).lean();
  assert.equal(saved.totalMinor, 8000);
  assert.equal(saved.amount, 80);
});

test('public catalogue has no wallet or personal data', async () => {
  const res = await call('GET', '/api/public/software-plans');
  assert.equal(res.status, 200);
  const blob = JSON.stringify(res.body);
  assert.equal(blob.includes('wallet'), false);
  assert.equal(blob.includes('email'), false);
  assert.equal(blob.includes('subscription'), false);
  assert.ok(Array.isArray(res.body.plans));
  assert.equal(res.body.plans.every(p => p.public && !p.libraries), true);
});

test('archive is blocked while libraries still use the plan', async () => {
  const created = await call('POST', '/api/admin/plans', { token: SA(), body: { name: 'Busy', priceMonthly: 50 } });
  await call('PATCH', '/api/admin/libraries/lib-a', { token: SA(), body: { planId: created.body.planId } });
  const blocked = await call('PATCH', `/api/admin/plans/${created.body.planId}`, { token: SA(), body: { active: false } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'plan_in_use');
  assert.ok(blocked.body.libraries >= 1);
  const allowed = await call('PATCH', `/api/admin/plans/${created.body.planId}`, { token: SA(), body: { active: false, confirmArchive: true } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.active, false);
});

test('backfill infers a year row and does not connect', () => {
  const row = inferredYearRow({ priceMonthly: 200, priceYearly: 2000 });
  assert.equal(row.discountType, 'fixed');
  assert.equal(row.discountValue, 400);
  assert.equal(inferredYearRow({ priceMonthly: 200, priceYearly: null }), null);
});

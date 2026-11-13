// FEE-01 + §3.3: plan pricing, split payment rules, recurring expenses, P&L.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { suggestPlanPrice, derivePlanPrices, dueDatesFor, generateInstances, dueReminders, instanceStatus } from '../src/finance.js';

const A = () => ctx.tokens.a;
before(() => setup('lms_finance_test'));
after(teardown);

test('FEE-01: ₹2,500 × 3 × (1−5%) = ₹7,125; changing base recomputes', async () => {
  assert.equal(suggestPlanPrice(2500, 3, 5), 7125);
  assert.deepEqual(derivePlanPrices(3000, [{ months: 3, discountPct: 5 }]).map(p => p.price), [8550]);
  assert.equal(suggestPlanPrice(999, 1, 12.5), 874);
  const r = await call('GET', '/api/fees/suggest?base=2500&tiers=1:0,3:5,6:10', { token: A() });
  assert.deepEqual(r.body.prices.map(p => p.price), [2500, 7125, 13500]);
});

test('split payments must sum exactly; negatives/fractions rejected', async () => {
  const pay = (receiptNo, breakdown, netTotal = 1000) => ({ receiptNo, studentId: 'S1', amount: netTotal, discount: 0, fine: 0, netTotal, method: 'Split', breakdown, date: '2026-10-05' });
  assert.equal((await call('POST', '/api/payments', { token: A(), body: pay('R1', [{ method: 'UPI', amount: 600, referenceNo: 'UTR-R1' }, { method: 'Cash', amount: 400 }]) })).status, 201);
  const bad = await call('POST', '/api/payments', { token: A(), body: pay('R2', [{ method: 'UPI', amount: 600 }, { method: 'Cash', amount: 300 }]) });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /add up exactly/);
  assert.equal((await call('POST', '/api/payments', { token: A(), body: pay('R3', [{ method: 'UPI', amount: 1200 }, { method: 'Cash', amount: -200 }]) })).status, 400);
  assert.equal((await call('POST', '/api/payments', { token: A(), body: pay('R4', [{ method: 'UPI', amount: 10.5 }, { method: 'Cash', amount: 989.5 }]) })).status, 400);
  const list = (await call('GET', '/api/payments', { token: A() })).body;
  assert.equal((await call('PUT', '/api/payments', { token: A(), body: [...list, pay('R5', [{ method: 'UPI', amount: 1 }])] })).status, 400);
  assert.equal((await call('PUT', '/api/payments', { token: A(), body: [...list, { receiptNo: 'REF-1', netTotal: -300, amount: -300, method: 'Refund', date: '2026-10-06' }] })).status, 200);
});

test('recurring schedule: month-end safe, every-2-months, custom, end date', () => {
  assert.deepEqual(dueDatesFor({ frequency: 'monthly', startDate: '2026-01-31', dueDay: 31 }, '2026-04-30').map(d => d.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(dueDatesFor({ frequency: 'every_2_months', startDate: '2026-01-10', endDate: '2026-06-30' }, '2026-12-31').map(d => d.dueDate), ['2026-01-10', '2026-03-10', '2026-05-10']);
  assert.deepEqual(dueDatesFor({ frequency: 'custom', intervalMonths: 4, startDate: '2026-01-01' }, '2026-12-31').map(d => d.periodKey), ['2026-01', '2026-05', '2026-09']);
});

test('recurring expenses: every category, idempotent, per-bill edit, payments, stop keeps history, tenant scoped', async () => {
  for (const category of ['Rent', 'Electricity', 'Miscellaneous', 'Coffee machine lease']) {
    const r = await call('POST', '/api/recurring-expenses', { token: A(), body: { category, amount: 1000, frequency: category === 'Electricity' ? 'every_2_months' : 'monthly', startDate: '2026-08-01', dueDay: 5 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  assert.equal((await call('POST', '/api/recurring-expenses', { token: A(), body: { category: 'Rent', amount: -1, frequency: 'monthly', startDate: '2026-08-01' } })).status, 400);
  const first = (await call('GET', '/api/expense-instances', { token: A() })).body.length;
  assert.ok(first >= 4);
  await Promise.all([generateInstances('lib-a'), generateInstances('lib-a'), generateInstances('lib-a')]);
  const all = (await call('GET', '/api/expense-instances', { token: A() })).body;
  assert.equal(all.length, first, 'retries must not duplicate bills');
  const elec = all.find(i => i.category === 'Electricity');
  assert.equal((await call('PATCH', `/api/expense-instances/${elec.id}`, { token: A(), body: { amount: 1740 } })).body.amount, 1740);
  assert.equal((await call('GET', '/api/recurring-expenses', { token: A() })).body.find(t => t.id === elec.templateId).amount, 1000);
  let r = await call('POST', `/api/expense-instances/${elec.id}/payments`, { token: A(), body: { amount: 740, date: '2026-10-02' } });
  assert.equal(r.body.paidAmount, 740); assert.notEqual(r.body.status, 'paid');
  assert.equal((await call('POST', `/api/expense-instances/${elec.id}/payments`, { token: A(), body: { amount: 1001 } })).status, 400);
  r = await call('POST', `/api/expense-instances/${elec.id}/payments`, { token: A(), body: { amount: 1000, date: '2026-10-03' } });
  assert.equal(r.body.status, 'paid');
  assert.equal((await call('POST', `/api/recurring-expenses/${elec.templateId}/stop`, { token: A() })).body.status, 'stopped');
  assert.ok((await call('GET', `/api/expense-instances?templateId=${elec.templateId}`, { token: A() })).body.length >= 1);
  assert.deepEqual((await call('GET', '/api/expense-instances', { token: ctx.tokens.b })).body, []);
  assert.equal((await call('GET', `/api/expense-instances/${elec.id}`, { token: ctx.tokens.b })).status, 404);
  assert.equal((await call('POST', `/api/expense-instances/${elec.id}/payments`, { token: ctx.tokens.b, body: { amount: 1 } })).status, 404);
});

test('reminders stop for paid bills', async () => {
  assert.equal(instanceStatus({ dueDate: '2026-11-10', amount: 500, paidAmount: 0 }, '2026-11-11'), 'overdue');
  assert.equal(instanceStatus({ dueDate: '2026-11-10', amount: 500, paidAmount: 500 }, '2026-11-11'), 'paid');
  const rem = await dueReminders('lib-a', '2026-10-05');
  assert.ok(rem.length > 0);
  assert.ok(rem.every(x => x.instance.paidAmount < x.instance.amount));
});

test('P&L reconciles fees, refunds, one-time + paid recurring expenses; CSV export', async () => {
  await call('POST', '/api/expenses', { token: A(), body: { id: 'EXP-1', category: 'Internet', amount: 500, date: '2026-10-04' } });
  const p = (await call('GET', '/api/reports/pnl?from=2026-10-01&to=2026-10-31', { token: A() })).body;
  assert.equal(p.feeCollections, 1000); assert.equal(p.refunds, 300); assert.equal(p.netFees, 700);
  assert.equal(p.expenses.oneTime, 500); assert.equal(p.expenses.recurringPaid, 1740);
  assert.equal(p.netCollections, -1540);
  assert.equal(p.byMethod.UPI, 600); assert.equal(p.byMethod.Cash, 400);
  const csv = await call('GET', '/api/reports/pnl.csv?from=2026-10-01&to=2026-10-31', { token: A() });
  assert.equal(csv.status, 200); assert.match(csv.body, /Net collections,-1540/);
  assert.equal((await call('GET', '/api/reports/pnl', { token: ctx.tokens.b })).body.feeCollections, 0);
});

test('voided receipts stay stored but out of P&L totals', async () => {
  assert.equal((await call('POST', '/api/payments', { token: A(), body: { receiptNo: 'VOID-KEEP-1', studentId: 'S1', amount: 777, netTotal: 777, method: 'Cash', date: '2026-11-05' } })).status, 201);
  assert.equal((await call('POST', '/api/payments', { token: A(), body: { receiptNo: 'VOID-KEEP-2', studentId: 'S1', amount: 333, netTotal: 333, method: 'Cash', date: '2026-11-05', voided: true, status: 'Voided' } })).status, 201);
  const list = (await call('GET', '/api/payments', { token: A() })).body;
  assert.ok(list.some(p => p.receiptNo === 'VOID-KEEP-2' && p.voided === true), 'voided row kept');
  const p = (await call('GET', '/api/reports/pnl?from=2026-11-05&to=2026-11-05', { token: A() })).body;
  assert.equal(p.feeCollections, 777, 'only the live receipt counts');
  assert.equal(p.byMethod.Cash, 777);
});

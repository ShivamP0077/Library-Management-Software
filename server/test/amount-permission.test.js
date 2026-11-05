// Issue #9: payment amount edits — Admin always, Manager on by default, Staff off; owner-only setting; audited.
// Server recomputes plan price and ignores client amountEdited flags (closes the staff bypass).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { roleCanEditAmount, amountEdits } from '../src/amountPermission.js';
import { expectedPayment } from '../src/planPrice.js';

const A = () => ctx.tokens.a;
const tok = {};
const pay = (receiptNo, amount, extra = {}) => ({ receiptNo, studentId: 'S1', amount, discount: 0, fine: 0, netTotal: amount, method: 'Cash', date: '2026-11-05', ...extra });

async function staffToken(staffId, email) {
  const inv = await call('POST', '/api/invites', { token: A(), body: { email, name: staffId, staffId } });
  const t = inv.body.link.split('#invite=')[1];
  return (await call('POST', '/api/auth/invite/accept', { body: { token: t, password: 'StaffPass-123' } })).body.token;
}

before(async () => {
  await setup('lms_amount_perm_test');
  await call('PUT', '/api/staffMembers', { token: A(), body: [
    { id: 'ST-A', name: 'Ann', role: 'Admin', status: 'Active' },
    { id: 'ST-M', name: 'Max', role: 'Manager', status: 'Active' },
    { id: 'ST-L', name: 'Lia', role: 'Librarian', status: 'Active' },
  ] });
  tok.admin = await staffToken('ST-A', 'ann@test.local');
  tok.mgr = await staffToken('ST-M', 'max@test.local');
  tok.lib = await staffToken('ST-L', 'lia@test.local');
  assert.ok(tok.admin && tok.mgr && tok.lib);
  // Seed a seat plan the server can price against.
  assert.equal((await call('PUT', '/api/plans', { token: A(), body: [
    { id: 'P1', name: 'Hall Full', price: 1000, durationPricing: [
      { durationMonths: 1, basePrice: 1000, discountType: 'None', discountValue: 0 },
      { durationMonths: 3, basePrice: 3000, discountType: 'Percentage', discountValue: 5 },
    ] },
  ] })).status, 200);
  assert.equal((await call('POST', '/api/payments', { token: A(), body: pay('R1', 1000, { planId: 'P1', durationMonths: 1, priceKind: 'renewal', suggestedAmount: 1000 }) })).status, 201);
});
after(teardown);

test('pure rule and edit detection (no trusted price → custom is an edit)', () => {
  assert.equal(roleCanEditAmount('Admin', { managerCanEditAmount: false }), true);
  assert.equal(roleCanEditAmount('Manager', {}), true);
  assert.equal(roleCanEditAmount('Manager', { managerCanEditAmount: false }), false);
  assert.equal(roleCanEditAmount('Librarian', {}), false);
  assert.equal(roleCanEditAmount('Librarian', { staffCanEditAmount: true }), true);
  const prev = new Map([['R1', pay('R1', 1000)]]);
  assert.equal(amountEdits([pay('R1', 1000)], prev).length, 0);
  assert.equal(amountEdits([pay('R1', 900)], prev).length, 1);
  // New payment without suggestedAmount / plan expectation is treated as custom.
  assert.equal(amountEdits([pay('R2', 900)], prev).length, 1, 'free-form new payment is an edit');
  assert.equal(amountEdits([pay('R2', 900, { suggestedAmount: 900 })], prev).length, 0, 'matching suggestedAmount ok');
  assert.equal(amountEdits([pay('R2', 500, { suggestedAmount: 900 })], prev).length, 1, 'mismatch is an edit');
  // Client amountEdited=false must NOT hide a mismatch.
  assert.equal(amountEdits([pay('R2', 500, { suggestedAmount: 900, amountEdited: false })], prev).length, 1);
});

test('expectedPayment matches approved plan / pro-rate maths', () => {
  const plan = { id: 'P1', price: 1000, durationPricing: [
    { durationMonths: 1, basePrice: 1000, discountType: 'None', discountValue: 0 },
    { durationMonths: 3, basePrice: 3000, discountType: 'Percentage', discountValue: 5 },
  ] };
  const one = expectedPayment({ planId: 'P1', durationMonths: 1, fine: 0, priceKind: 'renewal' }, { plan });
  assert.deepEqual(one, { amount: 1000, discount: 0, fine: 0, netTotal: 1000, source: 'renewal' });
  const three = expectedPayment({ planId: 'P1', durationMonths: 3, fine: 0, priceKind: 'renewal' }, { plan });
  assert.equal(three.amount, 3000);
  assert.equal(three.discount, 150); // 5%
  assert.equal(three.netTotal, 2850);
  const prorated = expectedPayment({
    planId: 'P1', durationMonths: 1, fine: 0, priceKind: 'admission',
    proRated: { from: '2026-06-20' },
  }, { plan, settings: { billingCycleMode: 'CALENDAR_MONTH', calendarBillingDay: 1 } });
  assert.equal(prorated.amount, 367);
  assert.equal(prorated.netTotal, 367);
});

test('staff (Librarian) cannot change an amount; honest new payments still work', async () => {
  const r = await call('PUT', '/api/payments/R1', { token: tok.lib, body: { amount: 900, netTotal: 900 } });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'amount_edit_forbidden');
  // Matching plan price (no client flag needed)
  assert.equal((await call('POST', '/api/payments', { token: tok.lib, body: pay('R2', 1000, { planId: 'P1', durationMonths: 1, priceKind: 'renewal' }) })).status, 201);
  // Bypass attempt: custom amount WITHOUT amountEdited flag — must be rejected
  assert.equal((await call('POST', '/api/payments', { token: tok.lib, body: pay('R3', 1, { planId: 'P1', durationMonths: 1, priceKind: 'renewal' }) })).status, 403);
  // Bypass attempt: free-form payment with no plan and no suggestedAmount
  assert.equal((await call('POST', '/api/payments', { token: tok.lib, body: pay('R3b', 1) })).status, 403);
  // amountEdited:false must not help
  assert.equal((await call('POST', '/api/payments', { token: tok.lib, body: pay('R3c', 1, { planId: 'P1', durationMonths: 1, priceKind: 'renewal', amountEdited: false }) })).status, 403);
  // Discount without permission
  assert.equal((await call('POST', '/api/payments', { token: tok.lib, body: pay('R3d', 1000, { planId: 'P1', durationMonths: 1, priceKind: 'renewal', discount: 100, netTotal: 900 }) })).status, 403);
  const list = (await call('GET', '/api/payments', { token: A() })).body;
  const bulk = list.map(p => p.receiptNo === 'R1' ? { ...p, amount: 1, netTotal: 1 } : p);
  assert.equal((await call('PUT', '/api/payments', { token: tok.lib, body: bulk })).status, 403, 'bulk sync also checked');
  assert.equal((await call('GET', '/api/payments/R1', { token: A() })).body.amount, 1000, 'nothing written');
});

test('Manager allowed by default; owner can switch it off; Admin staff always', async () => {
  assert.equal((await call('PUT', '/api/payments/R1', { token: tok.mgr, body: { amount: 950, netTotal: 950 } })).status, 200);
  assert.equal((await call('PUT', '/api/settings', { token: tok.mgr, body: { managerCanEditAmount: false } })).status, 403);
  assert.equal((await call('PUT', '/api/settings', { token: A(), body: { managerCanEditAmount: false } })).status, 200);
  assert.equal((await call('PUT', '/api/payments/R1', { token: tok.mgr, body: { amount: 940, netTotal: 940 } })).status, 403);
  assert.equal((await call('PUT', '/api/payments/R1', { token: tok.admin, body: { amount: 930, netTotal: 930 } })).status, 200);
  assert.equal((await call('PUT', '/api/payments/R1', { token: A(), body: { amount: 1000, netTotal: 1000 } })).status, 200, 'owner always');
});

test('amount edits and the permission change are in the audit log', async () => {
  const logs = (await call('GET', '/api/admin/audit-logs?tenantId=lib-a&limit=200', { token: ctx.tokens.sa })).body;
  const items = Array.isArray(logs) ? logs : (logs.items || logs.logs || []);
  const actions = items.map(l => l.action);
  assert.ok(actions.includes('payment.amount_edit'), JSON.stringify(actions).slice(0, 300));
  assert.ok(actions.includes('payment.amount_edit_denied'));
  assert.ok(actions.includes('settings.amount_edit_permission'));
  const e = items.find(l => l.action === 'payment.amount_edit' && l.target === 'R1');
  assert.ok(e.detail.from && e.detail.to);
});

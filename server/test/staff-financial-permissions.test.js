import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx, login } from './helpers.js';

const A = () => ctx.tokens.a;
const pay = (receiptNo) => ({
  receiptNo, studentId: 'S1', amount: 100, discount: 0, fine: 0, netTotal: 100,
  method: 'Cash', date: '2026-11-01', paidOn: '2026-11-01', suggestedAmount: 100,
});

async function staff(id, role, email, permissions) {
  const body = { id, name: id, role, status: 'Active', ...(permissions ? { permissions } : {}) };
  const saved = await call('POST', '/api/staffMembers', { token: A(), body });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const inv = await call('POST', '/api/invites', { token: A(), body: { email, name: id, staffId: id, permissions } });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const token = decodeURIComponent(inv.body.link.split('/invite/')[1]);
  const accepted = await call('POST', '/api/auth/invite/accept', { body: { token, password: 'StaffPass-123' } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  return accepted.body.token;
}

before(async () => {
  await setup('lms_staff_fin_perm');
  await call('POST', '/api/payments', { token: A(), body: pay('OWN-1') });
  await call('POST', '/api/expenses', { token: A(), body: { id: 'EX-1', category: 'Rent', amount: 40, date: '2026-11-01' } });
});
after(teardown);

test('Librarian cannot open Wallet even when Allow all says so', async () => {
  const token = await staff('LIB-1', 'Librarian', 'lib1@test.local', {
    allowAllFinancial: true,
    wallet: { view: true, create: true, manage: true },
    payments: { view: true, create: true, collect: true },
    reports: { view: true },
  });
  const saved = await call('GET', '/api/staffMembers/LIB-1', { token: A() });
  assert.equal(saved.body.permissions.wallet.view, false);
  assert.equal(saved.body.permissions.payments.collect, true);
  assert.equal((await call('GET', '/api/software-plan/wallet', { token })).status, 403);
  assert.equal((await call('GET', '/api/software-plan/wallet/history', { token })).status, 403);
  assert.equal((await call('POST', '/api/software-plan/wallet/topups', { token, headers: { 'Idempotency-Key': 'k1' }, body: { amountMinor: 100 } })).status, 403);
});

test('Manager and Accountant Wallet follows the grant', async () => {
  const no = await staff('MGR-0', 'Manager', 'mgr0@test.local', { payments: { view: true } });
  assert.equal((await call('GET', '/api/software-plan/wallet', { token: no })).status, 403);
  const yes = await staff('MGR-1', 'Manager', 'mgr1@test.local', { wallet: { view: true, collect: true, create: true } });
  assert.equal((await call('GET', '/api/software-plan/wallet', { token: yes })).status, 200);
  const acct = await staff('ACC-1', 'Accountant', 'acc1@test.local', { wallet: { view: true } });
  assert.equal((await call('GET', '/api/software-plan/wallet', { token: acct })).status, 200);
  assert.equal((await call('POST', '/api/software-plan/wallet/topups', { token: acct, headers: { 'Idempotency-Key': 'k2' }, body: { amountMinor: 100 } })).status, 403);
});

test('Net Profit is omitted unless permitted; owner still receives it', async () => {
  const token = await staff('REP-1', 'Accountant', 'rep1@test.local', { reports: { view: true, export: true } });
  const hidden = await call('GET', '/api/reports/pnl', { token });
  assert.equal(hidden.status, 200);
  assert.equal(Object.hasOwn(hidden.body, 'netCollections'), false);
  const csv = await call('GET', '/api/reports/pnl.csv', { token });
  assert.equal(csv.status, 200);
  assert.equal(String(csv.body).includes('Net collections'), false);
  const owner = await call('GET', '/api/reports/pnl', { token: A() });
  assert.equal(typeof owner.body.netCollections, 'number');
  const withProfit = await staff('REP-2', 'Accountant', 'rep2@test.local', { reports: { view: true, netProfit: true } });
  const shown = await call('GET', '/api/reports/pnl', { token: withProfit });
  assert.equal(typeof shown.body.netCollections, 'number');
});

test('View, collect, delete and export are enforced; owner is not', async () => {
  const viewOnly = await staff('PAY-1', 'Custom', 'pay1@test.local', { payments: { view: true }, expenses: { view: true } });
  assert.equal((await call('GET', '/api/payments', { token: viewOnly })).status, 200);
  assert.equal((await call('POST', '/api/payments', { token: viewOnly, body: pay('NO-1') })).status, 403);
  assert.equal((await call('DELETE', '/api/payments/OWN-1', { token: viewOnly })).status, 403);
  assert.equal((await call('POST', '/api/expenses', { token: viewOnly, body: { id: 'EX-2', category: 'Tea', amount: 5, date: '2026-11-02' } })).status, 403);
  assert.equal((await call('GET', '/api/reports/pnl.csv', { token: viewOnly })).status, 403);
  const collector = await staff('PAY-2', 'Librarian', 'pay2@test.local', { payments: { view: true, collect: true } });
  assert.equal((await call('POST', '/api/payments', { token: collector, body: pay('YES-1') })).status, 201);
  assert.equal((await call('DELETE', '/api/payments/YES-1', { token: collector })).status, 403);
  const remover = await staff('PAY-3', 'Accountant', 'pay3@test.local', { payments: { view: true, delete: true } });
  assert.equal((await call('DELETE', '/api/payments/YES-1', { token: remover })).status, 200);
  assert.equal((await call('GET', '/api/payments', { token: A() })).status, 200);
  assert.equal((await call('GET', '/api/reports/pnl.csv', { token: A() })).status, 200);
});

test('staff cannot grant themselves permissions', async () => {
  const token = await staff('SELF-1', 'Manager', 'self1@test.local', { staff: { view: true, edit: true }, payments: { view: true } });
  const own = await call('GET', '/api/staffMembers/SELF-1', { token: A() });
  const bumped = await call('PUT', '/api/staffMembers/SELF-1', {
    token,
    body: { ...own.body, permissions: { ...own.body.permissions, wallet: { view: true, manage: true } } },
  });
  assert.equal(bumped.status, 403);
  assert.equal(bumped.body.code, 'self_grant');
  const after = await call('GET', '/api/staffMembers/SELF-1', { token: A() });
  assert.notEqual(after.body.permissions?.wallet?.view, true);
});

test('state snapshot drops money the staff member cannot view', async () => {
  const token = await login('pay1@test.local', 'StaffPass-123');
  const state = await call('GET', '/api/state', { token });
  assert.equal(state.status, 200);
  assert.equal(state.body.financialAccess.payments, true);
  assert.equal(state.body.financialAccess.netProfit, false);
  const blind = await staff('BLIND-1', 'Librarian', 'blind1@test.local', { students: { view: true } });
  const hidden = await call('GET', '/api/state', { token: blind });
  assert.equal(hidden.body.financialAccess.payments, false);
  assert.equal(hidden.body.payments, undefined);
  assert.equal(hidden.body.financialAccess.expenses, false);
});

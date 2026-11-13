import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptState, receiptPeriod, receiptAmounts, receiptView, receiptPaidLine } from '../src/utils/receipt.js';

test('#12: status is never upgraded to paid when void/failed/unpaid/partial', () => {
  assert.equal(receiptState({ status: 'Paid' }).code, 'paid');
  assert.equal(receiptState({ status: 'paid' }).settled, true);
  assert.equal(receiptState({ paymentStatus: 'Void' }).code, 'void');
  assert.equal(receiptState({ status: 'Failed' }).settled, false);
  assert.equal(receiptState({ status: 'Unpaid' }).settled, false);
  assert.equal(receiptState({ status: 'Partial' }).code, 'partial');
  assert.equal(receiptState({ netTotal: 2000, paidAmount: 500 }).code, 'partial');
  assert.equal(receiptState({ netTotal: 2000, paidAmount: 500 }).settled, false);
  assert.equal(receiptState({ status: 'Paid', netTotal: 2000, paidAmount: 1000 }).code, 'partial');
  assert.equal(receiptState({ status: 'Paid', voided: true }).code, 'void');
});

test('#12: actual period/next due come from records, not from today', () => {
  const p = receiptPeriod(
    { startDate: '2026-01-01', endDate: '2026-02-01', nextDueDate: '2026-03-01' },
    { student: { startDate: '2025-01-01', expiryDate: '2025-02-01' } },
  );
  assert.deepEqual(p, { start: '2026-01-01', end: '2026-02-01', nextDue: '2026-03-01' });
  assert.equal(receiptPeriod({}, { renewal: { startDate: '2026-04-01', endDate: '2026-05-01' } }).nextDue, '2026-05-01');
});

test('#12: totals are only what the receipt stores', () => {
  assert.deepEqual(receiptAmounts({ basePrice: 1200, discount: 200, fine: 50 }), { base: 1200, discount: 200, fine: 50, netTotal: 1050 });
  assert.deepEqual(receiptAmounts({ netTotal: 900, discount: 100 }), { base: 900, discount: 100, fine: 0, netTotal: 900 });
});

test('receipt shows Paid on using paidOn, and falls back to date', () => {
  const view = receiptView({
    paidOn: '2026-12-07',
    date: '2026-12-10',
    periodStart: '2026-12-01',
    periodEnd: '2026-12-31',
  });
  assert.equal(view.paidOn, '2026-12-07');
  assert.equal(view.paidOnLine, 'Paid on 2026-12-07');
  assert.equal(receiptPaidLine({ date: '2026-11-02' }), 'Paid on 2026-11-02');
  assert.deepEqual(view.period, { start: '2026-12-01', end: '2026-12-31', nextDue: '2026-12-31' });
});

test('#12: view exposes operator label source and branch, never a fabricated operator', () => {
  const v = receiptView({ staffName: 'Asha', status: 'Paid' }, { student: { name: 'Ravi', id: 'S1' }, branch: { name: 'Central' } });
  assert.equal(v.operator, 'Asha');
  assert.equal(v.state.code, 'paid');
  assert.equal(v.studentName, 'Ravi');
  assert.equal(v.branchName, 'Central');
  assert.equal(receiptView({}, {}).operator, 'Admin');
});

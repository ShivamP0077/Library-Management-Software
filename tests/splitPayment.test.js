import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSplitAmountChange, computeCashRemainder, validateSplitPayment } from '../src/utils/splitPaymentUtils.js';

const rows = () => [{ method: 'UPI', amount: 0, isManual: false }, { method: 'Cash', amount: 1000, isManual: false }];

test('BUG-10: editing UPI recalculates cash remainder', () => {
  const r = handleSplitAmountChange(rows(), 0, 600, 1000);
  assert.deepEqual(r.map(x => [x.method, x.amount]), [['UPI', 600], ['Cash', 400]]);
});
test('BUG-10: cash row removed when remainder is zero', () => {
  const r = handleSplitAmountChange(rows(), 0, 1000, 1000);
  assert.deepEqual(r.map(x => x.method), ['UPI']);
});
test('BUG-10: overpayment clamped to total', () => {
  const r = handleSplitAmountChange(rows(), 0, 5000, 1000);
  assert.equal(r[0].amount, 1000);
});
test('BUG-10: negatives become 0', () => {
  const r = handleSplitAmountChange(rows(), 0, -50, 1000);
  assert.equal(r[0].amount, 0); assert.equal(r[1].amount, 1000);
});
test('BUG-10: three-way split keeps invariant', () => {
  let r = [{ method: 'UPI', amount: 0 }, { method: 'Card', amount: 0 }, { method: 'Cash', amount: 1000 }];
  r = handleSplitAmountChange(r, 0, 300, 1000);
  r = handleSplitAmountChange(r, 1, 200, 1000);
  assert.deepEqual(r.map(x => x.amount), [300, 200, 500]);
  assert.equal(computeCashRemainder(r, 1000), 500);
});
test('BUG-10: validation rejects mismatch and accepts exact', () => {
  assert.equal(validateSplitPayment([{ method: 'UPI', amount: 600 }, { method: 'Cash', amount: 300 }], 1000).valid, false);
  assert.equal(validateSplitPayment([{ method: 'UPI', amount: 600 }, { method: 'Cash', amount: 400 }], 1000).valid, true);
  assert.equal(validateSplitPayment([{ method: 'UPI', amount: 1100 }, { method: 'Cash', amount: -100 }], 1000).valid, false);
});

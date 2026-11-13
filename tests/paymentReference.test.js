import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCashMode, requiresReference, referenceError, paymentReferenceError,
  normalizePaymentReferences, receiptReferenceText, REFERENCE_REQUIRED_MSG, REFERENCE_LENGTH_MSG,
} from '../src/utils/paymentReference.js';
import { receiptView } from '../src/utils/receipt.js';

test('cash does not need a reference; every other mode does', () => {
  for (const mode of ['Cash', 'cash', ' CASH ']) {
    assert.equal(isCashMode(mode), true);
    assert.equal(requiresReference(mode), false);
    assert.equal(referenceError(mode, ''), '');
  }
  for (const mode of ['UPI', 'Card', 'Bank Transfer', 'Net Banking', 'Cheque', 'cheque']) {
    assert.equal(isCashMode(mode), false);
    assert.equal(requiresReference(mode), true);
    assert.equal(referenceError(mode, ''), REFERENCE_REQUIRED_MSG);
    assert.equal(referenceError(mode, '  UTR1  '), '');
  }
  assert.equal(requiresReference('Split'), false);
  assert.equal(requiresReference('Refund'), false);
  assert.equal(requiresReference(''), false);
});

test('reference is trimmed, required on new non-cash payments, and capped at 64', () => {
  const upi = { method: 'UPI', referenceNo: '  ABC  ' };
  normalizePaymentReferences(upi, { required: true });
  assert.equal(upi.referenceNo, 'ABC');

  assert.equal(paymentReferenceError({ method: 'UPI', referenceNo: '   ' }), REFERENCE_REQUIRED_MSG);
  assert.equal(paymentReferenceError({ method: 'Cash' }), '');
  assert.equal(paymentReferenceError({ method: 'UPI', referenceNo: 'x'.repeat(65) }), REFERENCE_LENGTH_MSG);
  assert.equal(paymentReferenceError({ method: 'Cheque', referenceNo: 'CHQ-1' }), '');

  const split = {
    method: 'Split',
    breakdown: [{ method: 'UPI', amount: 600, referenceNo: '  U1 ' }, { method: 'Cash', amount: 400, referenceNo: 'ignored' }],
  };
  normalizePaymentReferences(split, { required: true });
  assert.equal(split.breakdown[0].referenceNo, 'U1');
  assert.equal(split.breakdown[1].referenceNo, undefined);
  assert.equal(paymentReferenceError({
    method: 'Split',
    breakdown: [{ method: 'Card', amount: 10 }, { method: 'Cash', amount: 10 }],
  }), REFERENCE_REQUIRED_MSG);
});

test('old payments without a reference stay valid', () => {
  const old = { method: 'UPI', netTotal: 500 };
  normalizePaymentReferences(old, { required: false });
  assert.equal(old.referenceNo, undefined);
  assert.equal(paymentReferenceError(old, { required: false }), '');
});

test('receipt text and the printed view include Ref only when present', () => {
  assert.equal(receiptReferenceText({ method: 'UPI', referenceNo: '  1234 ' }), 'Ref: 1234');
  assert.equal(receiptReferenceText({ method: 'Cash' }), '');
  assert.equal(receiptReferenceText({
    method: 'Split',
    breakdown: [{ method: 'UPI', referenceNo: 'U9' }, { method: 'Cheque', referenceNo: 'C2' }],
  }), 'Ref: UPI U9, Cheque C2');
  assert.equal(receiptView({ method: 'UPI', referenceNo: 'UTR9', netTotal: 100 }).referenceLine, 'Ref: UTR9');
  assert.equal(receiptView({ method: 'Cash', netTotal: 100 }).referenceLine, '');
});

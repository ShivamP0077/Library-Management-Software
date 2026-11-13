// New non-cash payments need a trimmed reference. Older payments without one still save.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { validatePayment, ValidationError } from '../src/finance.js';
import { feeReceiptPdfLines } from '../src/pdf.js';
import { isCashMode, requiresReference } from '../../src/utils/paymentReference.js';

const A = () => ctx.tokens.a;
before(() => setup('lms_payment_reference_test'));
after(teardown);

const pay = (extra) => ({ receiptNo: 'P-1', studentId: 'S1', amount: 500, netTotal: 500, date: '2026-11-01', ...extra });

test('shared helper: cash is the only mode that skips a reference', () => {
  assert.equal(isCashMode('Cash'), true);
  assert.equal(requiresReference('UPI'), true);
  assert.equal(requiresReference('Cheque'), true);
  assert.equal(requiresReference('Cash'), false);
  const row = { method: 'UPI', referenceNo: '  utr  ' };
  validatePayment(row, { checkPaidOn: false, checkReference: true });
  assert.equal(row.referenceNo, 'utr');
  assert.throws(() => validatePayment({ method: 'Card', amount: 10, netTotal: 10 }, { checkPaidOn: false, checkReference: true }), ValidationError);
  validatePayment({ method: 'UPI', amount: 10, netTotal: 10 }, { checkPaidOn: false, checkReference: false });
});

test('pdf receipt lines include Ref when a reference was stored', () => {
  assert.deepEqual(
    feeReceiptPdfLines({ receiptNo: 'R9', method: 'UPI', netTotal: 800, referenceNo: 'UTR9' }).filter(l => l.startsWith('Ref:')),
    ['Ref: UTR9'],
  );
  assert.equal(feeReceiptPdfLines({ receiptNo: 'R8', method: 'Cash', netTotal: 100 }).some(l => l.startsWith('Ref:')), false);
});

test('server rejects a new non-cash payment without a reference and keeps old ones', async () => {
  const missing = await call('POST', '/api/payments', { token: A(), body: pay({ receiptNo: 'NO-REF', method: 'UPI' }) });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /Reference \/ UTR number is required/);

  const long = await call('POST', '/api/payments', { token: A(), body: pay({ receiptNo: 'LONG', method: 'Cheque', referenceNo: 'x'.repeat(65) }) });
  assert.equal(long.status, 400);
  assert.match(long.body.error, /64 characters or fewer/);

  const created = await call('POST', '/api/payments', { token: A(), body: pay({ receiptNo: 'OK-UPI', method: 'UPI', referenceNo: '  UTR-42  ' }) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.referenceNo, 'UTR-42');

  const cash = await call('POST', '/api/payments', { token: A(), body: pay({ receiptNo: 'OK-CASH', method: 'Cash' }) });
  assert.equal(cash.status, 201);

  const splitMissing = await call('POST', '/api/payments', { token: A(), body: pay({
    receiptNo: 'SPLIT-BAD', method: 'Split', netTotal: 500, amount: 500,
    breakdown: [{ method: 'UPI', amount: 200 }, { method: 'Cash', amount: 300 }],
  }) });
  assert.equal(splitMissing.status, 400);
  assert.match(splitMissing.body.error, /Reference \/ UTR number is required/);

  const split = await call('POST', '/api/payments', { token: A(), body: pay({
    receiptNo: 'SPLIT-OK', method: 'Split', netTotal: 500, amount: 500,
    breakdown: [{ method: 'Net Banking', amount: 200, referenceNo: '  NB1 ' }, { method: 'Cash', amount: 300 }],
  }) });
  assert.equal(split.status, 201, JSON.stringify(split.body));
  assert.equal(split.body.breakdown[0].referenceNo, 'NB1');
  assert.equal(split.body.breakdown[1].referenceNo, undefined);

  const edited = await call('PUT', '/api/payments/OK-CASH', { token: A(), body: { method: 'UPI' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.method, 'UPI');
  assert.equal(edited.body.referenceNo, undefined);
});

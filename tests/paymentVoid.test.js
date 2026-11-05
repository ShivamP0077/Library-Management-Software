import test from 'node:test';
import assert from 'node:assert/strict';
import { isVoidedPayment, sumActivePayments, buildRenewalVoid, markPaymentVoided } from '../src/utils/paymentVoid.js';

const renew = { renewalId: 'RN-2', receiptNo: 'RCP-2', planName: 'Monthly', startDate: '2026-12-01', endDate: '2026-12-31', amountPaid: 900 };
const adm = { renewalId: 'RN-1', receiptNo: 'RCP-1', planName: 'Monthly', startDate: '2026-11-01', endDate: '2026-11-30', amountPaid: 800 };
const student = {
  id: 'S1', joinedDate: '2026-11-01', planId: 'P1', planName: 'Monthly', shift: 'Full', seatNo: 'A1',
  renewalHistory: [renew, adm],
  paymentHistory: [
    { receiptNo: 'RCP-2', amount: 900, netTotal: 900 },
    { receiptNo: 'RCP-1', amount: 800, netTotal: 800 },
  ],
};

test('voided payments are excluded from totals but still counted in the list', () => {
  const list = [
    { receiptNo: 'A', netTotal: 1000 },
    { receiptNo: 'B', netTotal: 500, voided: true, status: 'Voided' },
    { receiptNo: 'C', netTotal: 200, status: 'Voided' },
  ];
  assert.equal(sumActivePayments(list), 1000);
  assert.equal(isVoidedPayment(list[1]), true);
  assert.equal(isVoidedPayment(list[0]), false);
  assert.equal(markPaymentVoided(list[0], { today: '2026-11-05', staffName: 'Owner' }).status, 'Voided');
});

test('renewal void keeps the record and marks payment Voided (no delete)', () => {
  const r = buildRenewalVoid(student, 'RN-2', { today: '2026-11-05', staffName: 'Owner' });
  assert.equal(r.receiptNo, 'RCP-2');
  assert.equal(r.updates.renewalHistory.length, 2, 'both renewals kept');
  assert.equal(r.updates.renewalHistory[0].voided, true);
  assert.equal(r.updates.renewalHistory[1].voided, undefined);
  assert.equal(r.updates.paymentHistory[0].voided, true);
  assert.equal(r.updates.paymentHistory[0].status, 'Voided');
  assert.equal(r.updates.paymentHistory[1].voided, undefined);
  assert.equal(r.updates.voidHistory[0].type, 'renewal_void');
  assert.equal(student.renewalHistory[0].voided, undefined, 'input not mutated');
});

test('already-voided renewal returns null', () => {
  const s = { ...student, renewalHistory: [{ ...renew, voided: true }, adm] };
  assert.equal(buildRenewalVoid(s, 'RN-2', { today: '2026-11-05' }), null);
});

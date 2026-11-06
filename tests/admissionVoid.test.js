import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdmissionVoid, buildAdmissionVoid } from '../src/utils/admissionVoid.js';

const adm = { renewalId: 'RN-1', receiptNo: 'RCP-1', planName: 'Monthly', startDate: '2026-11-01', endDate: '2026-11-30', amountPaid: 800 };
const base = { id: 'S1', seatNo: 'A1', status: 'Active', startDate: '2026-11-01', expiryDate: '2026-11-30', renewalHistory: [adm], paymentHistory: [{ receiptNo: 'RCP-1', amount: 800 }] };

test('only admission voids free the seat', () => {
  assert.equal(isAdmissionVoid(base, 'RN-1'), true);
  const withRenewal = { ...base, renewalHistory: [{ renewalId: 'RN-2', receiptNo: 'RCP-2' }, adm] };
  assert.equal(isAdmissionVoid(withRenewal, 'RN-1'), false, 'newer active renewal: no seat change');
  assert.equal(isAdmissionVoid(withRenewal, 'RN-2'), false, 'renewal void is not an admission void');
  assert.equal(isAdmissionVoid({ ...base, renewalHistory: [{ ...adm, voided: true }] }, 'RN-1'), false, 'already voided');
});

test('admission void keeps the record, adds audit, frees seat and ends plan', () => {
  const r = buildAdmissionVoid(base, 'RN-1', { today: '2026-11-05', staffName: 'Owner' });
  assert.equal(r.receiptNo, 'RCP-1');
  assert.equal(r.updates.seatNo, 'None');
  assert.equal(r.updates.status, 'Expired');
  assert.equal(r.updates.expiryDate, '2026-10-31');
  assert.equal(r.updates.renewalHistory.length, 1);
  assert.equal(r.updates.renewalHistory[0].voided, true);
  assert.equal(r.updates.paymentHistory[0].voided, true);
  assert.equal(r.updates.voidHistory[0].previousSeat, 'A1');
  assert.equal(r.updates.voidHistory[0].type, 'admission_void');
  assert.equal(base.seatNo, 'A1', 'input not mutated');
});

test('admission void after a voided renewal still counts as admission', () => {
  const s = { ...base, renewalHistory: [{ renewalId: 'RN-2', voided: true }, adm] };
  assert.equal(isAdmissionVoid(s, 'RN-1'), true);
});

// Payment date is separate from the service period. New paidOn values must be today or up to 60 days ago.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { paidOnError, validatePayment, ValidationError, todayIn, applyPaidOn } from '../src/finance.js';
import { receiptSendable } from '../src/reminders.js';

const A = () => ctx.tokens.a;
before(() => setup('lms_paid_on_test'));
after(teardown);

const shift = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

test('paidOn is rejected when it is in the future or more than 60 days ago', () => {
  const today = todayIn();
  assert.equal(paidOnError(today, today), '');
  assert.equal(paidOnError(shift(today, -60), today), '');
  assert.match(paidOnError(shift(today, 1), today), /future/);
  assert.match(paidOnError(shift(today, -61), today), /60 days/);
  assert.throws(() => validatePayment({ amount: 100, netTotal: 100, method: 'Cash', paidOn: shift(today, 1) }), ValidationError);
  const kept = applyPaidOn({ paidOn: today, date: '2020-01-01' }, { today });
  assert.equal(kept.date, today);
  assert.ok(kept.enteredAt);
});

test('server rejects a future or too-old paidOn on a payment and on a new renewal', async () => {
  const today = todayIn();
  const future = shift(today, 1);
  const tooOld = shift(today, -61);
  const ok = shift(today, -3);
  const pay = (receiptNo, paidOn) => ({ receiptNo, studentId: 'S1', amount: 500, netTotal: 500, method: 'Cash', date: paidOn, paidOn });
  assert.equal((await call('POST', '/api/payments', { token: A(), body: pay('OK-1', ok) })).status, 201);
  const saved = await call('GET', '/api/payments/OK-1', { token: A() });
  assert.equal(saved.body.date, ok);
  assert.equal(saved.body.paidOn, ok);
  assert.ok(saved.body.enteredAt);
  const futurePay = await call('POST', '/api/payments', { token: A(), body: pay('BAD-F', future) });
  assert.equal(futurePay.status, 400);
  assert.match(futurePay.body.error, /future/);
  const oldPay = await call('POST', '/api/payments', { token: A(), body: pay('BAD-O', tooOld) });
  assert.equal(oldPay.status, 400);
  assert.match(oldPay.body.error, /60 days/);

  const student = await call('POST', '/api/students', { token: A(), body: {
    id: 'S-PAID', name: 'Ravi', expiryDate: '2026-12-31',
    renewalHistory: [{ renewalId: 'RN-NEW', paidOn: future, startDate: '2026-12-01', endDate: '2026-12-31' }],
  } });
  assert.equal(student.status, 400);
  assert.match(student.body.error, /future/);

  const goodStudent = await call('POST', '/api/students', { token: A(), body: {
    id: 'S-OK', name: 'Asha', expiryDate: '2026-12-31',
    renewalHistory: [{ renewalId: 'RN-OK', paidOn: ok, date: '2020-01-01', startDate: '2026-12-01', endDate: '2026-12-31' }],
    paymentHistory: [{ receiptNo: 'PH-1', paidOn: ok, date: '2020-01-01' }],
  } });
  assert.equal(goodStudent.status, 201, JSON.stringify(goodStudent.body));
  assert.equal(goodStudent.body.renewalHistory[0].date, ok);
  assert.equal(goodStudent.body.paymentHistory[0].paidOn, ok);
});

test('a backdated payment is still sent as a receipt', () => {
  assert.equal(receiptSendable({ studentId: 'S1', netTotal: 800, method: 'UPI', paidOn: '2026-01-02', date: '2026-01-02' }), true);
  assert.equal(receiptSendable({ studentId: 'S1', netTotal: 0, method: 'Cash', paidOn: '2026-11-01' }), false);
  assert.equal(receiptSendable({ studentId: 'S1', netTotal: -100, method: 'Refund' }), false);
});

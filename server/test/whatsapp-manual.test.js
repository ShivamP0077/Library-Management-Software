import test from 'node:test';
import assert from 'node:assert/strict';
import { sendManualMessage, MANUAL_TYPES } from '../src/whatsapp.js';

const stu = { _key: 'S1', tenantId: 'L1', name: 'Asha', phone: '9876543210' };
const pay = { _key: 'R1', tenantId: 'L1', studentId: 'S1', netTotal: 1200, receiptNo: 'R1', date: '2026-11-01' };
const finder = (rows) => ({ findOne: (q) => ({ lean: async () => rows.find(r => r.tenantId === q.tenantId && r._key === q._key) || null }) });
const deps = (sent) => ({ Students: finder([stu]), Payments: finder([pay, { ...pay, _key: 'R2', studentId: 'S9' }]), send: async (a) => { sent.push(a); return { status: 'sent', id: 'x' }; } });

test('manual types', () => { assert.deepEqual(MANUAL_TYPES, ['fee_reminder', 'fee_receipt', 'renewal_reminder', 'seat_info', 'custom']); });

test('sends a custom message once per click with a unique dedupe key', async () => {
  const sent = [];
  const a = await sendManualMessage({ tenantId: 'L1', libraryId: 'L1', studentId: 'S1', type: 'custom', text: ' Hi ' }, deps(sent));
  await sendManualMessage({ tenantId: 'L1', libraryId: 'L1', studentId: 'S1', type: 'custom', text: 'Hi' }, deps(sent));
  assert.equal(a.status, 'sent');
  assert.equal(sent[0].text, 'Hi'); assert.equal(sent[0].manual, true); assert.equal(sent[0].to, '9876543210');
  assert.notEqual(sent[0].dedupeKey, sent[1].dedupeKey);
});

test('rejects bad input and other tenants', async () => {
  const sent = [];
  const call = (o) => sendManualMessage({ tenantId: 'L1', libraryId: 'L1', studentId: 'S1', type: 'custom', text: 'x', ...o }, deps(sent));
  assert.equal((await call({ type: 'otp' })).httpStatus, 400);
  assert.equal((await call({ text: '  ' })).httpStatus, 400);
  assert.equal((await call({ tenantId: 'L2' })).httpStatus, 404);
  assert.equal((await call({ type: 'fee_receipt', receiptNo: 'R2' })).httpStatus, 404);
  assert.equal((await call({ type: 'fee_receipt' })).httpStatus, 400);
  assert.equal(sent.length, 0);
});

test('receipt falls back to built receipt text', async () => {
  const sent = [];
  await sendManualMessage({ tenantId: 'L1', libraryId: 'L1', studentId: 'S1', type: 'fee_receipt', receiptNo: 'R1', text: '' }, deps(sent));
  assert.match(sent[0].text, /Receipt: R1/);
  assert.equal(sent[0].type, 'fee_receipt');
});

test('profile personal message: goes only to that student\'s own number; no phone = not sent', async () => {
  const sent = [];
  const noPhone = { _key: 'S2', tenantId: 'L1', name: 'Ravi' };
  const d = { ...deps(sent), Students: finder([stu, noPhone]) };
  const r = await sendManualMessage({ tenantId: 'L1', libraryId: 'L1', studentId: 'S1', type: 'custom', text: 'Hello Asha, your locker key is ready.', to: '9999999999' }, d);
  assert.equal(r.status, 'sent'); assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '9876543210', 'number comes from the student record, not the request');
  assert.equal(sent[0].type, 'custom');
  assert.equal((await sendManualMessage({ tenantId: 'L1', libraryId: 'L1', studentId: 'S2', type: 'custom', text: 'Hi' }, d)).httpStatus, 400);
  assert.equal(sent.length, 1);
});

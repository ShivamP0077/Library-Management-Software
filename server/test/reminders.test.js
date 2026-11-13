// WA-02 (non-quota): scheduled fee/expiry reminders, cancellation on pay/renew, dedupe, auto receipts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { planReminders, sendDueReminders, ReminderSchedule, setReceiptDeps, desiredFor, DEFAULT_REMINDER_SETTINGS } from '../src/reminders.js';
import { WhatsappConfig, WhatsappMessage } from '../src/whatsapp.js';
import { todayIn } from '../src/finance.js';

const A = () => ctx.tokens.a;
const sent = [];
const client = { sendText: async (inst, to, body) => { sent.push({ inst, to, body }); return { key: { id: `m${sent.length}` } }; } };
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const today = todayIn();

before(async () => {
  await setup('lms_reminders_test');
  await WhatsappConfig.updateOne({ libraryId: 'lib-a' }, { $set: { enabled: true, feeReminders: true, expiryReminders: true, receipts: true } }, { upsert: true });
});
after(async () => { setReceiptDeps({}); await teardown(); });

test('settings validate and are tenant-scoped', async () => {
  let r = await call('PUT', '/api/reminders/settings', { token: A(), body: { expiryDaysBefore: 2, feeEveryDays: 2, feeMaxReminders: 2 } });
  assert.equal(r.status, 200); assert.equal(r.body.expiryDaysBefore, 2); assert.equal(r.body.feeMaxReminders, 2);
  r = await call('PUT', '/api/reminders/settings', { token: A(), body: { feeEveryDays: 0 } });
  assert.equal(r.status, 400);
  const b = await call('GET', '/api/reminders/settings', { token: ctx.tokens.b });
  assert.equal(b.body.expiryDaysBefore, DEFAULT_REMINDER_SETTINGS.expiryDaysBefore);
});

test('reminder rules do not plan a day that is already in the past', () => {
  const rules = [{ id: 'a', offsetDays: -3, sendHour: 10, enabled: true }];
  assert.deepEqual(desiredFor({ _key: 'S', expiryDate: '2026-12-10' }, { rules }, '2026-12-10'), []);
  assert.equal(desiredFor({ _key: 'S', expiryDate: '2026-12-20' }, { rules }, '2026-12-10')[0].sendOn, '2026-12-17');
  // Legacy single reminder: nothing is planned once the expiry date itself has passed.
  assert.deepEqual(desiredFor({ _key: 'S', expiryDate: '2026-12-01' }, { ...DEFAULT_REMINDER_SETTINGS }, '2026-12-10'), []);
});

test('fixed-day expiry option never schedules after the expiry date', () => {
  const [e] = desiredFor({ _key: 'X', expiryDate: '2026-12-10' }, { ...DEFAULT_REMINDER_SETTINGS, expiryFixedDay: 5 }, '2026-11-01');
  assert.equal(e.sendOn, '2026-12-05');
  const [e2] = desiredFor({ _key: 'X', expiryDate: '2026-12-03' }, { ...DEFAULT_REMINDER_SETTINGS, expiryDaysBefore: 1, expiryFixedDay: 5 }, '2026-11-01');
  assert.equal(e2.sendOn, '2026-12-02');
});

test('expiry reminder: one per period, renewal cancels it, never sent twice', async () => {
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S1', name: 'Asha', phone: '9876543210', expiryDate: addDays(today, 2) }] });
  await planReminders('lib-a', { today }); await planReminders('lib-a', { today });
  let rows = await ReminderSchedule.find({ tenantId: 'lib-a', studentId: 'S1' }).lean();
  assert.equal(rows.length, 1); assert.equal(rows[0].type, 'expiry_reminder'); assert.equal(rows[0].sendOn, today);
  const r1 = await sendDueReminders('lib-a', { today, deps: { client } });
  assert.equal(r1.sent, 1); assert.match(sent.at(-1).body, /ends on/);
  // retry run: nothing more is sent
  await ReminderSchedule.updateOne({ tenantId: 'lib-a', studentId: 'S1' }, { $set: { status: 'scheduled' } });
  const n = sent.length; await sendDueReminders('lib-a', { today, deps: { client } });
  assert.equal(sent.length, n, 'dedupe prevented a second message');
  // renewal: new period planned in future, nothing stale left scheduled
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S1', name: 'Asha', phone: '9876543210', expiryDate: addDays(today, 40) }] });
  await planReminders('lib-a', { today });
  rows = await ReminderSchedule.find({ tenantId: 'lib-a', studentId: 'S1', status: 'scheduled' }).lean();
  assert.equal(rows.length, 1); assert.equal(rows[0].sendOn, addDays(today, 38));
});

test('a renewal between plan and send cancels the queued expiry reminder', async () => {
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S2', name: 'Ravi', phone: '9876500000', expiryDate: addDays(today, 1) }] });
  await planReminders('lib-a', { today });
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S2', name: 'Ravi', phone: '9876500000', expiryDate: addDays(today, 30) }] });
  const n = sent.length;
  const r = await sendDueReminders('lib-a', { today, deps: { client } });
  assert.equal(sent.length, n); assert.ok(r.cancelled >= 1);
  const row = await ReminderSchedule.findOne({ tenantId: 'lib-a', studentId: 'S2', periodKey: addDays(today, 1) }).lean();
  assert.equal(row.status, 'cancelled'); assert.equal(row.reason, 'renewed');
});

test('fee reminders reflect partial payments and stop once paid', async () => {
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S3', name: 'Meena', phone: '9876511111', expiryDate: addDays(today, 60), dueAmount: 1000 }] });
  await planReminders('lib-a', { today });
  const fee = await ReminderSchedule.find({ tenantId: 'lib-a', studentId: 'S3', type: 'fee_reminder' }).sort({ sendOn: 1 }).lean();
  assert.deepEqual(fee.map(f => f.sendOn), [today, addDays(today, 2)]);
  // partial payment before send → message shows remaining amount
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S3', name: 'Meena', phone: '9876511111', expiryDate: addDays(today, 60), dueAmount: 400 }] });
  await sendDueReminders('lib-a', { today, deps: { client } });
  assert.match(sent.at(-1).body, /₹400/);
  // paid in full → remaining reminder cancelled
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S3', name: 'Meena', phone: '9876511111', expiryDate: addDays(today, 60), dueAmount: 0 }] });
  await planReminders('lib-a', { today: addDays(today, 2) });
  const n = sent.length; await sendDueReminders('lib-a', { today: addDays(today, 2), deps: { client } });
  assert.equal(sent.length, n);
  const left = await ReminderSchedule.findOne({ tenantId: 'lib-a', studentId: 'S3', sendOn: addDays(today, 2) }).lean();
  assert.equal(left.status, 'cancelled'); assert.equal(left.reason, 'paid');
});

test('owner toggle off → skipped, not sent; reminders list visible to owner only', async () => {
  await WhatsappConfig.updateOne({ libraryId: 'lib-a' }, { $set: { feeReminders: false } });
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S4', name: 'Off', phone: '9876522222', expiryDate: addDays(today, 60), dueAmount: 50 }] });
  await planReminders('lib-a', { today });
  const n = sent.length; await sendDueReminders('lib-a', { today, deps: { client } });
  assert.equal(sent.length, n);
  const list = (await call('GET', '/api/reminders?studentId=S4&status=skipped', { token: A() })).body;
  assert.equal(list[0].status, 'skipped'); assert.equal(list[0].reason, 'disabled');
  assert.equal((await call('GET', '/api/reminders', { token: ctx.tokens.b })).body.length, 0, 'tenant isolation');
  await WhatsappConfig.updateOne({ libraryId: 'lib-a' }, { $set: { feeReminders: true } });
});

test('auto receipt on new payment: admission then renewal, once per receipt', async () => {
  setReceiptDeps({ client });
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S5', name: 'Kiran', phone: '9876533333', expiryDate: addDays(today, 30) }] });
  const n = sent.length;
  await call('POST', '/api/payments', { token: A(), body: { id: 'R-1', receiptNo: 'R-1', studentId: 'S5', amount: 800, netTotal: 800, method: 'Cash', date: today } });
  assert.equal(sent.length, n + 1); assert.match(sent.at(-1).body, /R-1/);
  let msg = await WhatsappMessage.findOne({ libraryId: 'lib-a', dedupeKey: 'receipt:R-1' }).lean();
  assert.equal(msg.type, 'admission_receipt');
  const all = (await call('GET', '/api/payments', { token: A() })).body;
  await call('PUT', '/api/payments', { token: A(), body: [...all, { id: 'R-2', receiptNo: 'R-2', studentId: 'S5', amount: 800, netTotal: 800, method: 'UPI', date: today }] });
  assert.equal(sent.length, n + 2);
  msg = await WhatsappMessage.findOne({ libraryId: 'lib-a', dedupeKey: 'receipt:R-2' }).lean();
  assert.equal(msg.type, 'renewal_receipt');
  // re-syncing the same list sends nothing new
  await call('PUT', '/api/payments', { token: A(), body: (await call('GET', '/api/payments', { token: A() })).body });
  assert.equal(sent.length, n + 2);
});

test('auto receipt when the payment arrives before the student (admission race)', async () => {
  setReceiptDeps({ client, retryMs: [20] });
  const n = sent.length;
  const all = (await call('GET', '/api/payments', { token: A() })).body;
  await call('PUT', '/api/payments', { token: A(), body: [...all, { id: 'R-9', receiptNo: 'R-9', studentId: 'S9', amount: 500, netTotal: 500, method: 'Cash', date: today }] });
  assert.equal(sent.length, n, 'no student yet: nothing sent');
  let msg = await WhatsappMessage.findOne({ libraryId: 'lib-a', dedupeKey: 'receipt:R-9' }).lean();
  assert.equal(msg.status, 'skipped'); assert.equal(msg.reason, 'no_student');
  const students = (await call('GET', '/api/students', { token: A() })).body;
  await call('PUT', '/api/students', { token: A(), body: [...students, { id: 'S9', name: 'Meera', phone: '9876544444', expiryDate: addDays(today, 30) }] });
  assert.equal(sent.length, n + 1); assert.match(sent.at(-1).body, /R-9/);
  msg = await WhatsappMessage.findOne({ libraryId: 'lib-a', dedupeKey: 'receipt:R-9' }).lean();
  assert.equal(msg.status, 'sent'); assert.equal(msg.type, 'admission_receipt');
  // re-syncing students does not resend
  await call('PUT', '/api/students', { token: A(), body: (await call('GET', '/api/students', { token: A() })).body });
  assert.equal(sent.length, n + 1);
});

test('skipped receipt rows record why (no_phone)', async () => {
  setReceiptDeps({ client, retryMs: [] });
  const students = (await call('GET', '/api/students', { token: A() })).body;
  await call('PUT', '/api/students', { token: A(), body: [...students, { id: 'S10', name: 'NoPhone', expiryDate: addDays(today, 30) }] });
  await call('POST', '/api/payments', { token: A(), body: { id: 'R-10', receiptNo: 'R-10', studentId: 'S10', amount: 500, netTotal: 500, method: 'Cash', date: today } });
  const msg = await WhatsappMessage.findOne({ libraryId: 'lib-a', dedupeKey: 'receipt:R-10' }).lean();
  assert.equal(msg.status, 'skipped'); assert.equal(msg.reason, 'no_phone');
});

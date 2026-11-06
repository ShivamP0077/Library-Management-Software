// Issue #17: WhatsApp templates + auto-reminder rules (integration, in-memory MongoDB).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { planReminders, sendDueReminders, ReminderSchedule, desiredFor, validateRules, reminderText, DEFAULT_REMINDER_SETTINGS } from '../src/reminders.js';
import { renderTemplate } from '../src/templates.js';
import { WhatsappConfig } from '../src/whatsapp.js';
import { todayIn } from '../src/finance.js';

const A = () => ctx.tokens.a;
const sent = [];
const client = { sendText: async (inst, to, body) => { sent.push({ inst, to, body }); return { key: { id: `m${sent.length}` } }; } };
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const today = todayIn();

before(async () => {
  await setup('lms_templates_test');
  await WhatsappConfig.updateOne({ libraryId: 'lib-a' }, { $set: { enabled: true, feeReminders: true, expiryReminders: true } }, { upsert: true });
});
after(teardown);

test('renderTemplate fills known vars and keeps unknown ones', () => {
  assert.equal(renderTemplate('Hi {name}, {amount} by {dueDate} at {library}, seat {seat} {x}', { name: 'Asha', amount: '500', dueDate: '2026-12-01', library: 'BL', seat: 'A1' }), 'Hi Asha, 500 by 2026-12-01 at BL, seat A1 {x}');
});

test('templates: save, tenant-scoped, reset to default, validation', async () => {
  let r = await call('PUT', '/api/whatsapp-templates', { token: A(), body: { renewal_reminder: 'Hi {name}, renew by {dueDate} at {library}.' } });
  assert.equal(r.status, 200); assert.match(r.body.renewal_reminder, /renew by/);
  r = await call('GET', '/api/whatsapp-templates', { token: ctx.tokens.b });
  assert.deepEqual(r.body, {}, 'library B does not see A\'s templates');
  r = await call('PUT', '/api/whatsapp-templates', { token: A(), body: { bogus: 'x' } }); assert.equal(r.status, 400);
  r = await call('PUT', '/api/whatsapp-templates', { token: A(), body: { fee_reminder: 'x'.repeat(1001) } }); assert.equal(r.status, 400);
  r = await call('PUT', '/api/whatsapp-templates', { token: A(), body: { fee_reminder: 'Fee {amount} due, {name}' } });
  r = await call('PUT', '/api/whatsapp-templates', { token: A(), body: { fee_reminder: null } });
  assert.equal(r.body.fee_reminder, undefined); assert.ok(r.body.renewal_reminder);
});

test('reminderText falls back to the built-in text when no template', () => {
  assert.match(reminderText('expiry_reminder', { name: 'Asha', expiryDate: '2026-12-01' }, { name: 'BL' }, {}), /your plan at BL ends on 2026-12-01/);
  assert.equal(reminderText('fee_reminder', { name: 'Asha', dueAmount: 1200 }, { name: 'BL' }, { fee_reminder: '{name} owes {amount} to {library}' }), 'Asha owes 1,200 to BL');
});

test('validateRules', () => {
  assert.deepEqual(validateRules([{ id: 'a', offsetDays: -3, sendHour: 10 }]), [{ id: 'a', offsetDays: -3, sendHour: 10, enabled: true, onlyIfUnpaid: false, template: 'renewal_reminder' }]);
  for (const bad of [[{ id: 'a', offsetDays: 31 }], [{ id: 'a', offsetDays: 0, sendHour: 21 }], [{ id: 'a', offsetDays: 0 }, { id: 'a', offsetDays: 1 }], [{ offsetDays: 1 }], Array(11).fill(0).map((_, i) => ({ id: 'r' + i, offsetDays: 0 }))])
    assert.throws(() => validateRules(bad));
});

test('rules: multiple offsets, past days not sent late, legacy used when no rules', () => {
  const s = { _key: 'X', expiryDate: '2026-12-10' };
  const rules = [{ id: 'b3', offsetDays: -3, enabled: true }, { id: 'd0', offsetDays: 0, enabled: true }, { id: 'a2', offsetDays: 2, enabled: true }, { id: 'off', offsetDays: -1, enabled: false }];
  const d = desiredFor(s, { ...DEFAULT_REMINDER_SETTINGS, rules }, '2026-12-08');
  assert.deepEqual(d.map(x => [x.key, x.sendOn]), [['expiry:X:2026-12-10:rd0', '2026-12-10'], ['expiry:X:2026-12-10:ra2', '2026-12-12']]);
  const legacy = desiredFor(s, DEFAULT_REMINDER_SETTINGS, '2026-12-01');
  assert.deepEqual(legacy.map(x => x.key), ['expiry:X:2026-12-10']);
});

test('rules end-to-end: send time, only-if-unpaid, no duplicates, uses template', async () => {
  let r = await call('PUT', '/api/reminders/settings', { token: A(), body: { rules: [
    { id: 'due', offsetDays: 0, sendHour: 15, template: 'renewal_reminder' },
    { id: 'unpaid', offsetDays: 0, sendHour: 9, onlyIfUnpaid: true, template: 'fee_reminder' },
  ] } });
  assert.equal(r.status, 200); assert.equal(r.body.rules.length, 2);
  r = await call('PUT', '/api/reminders/settings', { token: A(), body: { rules: [{ id: 'x', offsetDays: 99 }] } });
  assert.equal(r.status, 400);
  await call('PUT', '/api/students', { token: A(), body: [
    { id: 'P1', name: 'Paid', phone: '9876543210', expiryDate: today, dueAmount: 0 },
    { id: 'U1', name: 'Unpaid', phone: '9876543211', expiryDate: today, dueAmount: 700 },
  ] });
  await planReminders('lib-a', { today }); await planReminders('lib-a', { today });
  const rows = await ReminderSchedule.find({ tenantId: 'lib-a', studentId: { $in: ['P1', 'U1'] }, ruleId: { $exists: true } }).lean();
  assert.equal(rows.length, 4, 'two rules x two students, planned once');
  // 10 AM: only the 9 AM rule is due; it is cancelled for the paid student.
  // (The separate legacy "fee every N days" reminder for U1 also goes out; it is unchanged by #17.)
  let before = sent.length;
  let out = await sendDueReminders('lib-a', { today, hour: 10, deps: { client } });
  assert.equal(out.cancelled, 1, 'only-if-unpaid rule cancelled for the paid student');
  const at10 = sent.slice(before);
  assert.ok(at10.every(m => m.to.endsWith('9876543211')), 'nothing to the paid student before 3 PM');
  assert.ok(at10.some(m => /700/.test(m.body)));
  assert.equal((await ReminderSchedule.findOne({ tenantId: 'lib-a', studentId: 'U1', ruleId: 'due' }).lean()).status, 'scheduled', '3 PM rule waits');
  // 3 PM: the renewal rule goes to both, using the saved template from the previous test.
  out = await sendDueReminders('lib-a', { today, hour: 15, deps: { client } });
  assert.equal(out.sent, 2);
  assert.match(sent.at(-1).body, /renew by/);
  // again: nothing new
  const n = sent.length;
  await ReminderSchedule.updateMany({ tenantId: 'lib-a', studentId: { $in: ['P1', 'U1'] }, status: 'sent' }, { $set: { status: 'scheduled' } });
  await sendDueReminders('lib-a', { today, hour: 16, deps: { client } });
  assert.equal(sent.length, n, 'dedupe: no second message');
});

test('turning a rule off cancels its planned reminders', async () => {
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'F1', name: 'Fut', phone: '9876543212', expiryDate: addDays(today, 5) }] });
  await call('PUT', '/api/reminders/settings', { token: A(), body: { rules: [{ id: 'b1', offsetDays: -1 }] } });
  await planReminders('lib-a', { today });
  assert.equal((await ReminderSchedule.findOne({ tenantId: 'lib-a', key: `expiry:F1:${addDays(today, 5)}:rb1` }).lean()).status, 'scheduled');
  await call('PUT', '/api/reminders/settings', { token: A(), body: { rules: [{ id: 'b1', offsetDays: -1, enabled: false }] } });
  await planReminders('lib-a', { today });
  const row = await ReminderSchedule.findOne({ tenantId: 'lib-a', key: `expiry:F1:${addDays(today, 5)}:rb1` }).lean();
  assert.equal(row.status, 'cancelled'); assert.equal(row.reason, 'rule_changed');
});

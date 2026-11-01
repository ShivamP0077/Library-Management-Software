// NOT-01: bell, dedup, escalation, auto-resolve, deep links, staff permissions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx, login } from './helpers.js';
import { refreshTenantAlerts, notify, Notification } from '../src/notifications.js';
import { todayIn } from '../src/finance.js';

const A = () => ctx.tokens.a;
let staffTok;
before(async () => {
  await setup('lms_notify_test');
  await call('PUT', '/api/staffMembers', { token: A(), body: [{ id: 'ST1', name: 'Desk', role: 'Librarian', status: 'Active', permissions: { students: { view: true }, expenses: { view: false }, reports: { view: false } } }] });
  await call('POST', '/api/users', { token: A(), body: { email: 'desk@test.local', password: 'DeskPass-123', role: 'staff', staffId: 'ST1' } });
  staffTok = await login('desk@test.local', 'DeskPass-123');
});
after(teardown);
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

test('expense bill alerts deep-link to the instance, escalate, and auto-resolve when paid', async () => {
  const today = todayIn();
  await call('POST', '/api/recurring-expenses', { token: A(), body: { category: 'Rent', amount: 1000, frequency: 'monthly', startDate: addDays(today, -3), reminder: { daysBefore: 3, onDue: true, repeatEveryDays: 1 } } });
  await refreshTenantAlerts('lib-a', { today });
  let list = (await call('GET', '/api/notifications?category=expenses', { token: A() })).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].link.tab, 'expenses');
  const instId = list[0].link.params['expense-instance'];
  assert.ok(instId);
  assert.equal(list[0].actionRequired, false);
  await Notification.updateMany({ tenantId: 'lib-a' }, { $set: { lastNotifiedAt: new Date(Date.now() - 864e5) } });
  await refreshTenantAlerts('lib-a', { today: addDays(today, 1) });
  list = (await call('GET', '/api/notifications?category=expenses', { token: A() })).body;
  assert.equal(list.length, 1, 'deduped'); assert.equal(list[0].notifyCount, 2); assert.equal(list[0].actionRequired, true, 'escalated');
  assert.equal((await call('GET', '/api/notifications/unread-count', { token: A() })).body.actionRequired >= 1, true);
  await call('POST', `/api/expense-instances/${instId}/payments`, { token: A(), body: { amount: 1000 } });
  await refreshTenantAlerts('lib-a', { today: addDays(today, 2) });
  list = (await call('GET', '/api/notifications?category=expenses', { token: A() })).body;
  assert.equal(list[0].status, 'resolved'); assert.equal(list[0].resolvedBy, 'system');
});

test('student expiry: one alert per renewal period, auto-resolved after renewal; daily summary', async () => {
  const today = todayIn();
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S1', name: 'Asha', expiryDate: addDays(today, 1), dueAmount: 500 }] });
  await refreshTenantAlerts('lib-a', { today, dailySummary: true });
  await refreshTenantAlerts('lib-a', { today, dailySummary: true });
  const all = (await call('GET', '/api/notifications', { token: A() })).body;
  const exp = all.filter(n => n.link?.params?.student === 'S1' && n.category === 'students');
  assert.equal(exp.length, 1); assert.equal(exp[0].notifyCount, 1, 'not re-sent in same period');
  assert.ok(all.some(n => n.category === 'payments' && n.title.includes('₹500')));
  assert.equal(all.filter(n => n.category === 'summary').length, 1);
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S1', name: 'Asha', expiryDate: addDays(today, 60), dueAmount: 0 }] });
  await refreshTenantAlerts('lib-a', { today });
  const after2 = (await call('GET', '/api/notifications?status=open', { token: A() })).body;
  assert.ok(!after2.some(n => n.link?.params?.student === 'S1'));
});

test('staff only see permitted categories; read/unread is per user; tenant isolation', async () => {
  const staffList = (await call('GET', '/api/notifications', { token: staffTok })).body;
  assert.ok(staffList.every(n => ['students', 'seats', 'notices', 'support'].includes(n.category)), JSON.stringify(staffList.map(n => n.category)));
  const ownerList = (await call('GET', '/api/notifications', { token: A() })).body;
  const exp = ownerList.find(n => n.category === 'expenses');
  assert.equal((await call('POST', `/api/notifications/${exp.id}/read`, { token: staffTok })).status, 404);
  assert.equal((await call('POST', `/api/notifications/${exp.id}/read`, { token: ctx.tokens.b })).status, 404);
  await call('POST', `/api/notifications/${exp.id}/read`, { token: A() });
  assert.equal((await call('GET', '/api/notifications?category=expenses', { token: A() })).body[0].read, true);
  assert.equal((await call('GET', '/api/notifications', { token: ctx.tokens.b })).body.length, 0);
});

test('critical alerts go straight to Action Required; staff notices with attachment validation', async () => {
  await notify('lib-a', { dedupeKey: 'security:test', category: 'security', severity: 'critical', title: 'Suspicious logins' });
  const ar = (await call('GET', '/api/notifications?actionRequired=true', { token: A() })).body;
  assert.ok(ar.some(n => n.title === 'Suspicious logins'));
  assert.ok(!(await call('GET', '/api/notifications', { token: staffTok })).body.some(n => n.category === 'security'));
  const bad = await call('POST', '/api/notices', { token: staffTok, body: { title: 'Fire NOC', attachment: { name: 'x.exe', data: 'data:application/x-msdownload;base64,AAAA' } } });
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/api/notices', { token: staffTok, body: { title: 'Fire safety notice', summary: 'Inspection on Monday', attachment: { name: 'n.png', data: 'data:image/png;base64,iVBORw0KGgo=' } } });
  assert.equal(ok.status, 201);
  const owner = (await call('GET', '/api/notifications?actionRequired=true', { token: A() })).body.find(n => n.title === 'Fire safety notice');
  assert.equal(owner.createdBy, 'desk@test.local'); assert.equal(owner.attachment.type, 'image/png');
  assert.equal((await call('GET', `/api/notifications/${owner.id}/attachment`, { token: A() })).body.type, 'image/png');
  const res = await call('POST', `/api/notifications/${owner.id}/resolve`, { token: A(), body: { resolution: 'Booked inspection' } });
  assert.equal(res.body.status, 'resolved');
  assert.ok((await call('GET', '/api/audit-logs', { token: A() })).body.some(l => l.action === 'notification.resolved'));
  assert.equal(await Notification.countDocuments({ tenantId: 'lib-b' }), 0);
});

// OPS-01 / §10: support tickets (tenant-scoped, permissioned, audited) and permissioned CSV exports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx, login } from './helpers.js';
import { AuditLog } from '../src/audit.js';

const A = () => ctx.tokens.a, B = () => ctx.tokens.b, SA = () => ctx.tokens.sa;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let staffTok;
before(async () => {
  await setup('lms_support_test');
  await call('PUT', '/api/staffMembers', { token: A(), body: [{ id: 'ST1', name: 'Desk', role: 'Librarian', status: 'Active', permissions: { students: { view: true }, payments: { view: false }, expenses: { view: false } } }] });
  await call('POST', '/api/users', { token: A(), body: { email: 'desk@test.local', password: 'DeskPass-123', role: 'staff', staffId: 'ST1' } });
  staffTok = await login('desk@test.local', 'DeskPass-123');
  await call('PUT', '/api/students', { token: A(), body: [{ id: 'S1', name: '=HYPERLINK("x")', phone: '9000000001', status: 'Active' }] });
  await call('PUT', '/api/students', { token: B(), body: [{ id: 'S9', name: 'Other Lib Student', phone: '9000000009', status: 'Active' }] });
});
after(teardown);

test('owner creates a ticket with attachment; validation of files', async () => {
  let r = await call('POST', '/api/support/tickets', { token: A(), body: { subject: 'Seat map broken', category: 'technical', message: 'Help', attachments: [{ name: 'shot.png', data: PNG }] } });
  assert.equal(r.status, 201); assert.equal(r.body.number, 1); assert.equal(r.body.status, 'open');
  assert.equal(r.body.messages[0].attachments.length, 1); assert.equal(r.body.messages[0].attachments[0].data, undefined, 'no blob in listing');
  r = await call('POST', '/api/support/tickets', { token: A(), body: { subject: 'Bad file', message: 'x', attachments: [{ name: 'a.exe', data: 'data:application/x-msdownload;base64,AAAA' }] } });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/support/tickets', { token: A(), body: { subject: 'Big', message: 'x', attachments: [{ name: 'a.png', data: 'data:image/png;base64,' + 'A'.repeat(7 * 1024 * 1024) }] } });
  assert.ok([400, 413].includes(r.status), String(r.status));
  r = await call('POST', '/api/support/tickets', { token: A(), body: { subject: 'x', message: '' } });
  assert.equal(r.status, 400);
});

test('tenant isolation and staff see only their own tickets', async () => {
  const s = await call('POST', '/api/support/tickets', { token: staffTok, body: { subject: 'Printer question', message: 'hi' } });
  assert.equal(s.status, 201); assert.equal(s.body.number, 2);
  const mine = (await call('GET', '/api/support/tickets', { token: staffTok })).body;
  assert.deepEqual(mine.map(t => t.subject), ['Printer question']);
  assert.equal((await call('GET', '/api/support/tickets', { token: A() })).body.length, 2);
  assert.equal((await call('GET', '/api/support/tickets', { token: B() })).body.length, 0);
  assert.equal((await call('GET', `/api/support/tickets/${s.body.id}`, { token: B() })).status, 404);
  const b = await call('POST', '/api/support/tickets', { token: B(), body: { subject: 'Library B issue', message: 'x' } });
  assert.equal(b.body.number, 1, 'numbering is per library');
});

test('Super Admin desk: list all, reply, assign, status; customer sees reply and notification; audited', async () => {
  const lr = await call('GET', '/api/admin/support/tickets', { token: SA() }); const list = lr.body;
  assert.equal(list.length, 3); assert.ok(list.every(t => t.libraryName));
  const t = list.find(x => x.subject === 'Seat map broken');
  assert.equal((await call('GET', `/api/admin/support/tickets/${t.id}`, { token: SA() })).body.messages.length, 1);
  const rep = await call('POST', `/api/admin/support/tickets/${t.id}/messages`, { token: SA(), body: { message: 'Fixed, please refresh' } });
  assert.equal(rep.status, 200); assert.equal(rep.body.status, 'waiting_on_customer'); assert.ok(rep.body.firstResponseAt); assert.equal(rep.body.assignedTo, 'super@test.local');
  const p = await call('PATCH', `/api/admin/support/tickets/${t.id}`, { token: SA(), body: { assignedTo: 'agent@support', priority: 'high', status: 'in_progress' } });
  assert.equal(p.body.assignedTo, 'agent@support'); assert.equal(p.body.priority, 'high');
  const seen = (await call('GET', `/api/support/tickets/${t.id}`, { token: A() })).body;
  assert.equal(seen.messages.length, 2); assert.equal(seen.messages[1].fromSupport, true);
  const att = await call('GET', `/api/support/tickets/${t.id}/messages/${seen.messages[0].id}/attachments/${seen.messages[0].attachments[0].id}`, { token: A() });
  assert.equal(att.body.data, PNG);
  const notes = (await call('GET', '/api/notifications?category=support', { token: A() })).body;
  assert.equal(notes.length, 1); assert.equal(notes[0].link.tab, 'support');
  // customer replies & closes; closed tickets can't get more messages
  await call('POST', `/api/support/tickets/${t.id}/messages`, { token: A(), body: { message: 'Works now' } });
  const c = await call('PATCH', `/api/support/tickets/${t.id}`, { token: A(), body: { status: 'closed' } });
  assert.equal(c.body.status, 'closed'); assert.ok(c.body.closedAt);
  assert.equal((await call('POST', `/api/support/tickets/${t.id}/messages`, { token: A(), body: { message: 'again' } })).status, 409);
  assert.equal((await call('PATCH', `/api/support/tickets/${t.id}`, { token: A(), body: { status: 'resolved' } })).status, 400);
  const actions = (await AuditLog.find({ action: /^support\./ }).lean()).map(a => a.action);
  for (const a of ['support.ticket_create', 'support.ticket_reply', 'support.ticket_update', 'support.ticket_view', 'support.ticket_status']) assert.ok(actions.includes(a), a);
  const kpi = (await call('GET', '/api/admin/saas-summary', { token: SA() })).body;
  assert.ok(kpi.kpis?.support?.openTickets >= 1);
});

test('read-only Access Library cannot create tickets', async () => {
  const r = await call('POST', '/api/support/tickets', { token: SA(), headers: { 'X-Library-Id': 'lib-a', 'X-Read-Only': '1' }, body: { subject: 'Nope', message: 'x' } });
  assert.equal(r.status, 403);
});

test('exports: tenant-scoped, permissioned, formula-escaped, audited', async () => {
  const r = await call('GET', '/api/export/students.csv', { token: A() });
  assert.equal(r.status, 200);
  const text = typeof r.body === 'string' ? r.body : r.text;
  assert.match(text, /Student ID,Name/);
  assert.match(text, /'=HYPERLINK/);
  assert.doesNotMatch(text, /Other Lib Student/);
  assert.equal((await call('GET', '/api/export/students.csv', { token: staffTok })).status, 200);
  assert.equal((await call('GET', '/api/export/payments.csv', { token: staffTok })).status, 403);
  assert.equal((await call('GET', '/api/export/expenses.csv', { token: staffTok })).status, 403);
  assert.equal((await call('GET', '/api/export/secrets.csv', { token: A() })).status, 404);
  assert.ok(await AuditLog.findOne({ action: 'data.export', tenantId: 'lib-a', target: 'students' }));
});

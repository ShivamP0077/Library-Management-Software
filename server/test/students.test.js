// STU-01 + §3.1: status, capacity (active+expired), history, archive/restore, confirmed permanent delete.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { studentStatus } from '../src/students.js';

const A = () => ctx.tokens.a;
before(() => setup('lms_students_test'));
after(teardown);
const stu = (id, extra = {}) => ({ id, name: `S${id}`, branchId: 'B1', status: 'Active', expiryDate: '2099-01-01', ...extra });

test('status is derived consistently', () => {
  assert.equal(studentStatus({ expiryDate: '2026-01-01' }, '2026-02-01'), 'Expired');
  assert.equal(studentStatus({ expiryDate: '2026-02-02' }, '2026-02-01'), 'Expiring Soon');
  assert.equal(studentStatus({ expiryDate: '2026-03-01' }, '2026-02-01'), 'Active');
  assert.equal(studentStatus({ status: 'Archived', expiryDate: '2099-01-01' }), 'Archived');
});

test('capacity counts active + expired, blocks growth past limit and restore over limit', async () => {
  assert.equal((await call('PATCH', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: { studentLimit: 2 } })).status, 200);
  assert.equal((await call('PUT', '/api/students', { token: A(), body: [stu('1'), stu('2', { expiryDate: '2020-01-01' })] })).status, 200);
  const over = await call('PUT', '/api/students', { token: A(), body: [stu('1'), stu('2', { expiryDate: '2020-01-01' }), stu('3')] });
  assert.equal(over.status, 409); assert.equal(over.body.code, 'capacity_exceeded');
  assert.equal((await call('POST', '/api/students', { token: A(), body: stu('4') })).status, 409);
  // archive #2 → frees a slot (archived not counted)
  assert.equal((await call('PUT', '/api/archivedStudents', { token: A(), body: [stu('2', { status: 'Archived' })] })).status, 200);
  assert.equal((await call('PUT', '/api/students', { token: A(), body: [stu('1')] })).status, 200);
  assert.equal((await call('PUT', '/api/students', { token: A(), body: [stu('1'), stu('3')] })).status, 200);
  // restoring #2 now would exceed the limit
  const restore = await call('PUT', '/api/students', { token: A(), body: [stu('1'), stu('3'), stu('2')] });
  assert.equal(restore.status, 409);
  const sum = (await call('GET', '/api/students-summary', { token: A() })).body;
  assert.deepEqual([sum.active, sum.archived, sum.capacity.used, sum.capacity.limit], [2, 1, 2, 2]);
  // editing while at the limit is still allowed
  assert.equal((await call('PUT', '/api/students', { token: A(), body: [stu('1', { name: 'Renamed' }), stu('3')] })).status, 200);
  await call('PATCH', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: { studentLimit: null } });
});

test('history records renewal, shift/branch change, archive and restore; never rewritten', async () => {
  await call('PUT', '/api/students', { token: A(), body: [stu('1', { name: 'Renamed' }), stu('3'), stu('2')] }); // restore #2
  await call('PUT', '/api/archivedStudents', { token: A(), body: [] });
  await call('PUT', '/api/students', { token: A(), body: [stu('1', { expiryDate: '2099-02-01', shiftId: 'EVE', branchId: 'B2' }), stu('3'), stu('2')] });
  const h1 = (await call('GET', '/api/students/1/history', { token: A() })).body.map(e => e.type);
  for (const t of ['admitted', 'renewed', 'shift_changed', 'branch_changed']) assert.ok(h1.includes(t), t + ' in ' + h1);
  const h2 = (await call('GET', '/api/students/2/history', { token: A() })).body.map(e => e.type);
  assert.ok(h2.includes('archived') && h2.includes('restored'), String(h2));
  // tenant isolation
  assert.deepEqual((await call('GET', '/api/students/1/history', { token: ctx.tokens.b })).body, []);
});

test('permanent delete needs confirmation, is audited and keeps payments', async () => {
  await call('PUT', '/api/students', { token: A(), body: [stu('1'), stu('3')] });
  await call('PUT', '/api/archivedStudents', { token: A(), body: [stu('2', { status: 'Archived' })] });
  await call('POST', '/api/payments', { token: A(), body: { receiptNo: 'P-2', studentId: '2', amount: 500, netTotal: 500, method: 'Cash', date: '2026-10-01' } });
  assert.equal((await call('DELETE', '/api/archived-students/2', { token: A(), body: {} })).status, 400);
  assert.equal((await call('DELETE', '/api/archivedStudents/2', { token: A() })).status, 400);
  assert.equal((await call('DELETE', '/api/archived-students/2', { token: ctx.tokens.b, body: { confirm: '2' } })).status, 404);
  const ok = await call('DELETE', '/api/archived-students/2', { token: A(), body: { confirm: '2', reason: 'duplicate' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.paymentsRetained, 1);
  const h = (await call('GET', '/api/students/2/history', { token: A() })).body.map(e => e.type);
  assert.ok(h.includes('permanently_deleted'));
});

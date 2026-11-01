// SEAT-01 / SEAT-02: atomic, tenant-scoped seat allocation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';

const A = () => ctx.tokens.a;
const shifts = [
  { id: 'sh-full', name: 'Full Day', startTime: '06:00', endTime: '20:00' },
  { id: 'sh-m', name: 'Morning', startTime: '06:00', endTime: '12:00' },
  { id: 'sh-e', name: 'Evening', startTime: '14:00', endTime: '20:00' },
];
const seats = [
  { id: 's1', name: 'A1', branchId: 'b1' }, { id: 's2', name: 'A2', branchId: 'b1' },
  { id: 's3', name: 'A3', branchId: 'b1' }, { id: 's4', name: 'A4', branchId: 'b1', isMaintenance: true },
];
const stu = (id, seatNo, shiftId, extra = {}) => ({ id, name: id, branchId: 'b1', seatNo, shiftId, status: 'Active', ...extra });

before(async () => {
  await setup('lms_seats_test');
  await call('PUT', '/api/branches', { token: A(), body: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Annex' }] });
  await call('PUT', '/api/shifts', { token: A(), body: shifts });
  await call('PUT', '/api/seats', { token: A(), body: seats });
});
after(teardown);

test('SEAT-01: two simultaneous requests for the same seat/shift -> exactly one succeeds', async () => {
  const [r1, r2] = await Promise.all([
    call('POST', '/api/students', { token: A(), body: stu('S1', 'A1', 'sh-full') }),
    call('POST', '/api/students', { token: A(), body: stu('S2', 'A1', 'sh-m') }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  const loser = r1.status === 409 ? r1 : r2;
  assert.equal(loser.body.code, 'seat_conflict');
  assert.match(loser.body.error, /already taken/);
  const allocs = (await call('GET', '/api/seat-allocations', { token: A() })).body;
  assert.equal(allocs.filter(a => a.seatNo === 'A1').length, 1);
  // clean up the winner for following tests
  const winner = r1.status === 201 ? 'S1' : 'S2';
  assert.equal((await call('DELETE', `/api/students/${winner}`, { token: A() })).status, 200);
  assert.equal((await call('GET', '/api/seat-allocations', { token: A() })).body.length, 0);
});

test('non-overlapping shifts can share a seat; overlapping cannot', async () => {
  assert.equal((await call('POST', '/api/students', { token: A(), body: stu('M1', 'A2', 'sh-m') })).status, 201);
  assert.equal((await call('POST', '/api/students', { token: A(), body: stu('E1', 'A2', 'sh-e') })).status, 201);
  const r = await call('POST', '/api/students', { token: A(), body: stu('F1', 'A2', 'sh-full') });
  assert.equal(r.status, 409);
});

test('bulk sync that double-books is rejected and nothing is written', async () => {
  const before = (await call('GET', '/api/students', { token: A() })).body;
  const r = await call('PUT', '/api/students', { token: A(), body: [...before, stu('X1', 'A2', 'sh-m')] });
  assert.equal(r.status, 409);
  assert.equal((await call('GET', '/api/students', { token: A() })).body.length, before.length);
});

test('maintenance seats are not allocatable; occupied seats cannot go to maintenance or be removed', async () => {
  assert.equal((await call('POST', '/api/students', { token: A(), body: stu('Z1', 'A4', 'sh-m') })).status, 409);
  assert.equal((await call('PATCH', '/api/seats/s2/maintenance', { token: A(), body: { isMaintenance: true } })).status, 409);
  assert.equal((await call('DELETE', '/api/seats/s2', { token: A() })).status, 409);
  const noA2 = seats.filter(s => s.id !== 's2');
  assert.equal((await call('PUT', '/api/seats', { token: A(), body: noA2 })).status, 409);
  assert.equal((await call('PUT', '/api/seats', { token: A(), body: seats.map(s => s.id === 's2' ? { ...s, isMaintenance: true } : s) })).status, 409);
  // free seat: maintenance toggle works and is then refused for allocation
  assert.equal((await call('PATCH', '/api/seats/s3/maintenance', { token: A(), body: { isMaintenance: true } })).status, 200);
  assert.equal((await call('POST', '/api/students', { token: A(), body: stu('Z2', 'A3', 'sh-m') })).status, 409);
  assert.equal((await call('PATCH', '/api/seats/s3/maintenance', { token: A(), body: { isMaintenance: false } })).status, 200);
});

test('relocation validates target first and rolls back on failure', async () => {
  // E1 (evening on A2) -> A2 full day would clash with M1: refused, E1 keeps A2 evening
  const bad = await call('POST', '/api/seat-allocations/assign', { token: A(), body: { studentId: 'E1', shiftId: 'sh-full' } });
  assert.equal(bad.status, 409);
  let mine = (await call('GET', '/api/seat-allocations?studentId=E1', { token: A() })).body;
  assert.equal(mine.length, 1); assert.equal(mine[0].seatNo, 'A2'); assert.equal(mine[0].shift.id, 'sh-e');
  // valid move to A3
  const ok = await call('POST', '/api/seat-allocations/assign', { token: A(), body: { studentId: 'E1', seatNo: 'A3' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.student.seatNo, 'A3');
  mine = (await call('GET', '/api/seat-allocations?studentId=E1', { token: A() })).body;
  assert.equal(mine[0].seatNo, 'A3');
  const hist = (await call('GET', '/api/seat-allocations?studentId=E1&status=all', { token: A() })).body;
  assert.equal(hist.length, 2);
  // unknown branch
  assert.equal((await call('POST', '/api/seat-allocations/assign', { token: A(), body: { studentId: 'E1', branchId: 'nope' } })).status, 400);
});

test('swap two students in one save works; archiving releases the seat', async () => {
  const list = (await call('GET', '/api/students', { token: A() })).body;
  const swapped = list.map(s => s.id === 'M1' ? { ...s, seatNo: 'A3', shiftId: 'sh-e' } : s.id === 'E1' ? { ...s, seatNo: 'A2', shiftId: 'sh-e' } : s);
  assert.equal((await call('PUT', '/api/students', { token: A(), body: swapped })).status, 200);
  const archived = swapped.map(s => s.id === 'M1' ? { ...s, status: 'Archived' } : s);
  assert.equal((await call('PUT', '/api/students', { token: A(), body: archived })).status, 200);
  const act = (await call('GET', '/api/seat-allocations', { token: A() })).body;
  assert.ok(!act.some(a => a.studentId === 'M1'));
});

test('allocations are tenant-scoped', async () => {
  assert.deepEqual((await call('GET', '/api/seat-allocations', { token: ctx.tokens.b })).body, []);
  await call('PUT', '/api/seats', { token: ctx.tokens.b, body: seats });
  // same seat name in another tenant is independent
  assert.equal((await call('POST', '/api/students', { token: ctx.tokens.b, body: stu('B1', 'A2', 'sh-full') })).status, 201);
  assert.equal((await call('POST', '/api/seat-allocations/assign', { token: ctx.tokens.b, body: { studentId: 'E1', seatNo: 'A1' } })).status, 404);
});

test('unchanged legacy double-bookings do not block unrelated saves', async () => {
  const mongoose = (await import('mongoose')).default;
  await mongoose.connection.collection('students').insertMany([
    { tenantId: 'lib-b', _key: 'L1', id: 'L1', seatNo: 'A3', branchId: 'b1', status: 'Active', shiftId: 'x' },
    { tenantId: 'lib-b', _key: 'L2', id: 'L2', seatNo: 'A3', branchId: 'b1', status: 'Active', shiftId: 'x' },
  ]);
  const list = (await call('GET', '/api/students', { token: ctx.tokens.b })).body;
  const r = await call('PUT', '/api/students', { token: ctx.tokens.b, body: list.map(s => s.id === 'B1' ? { ...s, phone: '999' } : s) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

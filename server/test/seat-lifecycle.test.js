import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { runLibrarySeatLifecycle } from '../src/seatLifecycle.js';
import { StudentEvent } from '../src/students.js';
import { SeatAllocation } from '../src/seats.js';
import { todayIn } from '../src/finance.js';
import { assertLocalMongoUri, planSnapshotBackfill } from '../scripts/backfill-period-snapshots.mjs';

const A = () => ctx.tokens.a;

before(async () => {
  await setup('lms_lifecycle_test');
  await call('PUT', '/api/branches', { token: A(), body: [{ id: 'b1', name: 'Main' }] });
  await call('PUT', '/api/shifts', { token: A(), body: [{ id: 'sh-full', name: 'Full Day', startTime: '06:00', endTime: '20:00' }] });
  await call('PUT', '/api/seats', { token: A(), body: [{ id: 's1', name: 'A1', branchId: 'b1' }, { id: 's2', name: 'A2', branchId: 'b1' }] });
  await call('PUT', '/api/settings', { token: A(), body: { gracePeriodDays: 5, expiredPeriodDays: 25, name: 'Library A' } });
});
after(teardown);

const stu = (id, seatNo, extra = {}) => ({ id, name: id, branchId: 'b1', seatNo, shiftId: 'sh-full', status: 'Active', expiryDate: '2026-11-13', ...extra });

test('admission snapshots library days; Active and Grace hold the desk; Expired frees it', async () => {
  // Dates are relative to the real today so the admission is still Active when it is created.
  const plus = (n) => new Date(Date.parse(todayIn()) + n * 864e5).toISOString().slice(0, 10);
  const created = await call('POST', '/api/students', { token: A(), body: stu('L1', 'A1', { expiryDate: plus(1) }) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.graceDaysSnapshot, 5);
  assert.equal(created.body.expiredPeriodDaysSnapshot, 25);
  const held = async (day) => {
    await runLibrarySeatLifecycle('lib-a', { today: day });
    const rows = await SeatAllocation.find({ tenantId: 'lib-a', studentId: 'L1', status: 'active' }).lean();
    return rows.length;
  };
  assert.equal(await held(plus(1)), 1);
  assert.equal(await held(plus(6)), 1);
  assert.equal(await held(plus(7)), 0);
  const still = await call('GET', '/api/students/L1', { token: A() });
  assert.equal(still.status, 200);
  assert.notEqual(still.body.status, 'Cancelled');
});

test('auto-cancel on 14 Dec records history, releases the desk, and is idempotent', async () => {
  const B = ctx.tokens.b;
  await call('PUT', '/api/branches', { token: B, body: [{ id: 'b1', name: 'Main' }] });
  await call('PUT', '/api/shifts', { token: B, body: [{ id: 'sh-full', name: 'Full Day', startTime: '06:00', endTime: '20:00' }] });
  await call('PUT', '/api/seats', { token: B, body: [{ id: 's1', name: 'A1', branchId: 'b1' }] });
  await call('PUT', '/api/settings', { token: B, body: { gracePeriodDays: 5, expiredPeriodDays: 25, name: 'Library B' } });
  assert.equal((await call('POST', '/api/students', { token: B, body: stu('L2', 'A1') })).status, 201);
  await runLibrarySeatLifecycle('lib-b', { today: '2026-12-13' });
  assert.equal((await call('GET', '/api/students/L2', { token: B })).status, 200);
  await runLibrarySeatLifecycle('lib-b', { today: '2026-12-14' });
  assert.equal((await call('GET', '/api/students/L2', { token: B })).status, 404);
  const archived = (await call('GET', '/api/archivedStudents', { token: B })).body.find(s => s.id === 'L2');
  assert.equal(archived.status, 'Cancelled');
  assert.match(archived.cancellationHistory[0].reason, /Automatic cancellation/);
  assert.equal(archived.cancellationHistory[0].date, '2026-12-14');
  const events = await StudentEvent.find({ tenantId: 'lib-b', studentId: 'L2', type: 'auto_cancelled' }).lean();
  assert.equal(events.length, 1);
  assert.equal(await SeatAllocation.countDocuments({ tenantId: 'lib-b', studentId: 'L2', status: 'active' }), 0);
  const pays = (await call('GET', '/api/payments', { token: B })).body;
  await runLibrarySeatLifecycle('lib-b', { today: '2026-12-14' });
  assert.equal(await StudentEvent.countDocuments({ tenantId: 'lib-b', studentId: 'L2', type: 'auto_cancelled' }), 1);
  assert.equal((await call('GET', '/api/archivedStudents', { token: B })).body.filter(s => s.id === 'L2').length, 1);
  assert.deepEqual((await call('GET', '/api/payments', { token: B })).body, pays);
});

test('changing settings does not move a snapshot; renewal uses the new values and blocks auto-cancel', async () => {
  await call('PUT', '/api/settings', { token: A(), body: { gracePeriodDays: 1, expiredPeriodDays: 2, name: 'Library A' } });
  const kept = await call('GET', '/api/students/L1', { token: A() });
  assert.equal(kept.body.graceDaysSnapshot, 5);
  assert.equal(kept.body.expiredPeriodDaysSnapshot, 25);
  const renewed = await call('PUT', '/api/students/L1', { token: A(), body: { expiryDate: '2026-12-31' } });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.equal(renewed.body.graceDaysSnapshot, 1);
  assert.equal(renewed.body.expiredPeriodDaysSnapshot, 2);
  await runLibrarySeatLifecycle('lib-a', { today: '2026-12-14' });
  assert.equal((await call('GET', '/api/students/L1', { token: A() })).status, 200);
  const fresh = await call('POST', '/api/students', { token: A(), body: stu('L3', 'A2', { expiryDate: '2027-01-31' }) });
  assert.equal(fresh.body.graceDaysSnapshot, 1);
  assert.equal(fresh.body.expiredPeriodDaysSnapshot, 2);
});

test('renewal reuses a free desk and refuses a taken one; a missing desk is still rejected', async () => {
  await call('PUT', '/api/settings', { token: A(), body: { gracePeriodDays: 0, expiredPeriodDays: 25, name: 'Library A' } });
  await call('PUT', '/api/students/L1', { token: A(), body: { expiryDate: '2026-01-01' } });
  await call('PUT', '/api/students/L3', { token: A(), body: { expiryDate: '2026-01-01' } });
  const old = await call('POST', '/api/students', { token: A(), body: stu('R1', 'A1', { expiryDate: '2026-01-01' }) });
  assert.equal(old.status, 201, JSON.stringify(old.body));
  assert.equal(await SeatAllocation.countDocuments({ tenantId: 'lib-a', studentId: 'R1', status: 'active' }), 0);
  const other = await call('POST', '/api/students', { token: A(), body: stu('R2', 'A1', { expiryDate: '2027-06-01' }) });
  assert.equal(other.status, 201);
  const blocked = await call('PUT', '/api/students/R1', { token: A(), body: { expiryDate: '2027-02-01', seatNo: 'A1' } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'seat_conflict');
  await call('DELETE', '/api/students/R2', { token: A() });
  const reused = await call('PUT', '/api/students/R1', { token: A(), body: { expiryDate: '2027-02-01', seatNo: 'A1' } });
  assert.equal(reused.status, 200, JSON.stringify(reused.body));
  assert.equal(await SeatAllocation.countDocuments({ tenantId: 'lib-a', studentId: 'R1', status: 'active' }), 1);
  const missing = await call('POST', '/api/students', { token: A(), body: stu('R3', 'NO-SUCH-DESK', { expiryDate: '2027-03-01' }) });
  assert.equal(missing.status, 409);
  assert.match(missing.body.error, /does not exist/);
});

test('Asia/Kolkata today and the backfill guard', () => {
  const eveningUtc = new Date('2026-11-13T20:30:00.000Z');
  assert.equal(todayIn('Asia/Kolkata', eveningUtc), '2026-11-14');
  assert.equal(todayIn('Asia/Kolkata', new Date('2026-11-13T12:00:00.000Z')), '2026-11-13');
  assert.equal(assertLocalMongoUri('mongodb://127.0.0.1:27017/library'), '127.0.0.1');
  assert.equal(assertLocalMongoUri('mongodb://localhost:27017/library'), 'localhost');
  assert.throws(() => assertLocalMongoUri('mongodb+srv://cluster.example.net/library'), /Refusing/);
  assert.throws(() => assertLocalMongoUri('mongodb://cluster.example.net/library'), /Refusing/);
  const changes = planSnapshotBackfill(
    [{ _id: '1', tenantId: 'lib-a', id: 'S', expiryDate: '2026-11-13' }],
    new Map([['lib-a', { gracePeriodDays: 3 }]]),
  );
  return Promise.resolve(changes).then(rows => {
    assert.equal(rows[0].set.graceDaysSnapshot, 3);
    assert.equal(rows[0].set.expiredPeriodDaysSnapshot, 25);
  });
});

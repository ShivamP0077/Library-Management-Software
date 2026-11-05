// Issue #11: an admission void (student saved with seatNo 'None' + status 'Expired') frees the seat; the student doc stays.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { buildAdmissionVoid } from '../../src/utils/admissionVoid.js';

const A = () => ctx.tokens.a;
before(async () => {
  await setup('lms_admission_void_test');
  await call('PUT', '/api/branches', { token: A(), body: [{ id: 'b1', name: 'Main' }] });
  await call('PUT', '/api/shifts', { token: A(), body: [{ id: 'sh', name: 'Full Day', startTime: '06:00', endTime: '20:00' }] });
  await call('PUT', '/api/seats', { token: A(), body: [{ id: 's1', name: 'A1', branchId: 'b1' }] });
});
after(teardown);

test('admission void frees the seat for a new student and keeps the voided record', async () => {
  const st = { id: 'V1', name: 'V1', branchId: 'b1', seatNo: 'A1', shiftId: 'sh', status: 'Active', startDate: '2026-11-01', expiryDate: '2099-01-01',
    renewalHistory: [{ renewalId: 'RN-1', receiptNo: 'RCP-1', startDate: '2026-11-01', amountPaid: 500 }] };
  assert.equal((await call('POST', '/api/students', { token: A(), body: st })).status, 201);
  assert.equal((await call('POST', '/api/students', { token: A(), body: { ...st, id: 'V2', name: 'V2' } })).status, 409, 'seat taken before void');

  const v = buildAdmissionVoid(st, 'RN-1', { today: '2026-11-05', staffName: 'Owner' });
  const r = await call('PUT', '/api/students', { token: A(), body: [{ ...st, ...v.updates }] });
  assert.equal(r.status, 200);
  const allocs = (await call('GET', '/api/seat-allocations', { token: A() })).body;
  assert.equal(allocs.filter(a => a.seatNo === 'A1').length, 0, 'seat released');

  const kept = (await call('GET', '/api/students', { token: A() })).body.find(s => s.id === 'V1');
  assert.ok(kept, 'student kept');
  assert.equal(kept.renewalHistory[0].voided, true);
  assert.equal(kept.voidHistory[0].type, 'admission_void');
  assert.equal((await call('POST', '/api/students', { token: A(), body: { ...st, id: 'V2', name: 'V2' } })).status, 201, 'seat reusable');
});

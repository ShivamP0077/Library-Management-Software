// Desk cap blocks growth only. Student cap is Active + Grace. studentLimit is not renamed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { countsTowardStudentLimit } from '../src/students.js';
import { todayIn } from '../src/finance.js';
import { addDays } from '../../src/utils/billingCycle.js';

const A = () => ctx.tokens.a;
const SA = () => ctx.tokens.sa;
before(() => setup('desk_capacity'));
after(teardown);

const seat = (id) => ({ id, name: `D${id}` });
const seats = (n) => Array.from({ length: n }, (_, i) => seat(String(i + 1)));

async function plan(id, extra) {
  const r = await call('POST', '/api/admin/plans', { token: SA(), body: { name: id, priceMonthly: 0, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await call('PATCH', `/api/admin/libraries/lib-a`, { token: SA(), body: { planId: r.body.planId, studentLimit: null } })).status, 200);
  return r.body.planId;
}

test('countsTowardStudentLimit is Active and Grace only', () => {
  const today = '2026-11-18';
  assert.equal(countsTowardStudentLimit({ expiryDate: '2099-01-01' }, { today }), true);
  assert.equal(countsTowardStudentLimit({ expiryDate: '2026-11-17', graceDaysSnapshot: 5 }, { today }), true);
  assert.equal(countsTowardStudentLimit({ expiryDate: '2020-01-01', graceDaysSnapshot: 0 }, { today }), false);
  assert.equal(countsTowardStudentLimit({ status: 'Cancelled', expiryDate: '2099-01-01' }, { today }), false);
  assert.equal(countsTowardStudentLimit({ status: 'Archived', expiryDate: '2099-01-01' }, { today }), false);
});

test('100 desks pass and 101 is Plan Limit Exceeded; cancel does not change the desk count', async () => {
  await plan('cap100', { deskLimit: 100, studentLimit: 50 });
  assert.equal((await call('PUT', '/api/seats', { token: A(), body: seats(100) })).status, 200);
  const over = await call('PUT', '/api/seats', { token: A(), body: seats(101) });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, 'desks_limit');
  assert.match(over.body.error, /Plan Limit Exceeded/);
  assert.match(over.body.error, /Upgrade/);
  const listed = await call('GET', '/api/seats', { token: A() });
  assert.equal(listed.body.length, 100);

  const student = { id: 'S1', name: 'Ada', status: 'Active', expiryDate: '2099-01-01' };
  assert.equal((await call('POST', '/api/students', { token: A(), body: student })).status, 201);
  assert.equal((await call('PUT', '/api/students', { token: A(), body: [{ ...student, status: 'Cancelled' }] })).status, 200);
  assert.equal((await call('GET', '/api/seats', { token: A() })).body.length, 100);
});

test('Active and Grace count toward studentLimit; Expired and Cancelled do not', async () => {
  await plan('stu2', { studentLimit: 2, deskLimit: 100 });
  assert.equal((await call('PUT', '/api/settings', { token: A(), body: { gracePeriodDays: 5, expiredPeriodDays: 25, name: 'Library A' } })).status, 200);
  const today = todayIn();
  const active = { id: 'A1', name: 'Active', expiryDate: '2099-01-01' };
  const grace = { id: 'G1', name: 'Grace', expiryDate: addDays(today, -1), graceDaysSnapshot: 5, expiredPeriodDaysSnapshot: 25 };
  const expired = { id: 'E1', name: 'Expired', expiryDate: '2020-01-01', graceDaysSnapshot: 0, expiredPeriodDaysSnapshot: 0 };
  const cancelled = { id: 'C1', name: 'Cancelled', status: 'Cancelled', expiryDate: '2099-01-01' };
  assert.equal(countsTowardStudentLimit(grace, { today }), true);
  assert.equal((await call('PUT', '/api/students', { token: A(), body: [active, grace, expired, cancelled] })).status, 200);
  const sum = (await call('GET', '/api/students-summary', { token: A() })).body;
  assert.equal(sum.capacity.used, 2);
  assert.equal(sum.capacity.limit, 2);
  const third = await call('PUT', '/api/students', { token: A(), body: [active, grace, expired, cancelled, { id: 'A2', name: 'More', expiryDate: '2099-06-01' }] });
  assert.equal(third.status, 409);
  assert.equal(third.body.code, 'capacity_exceeded');
  assert.match(third.body.error, /Plan Limit Exceeded/);
  assert.match(third.body.error, /grace/);
});

test('two generates at the same time cannot pass deskLimit', async () => {
  await plan('race2', { deskLimit: 2 });
  await call('PUT', '/api/seats', { token: A(), body: [] });
  assert.equal((await call('POST', '/api/seats', { token: A(), body: seat('a') })).status, 201);
  const [one, two] = await Promise.all([
    call('POST', '/api/seats', { token: A(), body: seat('b') }),
    call('POST', '/api/seats', { token: A(), body: seat('c') }),
  ]);
  const statuses = [one.status, two.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal((await call('GET', '/api/seats', { token: A() })).body.length, 2);
});

test('a lower deskLimit keeps existing desks and blocks only an increase', async () => {
  await plan('wide', { deskLimit: 10 });
  assert.equal((await call('PUT', '/api/seats', { token: A(), body: seats(5) })).status, 200);
  await plan('narrow', { deskLimit: 2 });
  const kept = await call('GET', '/api/seats', { token: A() });
  assert.equal(kept.body.length, 5);
  assert.equal((await call('PUT', '/api/seats', { token: A(), body: seats(5) })).status, 200);
  const grown = await call('PUT', '/api/seats', { token: A(), body: seats(6) });
  assert.equal(grown.status, 409);
  assert.equal(grown.body.code, 'desks_limit');
  assert.equal((await call('GET', '/api/seats', { token: A() })).body.length, 5);
  assert.equal((await call('POST', '/api/seats', { token: A(), body: seat('extra') })).status, 409);
});

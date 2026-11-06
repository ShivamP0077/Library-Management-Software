// Issue #14: Super Admin plan builder + limits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { planInput } from '../src/plans.js';

before(() => setup('plans'));
after(teardown);
const SA = () => ctx.tokens.sa;

test('planInput validates and normalises', () => {
  assert.throws(() => planInput({}, { creating: true }), /name is required/);
  assert.throws(() => planInput({ name: 'x', priceMonthly: -1 }), /priceMonthly/);
  assert.throws(() => planInput({ name: 'x', studentLimit: 1.5 }), /studentLimit/);
  assert.deepEqual(planInput({ name: ' Pro ', priceMonthly: '999', studentLimit: '', features: 'WhatsApp\n\n Reports ' }, { creating: true }),
    { name: 'Pro', priceMonthly: 999, studentLimit: null, features: ['WhatsApp', 'Reports'] });
  assert.equal(planInput({ staffLimit: 0 }).staffLimit, null, '0 = unlimited');
});

test('only super admin manages plans; CRUD + archive', async () => {
  assert.equal((await call('GET', '/api/admin/plans', { token: ctx.tokens.a })).status, 403);
  assert.equal((await call('POST', '/api/admin/plans', { token: ctx.tokens.a, body: { name: 'Hack' } })).status, 403);
  const c = await call('POST', '/api/admin/plans', { token: SA(), body: { name: 'Starter', priceMonthly: 499, priceYearly: 4990, studentLimit: 2, staffLimit: 1, branchLimit: 1, features: ['Receipts'] } });
  assert.equal(c.status, 201, JSON.stringify(c.body)); assert.equal(c.body.planId, 'starter');
  assert.equal((await call('POST', '/api/admin/plans', { token: SA(), body: { name: 'Starter', planId: 'starter' } })).status, 409);
  const u = await call('PATCH', '/api/admin/plans/starter', { token: SA(), body: { priceMonthly: 599, active: false } });
  assert.equal(u.body.priceMonthly, 599); assert.equal(u.body.active, false);
  assert.equal((await call('PATCH', '/api/admin/plans/nope', { token: SA(), body: { name: 'x' } })).status, 404);
  await call('PATCH', '/api/admin/plans/starter', { token: SA(), body: { active: true } });
  const list = (await call('GET', '/api/admin/plans', { token: SA() })).body;
  assert.equal(list.length, 1); assert.equal(list[0].libraries, 0);
});

test('assigning a plan enforces its student, staff and branch limits on lib-a only', async () => {
  assert.equal((await call('PATCH', '/api/admin/libraries/lib-a', { token: SA(), body: { planId: 'missing' } })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/libraries/lib-a', { token: SA(), body: { planId: 'starter' } })).status, 200);
  const libs = (await call('GET', '/api/admin/libraries', { token: SA() })).body;
  assert.equal(libs.find(l => l.libraryId === 'lib-a').planId, 'starter');

  const stu = (n) => Array.from({ length: n }, (_, i) => ({ id: `S${i}`, name: `S${i}`, status: 'Active', expiryDate: '2099-01-01' }));
  assert.equal((await call('PUT', '/api/students', { token: ctx.tokens.a, body: stu(2) })).status, 200);
  const over = await call('PUT', '/api/students', { token: ctx.tokens.a, body: stu(3) });
  assert.equal(over.status, 409, JSON.stringify(over.body));
  assert.equal((await call('PUT', '/api/students', { token: ctx.tokens.b, body: stu(3) })).status, 200, 'lib-b has no plan');

  assert.equal((await call('POST', '/api/invites', { token: ctx.tokens.a, body: { email: 's1@test.local' } })).status, 201);
  assert.equal((await call('POST', '/api/invites', { token: ctx.tokens.a, body: { email: 's1@test.local' } })).status, 201, 're-invite same email ok');
  const s2 = await call('POST', '/api/invites', { token: ctx.tokens.a, body: { email: 's2@test.local' } });
  assert.equal(s2.status, 409); assert.equal(s2.body.code, 'staff_limit');
  assert.equal((await call('POST', '/api/invites', { token: ctx.tokens.a, body: { email: 'co@test.local', role: 'client_admin' } })).status, 201, 'co-admins not counted');

  assert.equal((await call('PUT', '/api/branches', { token: ctx.tokens.a, body: [{ id: 'b1', name: 'One' }] })).status, 200);
  const b2 = await call('PUT', '/api/branches', { token: ctx.tokens.a, body: [{ id: 'b1', name: 'One' }, { id: 'b2', name: 'Two' }] });
  assert.equal(b2.status, 409); assert.equal(b2.body.code, 'branches_limit');
  assert.equal((await call('POST', '/api/branches', { token: ctx.tokens.a, body: { id: 'b3', name: 'Three' } })).status, 409);

  // per-library studentLimit override still wins over the plan
  await call('PATCH', '/api/admin/libraries/lib-a', { token: SA(), body: { studentLimit: 5 } });
  assert.equal((await call('PUT', '/api/students', { token: ctx.tokens.a, body: stu(3) })).status, 200);
  // removing the plan removes its limits
  await call('PATCH', '/api/admin/libraries/lib-a', { token: SA(), body: { planId: null, studentLimit: null } });
  assert.equal((await call('POST', '/api/invites', { token: ctx.tokens.a, body: { email: 's2@test.local' } })).status, 201);
});

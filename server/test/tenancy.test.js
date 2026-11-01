// Integration tests for the role hierarchy and tenant isolation.
// Requires a MongoDB instance: MONGODB_URI_TEST (default mongodb://127.0.0.1:27017).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { ensureSuperAdmin } from '../src/seed.js';

const MONGO = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017';
const DB = `lms_test_${Date.now()}`;
const SA = { email: 'super@test.local', password: 'SuperSecret#123' };
let server, base, tokens = {};

const call = async (method, path, { token, body, headers = {} } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const login = async (email, password) => (await call('POST', '/api/auth/login', { body: { email, password } })).body.token;

before(async () => {
  process.env.JWT_SECRET = 'test-secret';
  await mongoose.connect(MONGO, { dbName: DB });
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
  await ensureSuperAdmin({ SUPERADMIN_EMAIL: SA.email, SUPERADMIN_PASSWORD: SA.password });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  tokens.sa = await login(SA.email, SA.password);
  for (const [k, name] of [['a', 'Library A'], ['b', 'Library B']]) {
    const r = await call('POST', '/api/admin/libraries', { token: tokens.sa, body: { name, libraryId: `lib-${k}`, adminEmail: `admin-${k}@test.local`, adminPassword: `Password-${k}-123` } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    tokens[k] = await login(`admin-${k}@test.local`, `Password-${k}-123`);
  }
});

after(async () => {
  server?.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test('unauthenticated requests are rejected', async () => {
  assert.equal((await call('GET', '/api/students')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: SA.email, password: 'wrong-password' } })).status, 401);
});

test('client admin A creates data that is tagged with A regardless of body libraryId', async () => {
  const r = await call('POST', '/api/students', { token: tokens.a, body: { id: 'STU-1', name: 'Alice', status: 'Active', seatNo: 'A1', libraryId: 'lib-b' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.libraryId, 'lib-a');
  const p = await call('POST', '/api/payments', { token: tokens.a, body: { receiptNo: 'REC-1', studentId: 'STU-1', netTotal: 1500 } });
  assert.equal(p.status, 201);
  await call('PUT', '/api/seats', { token: tokens.a, body: [{ id: 'seat-1', name: 'A1' }, { id: 'seat-2', name: 'A2' }] });
  await call('POST', '/api/expenses', { token: tokens.a, body: { id: 'EXP-1', amount: 400, category: 'Rent' } });
});

test('client B cannot read A data', async () => {
  assert.equal((await call('GET', '/api/students/STU-1', { token: tokens.b })).status, 404);
  assert.deepEqual((await call('GET', '/api/students', { token: tokens.b })).body, []);
  assert.deepEqual((await call('GET', '/api/state', { token: tokens.b })).body.students, []);
  // spoofing the tenant header / query does not help a client admin
  const spoof = await call('GET', '/api/students?libraryId=lib-a', { token: tokens.b, headers: { 'X-Library-Id': 'lib-a' } });
  assert.deepEqual(spoof.body, []);
});

test('client B cannot modify or delete A data', async () => {
  assert.equal((await call('PUT', '/api/students/STU-1', { token: tokens.b, body: { name: 'Hacked' } })).status, 404);
  assert.equal((await call('DELETE', '/api/students/STU-1', { token: tokens.b })).status, 404);
  // bulk sync from B (empty array) only affects B's own collection
  await call('PUT', '/api/students', { token: tokens.b, body: [] });
  // B creating the same business id creates B's own copy, never overwrites A
  await call('PUT', '/api/students', { token: tokens.b, body: [{ id: 'STU-1', name: 'Bob', libraryId: 'lib-a' }] });
  const a = await call('GET', '/api/students/STU-1', { token: tokens.a });
  assert.equal(a.status, 200);
  assert.equal(a.body.name, 'Alice');
  const b = await call('GET', '/api/students/STU-1', { token: tokens.b });
  assert.equal(b.body.name, 'Bob');
  assert.equal(b.body.libraryId, 'lib-b');
});

test('settings are per library and libraryId is forced', async () => {
  await call('PUT', '/api/settings', { token: tokens.a, body: { name: 'A Settings', libraryId: 'lib-b' } });
  assert.equal((await call('GET', '/api/settings', { token: tokens.a })).body.libraryId, 'lib-a');
  const sb = (await call('GET', '/api/settings', { token: tokens.b })).body;
  assert.ok(!sb || sb.name !== 'A Settings');
});

test('client admins cannot use super admin endpoints', async () => {
  assert.equal((await call('GET', '/api/admin/libraries', { token: tokens.a })).status, 403);
  assert.equal((await call('GET', '/api/admin/metrics', { token: tokens.b })).status, 403);
  assert.equal((await call('POST', '/api/admin/libraries', { token: tokens.a, body: { name: 'X' } })).status, 403);
});

test('client admin user management is scoped to own library', async () => {
  const r = await call('POST', '/api/users', { token: tokens.a, body: { email: 'staff-a@test.local', role: 'superadmin' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'staff'); // cannot escalate
  assert.equal(r.body.user.libraryId, 'lib-a');
  const listB = (await call('GET', '/api/users', { token: tokens.b })).body;
  assert.ok(listB.every(u => u.libraryId === 'lib-b'));
  assert.equal((await call('PATCH', `/api/users/${r.body.user.id}`, { token: tokens.b, body: { status: 'Disabled' } })).status, 404);
});

test('super admin sees aggregate metrics', async () => {
  const m = (await call('GET', '/api/admin/metrics', { token: tokens.sa })).body;
  const a = m.perLibrary.find(x => x.libraryId === 'lib-a');
  assert.equal(a.seatsTotal, 2);
  assert.equal(a.seatsOccupied, 1);
  assert.equal(a.studentsActive, 1);
  assert.equal(a.revenue, 1500);
  assert.equal(a.expenses, 400);
  assert.equal(a.net, 1100);
  assert.equal(m.totals.libraries, 2);
  const libs = (await call('GET', '/api/admin/libraries', { token: tokens.sa })).body;
  assert.equal(libs.length, 2);
  assert.equal(libs[0].admins.length, 1);
});

test('super admin drill-in: requires X-Library-Id, read-only blocks writes', async () => {
  assert.equal((await call('GET', '/api/students', { token: tokens.sa })).status, 400);
  const ro = { 'X-Library-Id': 'lib-a', 'X-Read-Only': '1' };
  assert.equal((await call('GET', '/api/students', { token: tokens.sa, headers: ro })).body.length, 1);
  assert.equal((await call('PUT', '/api/students/STU-1', { token: tokens.sa, headers: ro, body: { name: 'x' } })).status, 403);
  const rw = { 'X-Library-Id': 'lib-a' };
  assert.equal((await call('PUT', '/api/students/STU-1', { token: tokens.sa, headers: rw, body: { phone: '123' } })).status, 200);
});

test('disabling a library locks out its users immediately', async () => {
  assert.equal((await call('PATCH', '/api/admin/libraries/lib-b', { token: tokens.sa, body: { status: 'Disabled' } })).status, 200);
  assert.equal((await call('GET', '/api/students', { token: tokens.b })).status, 403);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'admin-b@test.local', password: 'Password-b-123' } })).status, 403);
  await call('PATCH', '/api/admin/libraries/lib-b', { token: tokens.sa, body: { status: 'Active' } });
  assert.equal((await call('GET', '/api/students', { token: tokens.b })).status, 200);
});

test('google sign-in is rejected when not configured / unknown', async () => {
  const r = await call('POST', '/api/auth/google', { body: { credential: 'not-a-token' } });
  assert.ok([401, 501].includes(r.status));
});

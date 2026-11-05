// Issue #16: Super Admin deletes one library; every other library is untouched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { setup, teardown, call, ctx, login } from './helpers.js';

before(() => setup('delete_library'));
after(teardown);

const seed = async (tok, tag) => {
  for (const [col, rows] of Object.entries({
    students: [{ id: `S-${tag}`, name: `Stu ${tag}`, status: 'Active', expiryDate: '2099-01-01' }],
    payments: [{ id: `P-${tag}`, receiptNo: `R-${tag}`, amount: 100, studentId: `S-${tag}` }],
    expenses: [{ id: `E-${tag}`, amount: 10 }],
  })) assert.equal((await call('PUT', `/api/${col}`, { token: tok, body: rows })).status, 200, col);
  assert.equal((await call('PUT', '/api/settings', { token: tok, body: { name: `Lib ${tag}` } })).status, 200);
  assert.equal((await call('POST', '/api/invites', { token: tok, body: { email: `inv-${tag}@test.local` } })).status, 201);
};
const countsFor = async (tenant) => {
  const out = {};
  for (const n of mongoose.modelNames()) {
    if (n === 'AuditLog') continue;
    const M = mongoose.model(n);
    const f = M.schema.path('tenantId') ? 'tenantId' : M.schema.path('libraryId') ? 'libraryId' : null;
    if (f) out[n] = await M.collection.countDocuments({ [f]: tenant });
  }
  return out;
};

test('delete needs super admin and the exact name; then removes only that tenant', async () => {
  await seed(ctx.tokens.a, 'a'); await seed(ctx.tokens.b, 'b');
  const beforeB = await countsFor('lib-b');
  assert.ok(beforeB.User >= 1 && Object.values(beforeB).reduce((x, y) => x + y, 0) >= 6);

  assert.equal((await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.a, body: { confirmName: 'Library A' } })).status, 403, 'owner cannot');
  assert.equal((await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: { confirmName: 'library a' } })).status, 400, 'name must match');
  assert.equal((await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: {} })).status, 400);
  assert.equal((await call('DELETE', '/api/admin/libraries/nope', { token: ctx.tokens.sa, body: { confirmName: 'x' } })).status, 404);
  assert.ok(Object.values(await countsFor('lib-a')).some(n => n > 0), 'nothing deleted by refused calls');

  const r = await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: { confirmName: 'Library A' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.counts.User >= 1);

  const afterA = await countsFor('lib-a');
  assert.deepEqual(Object.entries(afterA).filter(([, n]) => n > 0), [], 'lib-a fully removed');
  assert.deepEqual(await countsFor('lib-b'), beforeB, 'lib-b untouched');
  assert.equal(await login('admin-a@test.local', 'Password-a-123'), undefined, 'deleted admin cannot sign in');
  assert.equal((await call('GET', '/api/students', { token: ctx.tokens.b })).body.length, 1);

  const libs = (await call('GET', '/api/admin/libraries', { token: ctx.tokens.sa })).body.map(l => l.libraryId);
  assert.ok(!libs.includes('lib-a') && libs.includes('lib-b'));
  const logs = (await call('GET', '/api/admin/audit-logs', { token: ctx.tokens.sa })).body;
  const list = Array.isArray(logs) ? logs : logs.items || logs.logs || [];
  const entry = list.find(l => l.action === 'library.deleted');
  assert.ok(entry, 'audit kept'); assert.equal(entry.target, 'lib-a');
  assert.ok(await login('super@test.local', 'SuperSecret#123'), 'super admin unaffected');
});

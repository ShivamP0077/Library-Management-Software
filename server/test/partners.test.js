// §9: partners/agents, commission rules frozen at sale time, attribution, assignment/transfer, access.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx, login } from './helpers.js';

const SA = () => ctx.tokens.sa;
let P1, P2, AG, p1Tok, agTok;
before(async () => {
  await setup('lms_partners_test');
  const mk = async (kind, name, email) => (await call('POST', '/api/admin/partners', { token: SA(), body: { kind, name, email, password: 'Partner-Pass-1' } })).body.partner;
  P1 = await mk('partner', 'Pune Partner', 'p1@test.local');
  P2 = await mk('partner', 'Delhi Partner', 'p2@test.local');
  AG = await mk('agent', 'Sales Agent', 'ag@test.local');
  p1Tok = await login('p1@test.local', 'Partner-Pass-1');
  agTok = await login('ag@test.local', 'Partner-Pass-1');
});
after(teardown);

test('create validates; rules are versioned', async () => {
  assert.equal((await call('POST', '/api/admin/partners', { token: SA(), body: { kind: 'boss', name: 'x', email: 'x@t.l' } })).status, 400);
  assert.equal((await call('PUT', `/api/admin/partners/${AG.id}/rules/initial`, { token: SA(), body: { mode: 'percent', value: 150 } })).status, 400);
  let r = await call('PUT', `/api/admin/partners/${AG.id}/rules/initial`, { token: SA(), body: { mode: 'percent', value: 10 } });
  assert.equal(r.body.rule.version, 1);
  await call('PUT', `/api/admin/partners/${P1.id}/rules/renewal`, { token: SA(), body: { mode: 'fixed', value: 200 } });
  const list = (await call('GET', '/api/admin/partners', { token: SA() })).body;
  assert.deepEqual(list.find(p => p.id === AG.id).rules.initial, { mode: 'percent', value: 10, version: 1 });
  assert.equal((await call('GET', '/api/admin/partners', { token: p1Tok })).status, 403);
});

test('initial commission goes to original seller, frozen against later rule edits; idempotent', async () => {
  await call('POST', '/api/admin/libraries/lib-a/assign', { token: SA(), body: { partnerId: P1.id, originalSellerId: AG.id, reason: 'signed by agent' } });
  let r = await call('POST', '/api/admin/sales', { token: SA(), body: { libraryId: 'lib-a', kind: 'initial', saleRef: 'INV-1', saleAmount: 5000 } });
  assert.equal(r.status, 201); assert.equal(r.body.record.amount, 500); assert.equal(r.body.record.sellerId, AG.id);
  r = await call('POST', '/api/admin/sales', { token: SA(), body: { libraryId: 'lib-a', kind: 'initial', saleRef: 'INV-1', saleAmount: 5000 } });
  assert.equal(r.body.created, false); assert.equal(r.body.reason, 'duplicate');
  await call('PUT', `/api/admin/partners/${AG.id}/rules/initial`, { token: SA(), body: { mode: 'percent', value: 50 } });
  const recs = (await call('GET', `/api/admin/commissions?sellerId=${AG.id}`, { token: SA() })).body;
  assert.equal(recs.length, 1); assert.equal(recs[0].amount, 500, 'historical commission unchanged'); assert.equal(recs[0].basis.value, 10);
  // attribution is locked once set
  assert.equal((await call('POST', '/api/admin/libraries/lib-a/assign', { token: SA(), body: { partnerId: P1.id, originalSellerId: P2.id } })).status, 409);
});

test('renewals go to the current managing partner; transfer is recorded; direct signup gets no initial commission', async () => {
  let r = await call('POST', '/api/admin/sales', { token: SA(), body: { libraryId: 'lib-a', kind: 'renewal', saleRef: 'INV-2', saleAmount: 5000 } });
  assert.equal(r.body.record.sellerId, P1.id); assert.equal(r.body.record.amount, 200);
  // direct signup lib-b, later assigned to P1: no initial commission, renewal earns
  await call('POST', '/api/admin/libraries/lib-b/assign', { token: SA(), body: { partnerId: P2.id } });
  r = await call('POST', '/api/admin/sales', { token: SA(), body: { libraryId: 'lib-b', kind: 'initial', saleRef: 'INV-B1', saleAmount: 4000 } });
  assert.equal(r.body.created, false); assert.equal(r.body.reason, 'direct_signup');
  await call('POST', '/api/admin/libraries/lib-b/assign', { token: SA(), body: { partnerId: P1.id, reason: 'moved city' } });
  r = await call('POST', '/api/admin/sales', { token: SA(), body: { libraryId: 'lib-b', kind: 'renewal', saleRef: 'INV-B2', saleAmount: 4000 } });
  assert.equal(r.body.record.sellerId, P1.id);
  const asg = (await call('GET', '/api/admin/assignments', { token: SA() })).body.find(a => a.tenantId === 'lib-b');
  assert.equal(asg.history.length, 2); assert.equal(asg.history[1].from, P2.id); assert.equal(asg.history[1].reason, 'moved city');
  const logs = (await call('GET', '/api/admin/audit-logs', { token: SA() })).body;
  assert.ok((Array.isArray(logs) ? logs : logs.items).some(l => l.action === 'library.transfer'));
});

test('reversal keeps the record with a reason; cannot reverse twice', async () => {
  const rec = (await call('GET', `/api/admin/commissions?sellerId=${P1.id}`, { token: SA() })).body.find(x => x.saleRef === 'INV-2');
  assert.equal((await call('POST', `/api/admin/commissions/${rec.id}/reverse`, { token: SA(), body: {} })).status, 400);
  const r = await call('POST', `/api/admin/commissions/${rec.id}/reverse`, { token: SA(), body: { reason: 'refund' } });
  assert.equal(r.body.status, 'reversed'); assert.equal(r.body.payoutStatus, 'void'); assert.equal(r.body.amount, 200);
  assert.equal((await call('POST', `/api/admin/commissions/${rec.id}/reverse`, { token: SA(), body: { reason: 'again' } })).status, 409);
});

test('partner portal: sees only assigned clients and own commissions; read-only Access Library; agent cannot access', async () => {
  const libs = (await call('GET', '/api/partner/libraries', { token: p1Tok })).body;
  assert.deepEqual(libs.map(l => l.libraryId).sort(), ['lib-a', 'lib-b']); assert.ok(libs.every(l => l.canAccess));
  const agLibs = (await call('GET', '/api/partner/libraries', { token: agTok })).body;
  assert.deepEqual(agLibs.map(l => l.libraryId), ['lib-a']); assert.equal(agLibs[0].canAccess, false);
  assert.ok((await call('GET', '/api/partner/commissions', { token: agTok })).body.every(c => c.sellerId === AG.id));
  // Access Library (read-only)
  assert.equal((await call('GET', '/api/students', { token: p1Tok, headers: { 'X-Library-Id': 'lib-a' } })).status, 200);
  assert.equal((await call('PUT', '/api/students', { token: p1Tok, headers: { 'X-Library-Id': 'lib-a' }, body: [] })).status, 403);
  assert.equal((await call('GET', '/api/students', { token: agTok, headers: { 'X-Library-Id': 'lib-a' } })).status, 403);
  assert.equal((await call('GET', '/api/students', { token: p1Tok })).status, 403);
  // transfer away → access gone
  await call('POST', '/api/admin/libraries/lib-b/assign', { token: SA(), body: { partnerId: P2.id } });
  assert.equal((await call('GET', '/api/students', { token: p1Tok, headers: { 'X-Library-Id': 'lib-b' } })).status, 403);
  // owner sees partner access in their audit log
  const own = (await call('GET', '/api/audit-logs', { token: ctx.tokens.a })).body;
  assert.ok((Array.isArray(own) ? own : own.items).some(l => l.action === 'partner.library_access'));
});

test('partner can change own password; disabling locks them out; dashboard shows partner + KPI', async () => {
  assert.equal((await call('POST', '/api/auth/change-password', { token: p1Tok, body: { currentPassword: 'Partner-Pass-1', newPassword: 'Partner-Pass-2' } })).status, 200);
  assert.ok(await login('p1@test.local', 'Partner-Pass-2'));
  const sum = (await call('GET', '/api/admin/saas-summary', { token: SA() })).body;
  assert.equal(sum.list.find(l => l.libraryId === 'lib-a').partner.name, 'Pune Partner');
  assert.match(sum.kpis.commissions.value, /₹/);
  await call('PATCH', `/api/admin/partners/${AG.id}`, { token: SA(), body: { status: 'Disabled' } });
  assert.equal((await call('GET', '/api/partner/me', { token: agTok })).status, 401);
});

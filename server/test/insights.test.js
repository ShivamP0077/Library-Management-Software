// SA-01: SaaS-only main dashboard, aggregate Library Insights without PII, audited, superadmin only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';

const SA = () => ctx.tokens.sa;
before(async () => {
  await setup('lms_insights_test');
  await call('PATCH', '/api/admin/libraries/lib-a', { token: SA(), body: { city: 'Pune' } });
  await call('PATCH', '/api/admin/libraries/lib-b', { token: SA(), body: { city: 'Delhi' } });
  await call('PUT', '/api/plans', { token: ctx.tokens.a, body: [{ id: 'P1', name: 'Monthly' }] });
  await call('PUT', '/api/seats', { token: ctx.tokens.a, body: [{ id: 'K1', name: '1', branchId: 'b1', sectionId: 's1' }, { id: 'K2', name: '2', branchId: 'b1', sectionId: 's1' }] });
  await call('PUT', '/api/students', { token: ctx.tokens.a, body: [
    { id: 'S1', name: 'Secret Name', phone: '9999999999', status: 'Active', planId: 'P1', seatNo: '1', branchId: 'b1', sectionId: 's1', expiryDate: '2099-01-01' },
    { id: 'S2', name: 'Other', status: 'Expired', planId: 'P1', expiryDate: '2000-01-01' }] });
  await call('PUT', '/api/payments', { token: ctx.tokens.a, body: [{ receiptNo: 'R1', studentId: 'S1', amount: 1000, netTotal: 1000, date: '2026-10-05', method: 'Cash', branchId: 'b1' }, { receiptNo: 'R2', studentId: 'S2', amount: 500, netTotal: 500, date: '2026-09-05', method: 'Cash' }] });
  await call('PUT', '/api/expenses', { token: ctx.tokens.a, body: [{ id: 'E1', category: 'Rent', amount: 300, date: '2026-10-10' }] });
  await call('PUT', '/api/students', { token: ctx.tokens.b, body: [{ id: 'X1', name: 'B Student', status: 'Active' }] });
});
after(teardown);

test('main dashboard holds only SaaS KPIs (no customer students/seats/fees)', async () => {
  const r = await call('GET', '/api/admin/saas-summary', { token: SA() });
  assert.equal(r.status, 200);
  assert.equal(r.body.libraries.total, 2); assert.equal(r.body.libraries.active, 2);
  assert.ok(r.body.notAvailable.includes('softwareRevenue'));
  const flat = JSON.stringify(r.body);
  for (const k of ['studentsActive', 'seatsTotal', 'revenue', 'collections', 'expenses', 'Secret Name']) assert.ok(!flat.includes(k), `summary leaks ${k}`);
  const a = r.body.list.find(l => l.libraryId === 'lib-a');
  assert.equal(a.owner.email, 'admin-a@test.local'); assert.equal(a.city, 'Pune');
});

test('Library Insights aggregates with filters and no PII', async () => {
  let r = await call('GET', '/api/admin/insights', { token: SA() });
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.studentsTotal, 3); assert.equal(r.body.totals.studentsActive, 2);
  assert.equal(r.body.totals.customerFeeCollections, 1500); assert.equal(r.body.totals.customerExpenses, 300);
  const a = r.body.perLibrary.find(l => l.libraryId === 'lib-a');
  assert.equal(a.seatsOccupied, 1); assert.equal(a.seatUtilization, 50);
  assert.deepEqual(r.body.popularPlans[0], { name: 'Monthly', students: 2 });
  assert.ok(!JSON.stringify(r.body).includes('Secret Name') && !JSON.stringify(r.body).includes('9999999999'));
  r = await call('GET', '/api/admin/insights?from=2026-10-01&to=2026-10-31&city=pune', { token: SA() });
  assert.equal(r.body.totals.libraries, 1); assert.equal(r.body.totals.customerFeeCollections, 1000); assert.equal(r.body.totals.customerNet, 700);
  assert.deepEqual(r.body.trend.map(t => t.month), ['2026-10']);
  r = await call('GET', '/api/admin/insights?libraryId=lib-b', { token: SA() });
  assert.equal(r.body.totals.studentsTotal, 1);
});

test('insights access and export are audited; owners cannot read them', async () => {
  const csv = await fetch(`${ctx.base}/api/admin/insights/export.csv?city=Pune`, { headers: { Authorization: `Bearer ${SA()}` } });
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text.split('\n')[0], /Library ID,Library,City/); assert.equal(text.trim().split('\n').length, 2);
  const logs = (await call('GET', '/api/admin/audit-logs', { token: SA() })).body;
  const list = Array.isArray(logs) ? logs : logs.items;
  assert.ok(list.some(l => l.action === 'insights.view')); assert.ok(list.some(l => l.action === 'insights.export'));
  for (const p of ['/api/admin/insights', '/api/admin/saas-summary']) assert.equal((await call('GET', p, { token: ctx.tokens.a })).status, 403);
});

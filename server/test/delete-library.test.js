// Issue #16: Super Admin deletes one library; every other library is untouched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { setup, teardown, call, ctx, login } from './helpers.js';
import { User } from '../src/models.js';
import { AuditLog } from '../src/audit.js';
import { SoftwareInvoice } from '../src/payments/invoices.js';
import { PasswordResetOtp } from '../src/accounts.js';
import { DeletionJob } from '../src/deletionJob.js';

before(() => setup('delete_library'));
after(teardown);

const KEEP = new Set(['AuditLog', 'Library', 'User', 'DeletionJob']);
const tenantFields = (M) => ['tenantId', 'libraryId'].filter((field) => M.schema.path(field));
const tenantQuery = (M, tenant) => {
  const fields = tenantFields(M);
  return fields.length === 1 ? { [fields[0]]: tenant } : { $or: fields.map((field) => ({ [field]: tenant })) };
};
const countsFor = async (tenant) => {
  const out = {};
  for (const n of mongoose.modelNames()) {
    if (KEEP.has(n)) continue;
    const M = mongoose.model(n);
    if (!tenantFields(M).length) continue;
    out[n] = await M.collection.countDocuments(tenantQuery(M, tenant));
  }
  return out;
};
const sampleDocFor = (M, tenant) => {
  const doc = {};
  for (const field of tenantFields(M)) doc[field] = tenant;
  return doc;
};

const seed = async (tok, tag) => {
  for (const [col, rows] of Object.entries({
    students: [{ id: `S-${tag}`, name: `Stu ${tag}`, status: 'Active', expiryDate: '2099-01-01' }],
    payments: [{ id: `P-${tag}`, receiptNo: `R-${tag}`, amount: 100, studentId: `S-${tag}` }],
    expenses: [{ id: `E-${tag}`, amount: 10 }],
  })) assert.equal((await call('PUT', `/api/${col}`, { token: tok, body: rows })).status, 200, col);
  assert.equal((await call('PUT', '/api/settings', { token: tok, body: { name: `Lib ${tag}` } })).status, 200);
  assert.equal((await call('POST', '/api/invites', { token: tok, body: { email: `inv-${tag}@test.local` } })).status, 201);
};

test('delete needs super admin and the exact name; then removes only that tenant', async () => {
  await seed(ctx.tokens.a, 'a'); await seed(ctx.tokens.b, 'b');
  const beforeB = await countsFor('lib-b');
  assert.ok((await User.countDocuments({ tenantId: 'lib-b' })) >= 1);
  assert.ok(Object.values(beforeB).reduce((x, y) => x + y, 0) >= 5);

  const adminA = await User.findOne({ email: 'admin-a@test.local' }).lean();
  await AuditLog.create({ tenantId: 'lib-a', actorId: 'old-actor', actorEmail: 'admin-a@test.local', ip: '203.0.113.9', action: 'test.pii', target: 'a@test.local', reason: 'contains PII', detail: { password: 'hunter2', name: 'Stu A' } });
  await SoftwareInvoice.create({ invoiceId: 'inv-a-retained', tenantId: 'lib-a', amount: 499, currency: 'INR', status: 'paid', provider: 'razorpay', providerRef: 'pay_live_secret', raw: { card: '4111111111111111', email: 'admin-a@test.local' } });
  await PasswordResetOtp.create({ userId: String(adminA._id), codeHash: 'otp-hash', expiresAt: new Date(Date.now() + 600000) });

  assert.equal((await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.a, body: { confirmName: 'Library A' } })).status, 403, 'owner cannot');
  assert.equal((await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: { confirmName: 'Library B' } })).status, 400, 'name must match');
  const mm = await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: { confirmName: 'Library' } });
  assert.equal(mm.status, 400); assert.equal(mm.body.code, 'confirm_mismatch'); assert.match(mm.body.error, /Nothing was deleted/);
  assert.equal((await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: {} })).status, 400);
  assert.equal((await call('DELETE', '/api/admin/libraries/nope', { token: ctx.tokens.sa, body: { confirmName: 'x' } })).status, 404);
  assert.ok(Object.values(await countsFor('lib-a')).some(n => n > 0), 'nothing deleted by refused calls');

  const loose = await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: { confirmName: '  library\u00a0 a ' } });
  assert.equal(loose.status, 400, 'case/NBSP/internal-space variations are rejected');
  const r = await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: { confirmName: '  Library A  ' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.counts.User >= 1);
  assert.ok(r.body.retention?.subject?.startsWith('lib_'), 'pseudonymised retention summary');
  assert.equal(r.body.retention.retainedForLegalAuditOnly, true);
  assert.ok(r.body.retention.retained.some(x => x.collection === 'SoftwareInvoice'), 'retention policy lists invoices');
  const retry = await call('DELETE', '/api/admin/libraries/lib-a', { token: ctx.tokens.sa, body: { confirmName: 'Library A' } });
  assert.equal(retry.status, 200, 'idempotent retry');
  assert.equal(retry.body.alreadyDeleted, true);

  const afterA = await countsFor('lib-a');
  assert.deepEqual(Object.entries(afterA).filter(([, n]) => n > 0), [], 'lib-a fully removed (tenantId + libraryId)');
  assert.deepEqual(await countsFor('lib-b'), beforeB, 'lib-b untouched');
  assert.equal(await login('admin-a@test.local', 'Password-a-123'), undefined, 'deleted admin cannot sign in');
  assert.equal((await call('GET', '/api/students', { token: ctx.tokens.b })).body.length, 1);
  assert.equal(await PasswordResetOtp.countDocuments({ userId: String(adminA._id) }), 0, 'no dangling reset OTP');

  const invoice = await SoftwareInvoice.findOne({ invoiceId: 'inv-a-retained' }).lean();
  assert.ok(invoice, 'financial invoice retained');
  assert.equal(invoice.tenantId, r.body.retention.subject);
  assert.equal(invoice.amount, 499);
  assert.equal(invoice.raw, undefined, 'provider receipt/card PII removed');
  assert.equal(invoice.providerRef, undefined, 'live provider reference removed');
  assert.equal(invoice.redactedAt != null, true);

  const oldAudit = await AuditLog.findOne({ action: 'test.pii' }).lean();
  assert.ok(oldAudit, 'audit history retained');
  assert.equal(oldAudit.tenantId, r.body.retention.subject);
  for (const field of ['actorId', 'actorEmail', 'ip', 'reason', 'detail', 'target', 'impersonation']) assert.equal(oldAudit[field], undefined, `${field} redacted from audit`);
  assert.doesNotMatch(JSON.stringify(oldAudit), /hunter2|admin-a@test|203\.0\.113|a@test\.local/i, 'no PII/password in retained audit');

  const job = await DeletionJob.findOne({ libraryId: 'lib-a' }).lean();
  assert.equal(job.status, 'completed');
  assert.equal(job.targetName, 'Library A');
  assert.equal(job.attempts, 1);

  const libs = (await call('GET', '/api/admin/libraries', { token: ctx.tokens.sa })).body.map(l => l.libraryId);
  assert.ok(!libs.includes('lib-a') && libs.includes('lib-b'));
  const logs = (await call('GET', '/api/admin/audit-logs', { token: ctx.tokens.sa })).body;
  const list = Array.isArray(logs) ? logs : logs.items || logs.logs || [];
  const entry = list.find(l => l.action === 'library.deleted');
  assert.ok(entry, 'audit kept'); assert.equal(entry.target, 'lib-a');
  assert.equal(entry.actorEmail, undefined, 'deletion proof stores no super-admin email');
  assert.doesNotMatch(JSON.stringify(entry), /hunter2|passwordHash/i, 'deletion proof stores no password');
  assert.ok(await login('super@test.local', 'SuperSecret#123'), 'super admin unaffected');

  const reuse = await call('POST', '/api/admin/libraries', { token: ctx.tokens.sa, body: { name: 'Library A Again', libraryId: 'lib-a' } });
  assert.equal(reuse.status, 409, 'deleted library id is never reused');
  assert.equal(reuse.body.code, 'library_id_retired');
});

test('every registered tenant model is covered through both tenancy fields', async () => {
  const created = await call('POST', '/api/admin/libraries', { token: ctx.tokens.sa, body: { name: 'Library Z', libraryId: 'lib-z' } });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  for (const name of mongoose.modelNames()) {
    if (KEEP.has(name)) continue;
    const M = mongoose.model(name);
    if (!tenantFields(M).length) continue;
    const doc = sampleDocFor(M, 'lib-z');
    await M.collection.insertOne(doc);
  }
  const before = await countsFor('lib-z');
  for (const [name, n] of Object.entries(before)) assert.ok(n > 0, `seeded ${name}`);

  const r = await call('DELETE', '/api/admin/libraries/lib-z', { token: ctx.tokens.sa, body: { confirmName: 'Library Z' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await countsFor('lib-z');
  assert.deepEqual(Object.entries(after).filter(([, n]) => n > 0), [], 'no document dangles in any registered model');
});

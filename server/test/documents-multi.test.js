// Issue #3: multi-file documents, tenant/student-scoped fetch and 30-day retention.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { StudentDocument } from '../src/models.js';
import { purgeExpiredDocuments } from '../src/documentRetention.js';

const A = () => ctx.tokens.a;
before(async () => {
  await setup('documents_multi');
  await call('POST', '/api/students', { token: A(), body: { id: 'S-DOC', name: 'Doc Student', status: 'Active' } });
  await call('POST', '/api/students', { token: A(), body: { id: 'S-OTHER', name: 'Other Student', status: 'Active' } });
});
after(teardown);

test('#3 documents carry metadata and are only fetchable through their student', async () => {
  const put = await call('PUT', '/api/documents/doc-front', {
    token: A(), body: { data: 'data:image/png;base64,AAAA', studentId: 'S-DOC', docTypeId: 'aadhaar', fileName: 'front.png', fileType: 'image/png', fileSize: 4 },
  });
  assert.equal(put.status, 200);
  assert.equal((await call('GET', '/api/documents/doc-front', { token: A() })).body.fileName, 'front.png');
  assert.equal((await call('GET', '/api/students/S-DOC/documents/doc-front', { token: A() })).status, 200);
  assert.equal((await call('GET', '/api/students/S-OTHER/documents/doc-front', { token: A() })).status, 404, 'wrong student');
  assert.equal((await call('GET', '/api/students/S-DOC/documents/doc-front', { token: ctx.tokens.b })).status, 404, 'other tenant');
});

test('#3 deleted files are hidden immediately but retained for 30 days, then purged', async () => {
  await call('PUT', '/api/documents/doc-back', { token: A(), body: { data: 'data:image/png;base64,BBBB', studentId: 'S-DOC', docTypeId: 'aadhaar', fileName: 'back.png' } });
  const del = await call('DELETE', '/api/documents/doc-back', { token: A() });
  assert.equal(del.status, 200);
  assert.equal(del.body.retentionDays, 30);
  assert.equal((await call('GET', '/api/documents/doc-back', { token: A() })).status, 404, 'hidden from normal fetch');
  const retired = await StudentDocument.findOne({ tenantId: 'lib-a', storageKey: 'doc-back' }).lean();
  assert.ok(retired?.retiredAt && retired?.purgeAfter, 'row retained');
  assert.equal((await call('PATCH', '/api/documents/doc-back', { token: A(), body: { studentId: 'S-OTHER' } })).status, 404, 'retired files cannot be re-claimed');
  const early = await purgeExpiredDocuments({ now: new Date(Date.now() + 29 * 864e5) });
  assert.equal(early.purged, 0);
  const late = await purgeExpiredDocuments({ now: new Date(Date.now() + 31 * 864e5) });
  assert.ok(late.purged >= 1);
  assert.equal(await StudentDocument.exists({ tenantId: 'lib-a', storageKey: 'doc-back' }), null);
});

test('#22 notices keep several attachments and an interrupted retry does not duplicate', async () => {
  const body = {
    title: 'Fire safety notice', summary: 'Two pages', clientRequestId: 'notice-req-1',
    attachments: [
      { name: 'page1.png', data: 'data:image/png;base64,AAAA' },
      { name: 'page2.pdf', data: 'data:application/pdf;base64,BBBB' },
    ],
  };
  const first = await call('POST', '/api/notices', { token: A(), body });
  assert.equal(first.status, 201);
  assert.equal(first.body.attachments.length, 2);
  assert.equal(first.body.attachments[1].name, 'page2.pdf');
  const retry = await call('POST', '/api/notices', { token: A(), body });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.deduplicated, true);
  assert.equal(retry.body.id, first.body.id);
  const second = await call('GET', `/api/notifications/${first.body.id}/attachments/1`, { token: A() });
  assert.equal(second.body.type, 'application/pdf');
  // legacy single endpoint still returns the first file
  assert.equal((await call('GET', `/api/notifications/${first.body.id}/attachment`, { token: A() })).body.name, 'page1.png');
});

test('#22 invalid or too many attachments are rejected without creating a notice', async () => {
  const bad = await call('POST', '/api/notices', { token: A(), body: { title: 'Bad file', attachments: [{ name: 'x.exe', data: 'data:application/x-msdownload;base64,AAAA' }] } });
  assert.equal(bad.status, 400);
  const many = await call('POST', '/api/notices', { token: A(), body: { title: 'Too many', attachments: Array.from({ length: 9 }, (_, i) => ({ name: `${i}.png`, data: 'data:image/png;base64,AAAA' })) } });
  assert.equal(many.status, 400);
});

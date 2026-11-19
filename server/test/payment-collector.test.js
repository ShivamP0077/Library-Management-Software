import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { models } from '../src/models.js';
import { todayIn } from '../src/finance.js';

const A = () => ctx.tokens.a;
before(() => setup('lms_payment_collector'));
after(teardown);

const pay = (receiptNo, extra = {}) => ({
  receiptNo,
  studentId: 'S1',
  amount: 500,
  netTotal: 500,
  method: 'Cash',
  date: todayIn(),
  paidOn: todayIn(),
  collectedByName: 'Forged Name',
  collectedByUserId: 'forged-id',
  collectedByRole: 'Forged',
  staffName: 'Forged Staff',
  ...extra,
});

test('creating a payment stamps the signed-in user and ignores a forged collector', async () => {
  const created = await call('POST', '/api/payments', { token: A(), body: pay('COL-1', {
    paymentProofs: [
      { storageKey: 'payproof_1', fileName: 'slip.jpg', fileType: 'image/jpeg', fileSize: 40, dataUrl: 'data:image/jpeg;base64,AAAA' },
      { storageKey: 'payproof_pdf', fileName: 'slip.pdf', fileType: 'application/pdf' },
    ],
  }) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.collectedByName, 'admin-a@test.local');
  assert.equal(created.body.collectedByRole, 'Owner');
  assert.equal(created.body.staffName, 'admin-a@test.local');
  assert.ok(created.body.collectedByUserId);
  assert.notEqual(created.body.collectedByUserId, 'forged-id');
  assert.deepEqual(created.body.paymentProofs, [
    { storageKey: 'payproof_1', fileName: 'slip.jpg', fileType: 'image/jpeg', fileSize: 40 },
  ]);
});

test('a staff payment uses the staff role name', async () => {
  assert.equal((await call('PUT', '/api/staffMembers', { token: A(), body: [{ id: 'st-rina', name: 'Rina Desk', role: 'Librarian', status: 'Active', email: 'rina@test.local' }] })).status, 200);
  const user = await call('POST', '/api/admin/libraries/lib-a/users', {
    token: ctx.tokens.sa,
    body: { email: 'rina@test.local', name: 'Rina Desk', role: 'staff', staffId: 'st-rina', password: 'Password-rina-123' },
  });
  assert.equal(user.status, 201, JSON.stringify(user.body));
  const token = (await call('POST', '/api/auth/login', { body: { email: 'rina@test.local', password: 'Password-rina-123' } })).body?.token;
  const created = await call('POST', '/api/payments', { token, body: pay('COL-STAFF', { suggestedAmount: 500 }) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.collectedByName, 'Rina Desk');
  assert.equal(created.body.collectedByRole, 'Librarian');
  assert.equal(created.body.staffName, 'Rina Desk');
});

test('updating a payment does not change the collector, and old payments are not backfilled', async () => {
  const updated = await call('PUT', '/api/payments/COL-1', {
    token: A(),
    body: { amount: 500, netTotal: 500, method: 'Cash', collectedByName: 'Someone Else', staffName: 'Someone Else' },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.collectedByName, 'admin-a@test.local');
  assert.equal(updated.body.staffName, 'admin-a@test.local');

  await models.payments.create({
    tenantId: 'lib-a',
    libraryId: 'lib-a',
    _key: 'OLD-1',
    receiptNo: 'OLD-1',
    studentId: 'S1',
    amount: 100,
    netTotal: 100,
    method: 'Cash',
    date: '2020-01-01',
    staffName: 'Legacy',
  });
  const list = (await call('GET', '/api/payments', { token: A() })).body;
  const body = list.map(row => row.receiptNo === 'OLD-1'
    ? { ...row, collectedByName: 'Forged', collectedByUserId: 'forged', collectedByRole: 'Owner', staffName: 'Legacy' }
    : row);
  body.push(pay('COL-BULK'));
  const bulk = await call('PUT', '/api/payments', { token: A(), body });
  assert.equal(bulk.status, 200, JSON.stringify(bulk.body));
  const after = (await call('GET', '/api/payments', { token: A() })).body;
  const old = after.find(row => row.receiptNo === 'OLD-1');
  const fresh = after.find(row => row.receiptNo === 'COL-BULK');
  assert.equal(old.collectedByName, undefined);
  assert.equal(old.collectedByUserId, undefined);
  assert.equal(old.staffName, 'Legacy');
  assert.equal(fresh.collectedByName, 'admin-a@test.local');
  assert.equal(fresh.collectedByRole, 'Owner');
  assert.notEqual(fresh.collectedByName, 'Forged Name');
});

test('a newly added student payment history row is stamped and older rows stay as saved', async () => {
  const today = todayIn();
  const created = await call('POST', '/api/students', { token: A(), body: {
    id: 'S-COL',
    name: 'Ravi',
    status: 'Active',
    expiryDate: '2026-12-31',
    paymentHistory: [{ receiptNo: 'PH-OLD', method: 'Cash', amount: 100, netTotal: 100, paidOn: today, date: today, collectedByName: 'Forged' }],
  } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.paymentHistory[0].collectedByName, 'admin-a@test.local');
  assert.equal(created.body.paymentHistory[0].collectedByRole, 'Owner');

  const next = await call('PUT', '/api/students/S-COL', { token: A(), body: {
    paymentHistory: [
      { ...created.body.paymentHistory[0], collectedByName: 'Changed', staffName: 'Changed' },
      { receiptNo: 'PH-NEW', method: 'Cash', amount: 200, netTotal: 200, paidOn: today, date: today, collectedByName: 'Forged' },
    ],
  } });
  assert.equal(next.status, 200, JSON.stringify(next.body));
  const rows = next.body.paymentHistory;
  assert.equal(rows[0].collectedByName, 'admin-a@test.local');
  assert.equal(rows[0].staffName, 'admin-a@test.local');
  assert.equal(rows[1].collectedByName, 'admin-a@test.local');
  assert.equal(rows[1].receiptNo, 'PH-NEW');
});

const proof = (key = 'payproof_x') => ({ storageKey: key, fileName: `${key}.jpg`, fileType: 'image/jpeg', fileSize: 20 });

test('owner can set payment proof mode; staff cannot; missing value stays Optional', async () => {
  const first = await call('GET', '/api/settings', { token: A() });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body?.paymentProofMode || 'OPTIONAL', 'OPTIONAL');

  const required = await call('PUT', '/api/settings', { token: A(), body: { ...(first.body || {}), paymentProofMode: 'REQUIRED' } });
  assert.equal(required.status, 200, JSON.stringify(required.body));
  assert.equal(required.body.paymentProofMode, 'REQUIRED');

  const staffTok = (await call('POST', '/api/auth/login', { body: { email: 'rina@test.local', password: 'Password-rina-123' } })).body?.token;
  const staffTry = await call('PUT', '/api/settings', { token: staffTok, body: { paymentProofMode: 'OFF' } });
  assert.equal(staffTry.status, 403, JSON.stringify(staffTry.body));
  assert.equal(staffTry.body.code, 'owner_only');
  assert.equal((await call('GET', '/api/settings', { token: A() })).body.paymentProofMode, 'REQUIRED');

  const keep = await call('PUT', '/api/settings', { token: staffTok, body: { name: 'Staff rename' } });
  assert.equal(keep.status, 200, JSON.stringify(keep.body));
  assert.equal(keep.body.paymentProofMode, 'REQUIRED');

  const logs = (await call('GET', '/api/admin/audit-logs?tenantId=lib-a&limit=200', { token: ctx.tokens.sa })).body;
  const items = Array.isArray(logs) ? logs : (logs.items || logs.logs || []);
  assert.ok(items.some(l => l.action === 'settings.payment_proof_mode'), JSON.stringify(items.map(l => l.action)).slice(0, 400));
});

test('REQUIRED blocks a new payment without proof, and OFF drops a sent proof', async () => {
  await call('PUT', '/api/settings', { token: A(), body: { paymentProofMode: 'REQUIRED' } });
  const missing = await call('POST', '/api/payments', { token: A(), body: pay('REQ-MISS') });
  assert.equal(missing.status, 400, JSON.stringify(missing.body));
  assert.equal(missing.body.code, 'payment_proof_required');

  const ok = await call('POST', '/api/payments', { token: A(), body: pay('REQ-OK', { paymentProofs: [proof('payproof_req')] }) });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.paymentProofs[0].storageKey, 'payproof_req');

  await call('PUT', '/api/settings', { token: A(), body: { paymentProofMode: 'OFF' } });
  const dropped = await call('POST', '/api/payments', { token: A(), body: pay('OFF-1', { paymentProofs: [proof('payproof_off')] }) });
  assert.equal(dropped.status, 201, JSON.stringify(dropped.body));
  assert.equal(dropped.body.paymentProofs, undefined);

  await call('PUT', '/api/settings', { token: A(), body: { paymentProofMode: 'OPTIONAL' } });
  const optional = await call('POST', '/api/payments', { token: A(), body: pay('OPT-1') });
  assert.equal(optional.status, 201, JSON.stringify(optional.body));
  assert.ok(!optional.body.paymentProofs || optional.body.paymentProofs.length === 0);
});

test('only the owner can change proof on a saved payment, and the change is audited', async () => {
  const created = await call('POST', '/api/payments', { token: A(), body: pay('EDIT-1', { paymentProofs: [proof('payproof_old')] }) });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const staffTok = (await call('POST', '/api/auth/login', { body: { email: 'rina@test.local', password: 'Password-rina-123' } })).body?.token;
  const staffEdit = await call('PUT', '/api/payments/EDIT-1', {
    token: staffTok,
    body: { paymentProofs: [proof('payproof_staff')] },
  });
  const afterStaff = (await call('GET', '/api/payments/EDIT-1', { token: A() })).body;
  assert.deepEqual((afterStaff.paymentProofs || []).map(p => p.storageKey), ['payproof_old'], JSON.stringify({ staffEdit, afterStaff }));

  const ownerEdit = await call('PUT', '/api/payments/EDIT-1', {
    token: A(),
    body: { paymentProofs: [proof('payproof_new')] },
  });
  assert.equal(ownerEdit.status, 200, JSON.stringify(ownerEdit.body));
  assert.deepEqual(ownerEdit.body.paymentProofs.map(p => p.storageKey), ['payproof_new']);

  await call('PUT', '/api/settings', { token: A(), body: { paymentProofMode: 'REQUIRED' } });
  const cleared = await call('PUT', '/api/payments/EDIT-1', { token: A(), body: { paymentProofs: [] } });
  assert.equal(cleared.status, 400, JSON.stringify(cleared.body));
  assert.equal(cleared.body.code, 'payment_proof_required');
  assert.equal((await call('GET', '/api/payments/EDIT-1', { token: A() })).body.paymentProofs[0].storageKey, 'payproof_new');

  const logs = (await call('GET', '/api/admin/audit-logs?tenantId=lib-a&limit=200', { token: ctx.tokens.sa })).body;
  const items = Array.isArray(logs) ? logs : (logs.items || logs.logs || []);
  const entry = items.find(l => l.action === 'payment.proof_updated' && l.target === 'EDIT-1');
  assert.ok(entry, JSON.stringify(items.filter(l => String(l.action).includes('proof')).slice(0, 5)));
  assert.deepEqual(entry.detail.before, ['payproof_old']);
  assert.deepEqual(entry.detail.after, ['payproof_new']);

  await call('PUT', '/api/settings', { token: A(), body: { paymentProofMode: 'OPTIONAL' } });
});

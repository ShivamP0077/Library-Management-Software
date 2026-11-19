// Public demo requests and the Super Admin list.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { DemoRequest } from '../src/demoRequests.js';
import { resetRateLimits } from '../src/accounts.js';

before(async () => { await setup('demo-requests'); });
after(async () => { await teardown(); });
beforeEach(() => resetRateLimits());

const post = (body) => call('POST', '/api/public/demo-requests', { body });

const base = (over = {}) => ({
  libraryName: 'Sunrise Library',
  seatCapacity: 40,
  city: 'Pune',
  ...over,
});

test('accepts mobile only, email only, and both', async () => {
  const mobile = await post(base({ libraryName: 'Mobile Only', mobile: '+91 98765 43210' }));
  assert.equal(mobile.status, 201, JSON.stringify(mobile.body));
  assert.deepEqual(mobile.body, { ok: true });

  const email = await post(base({ libraryName: 'Email Only', email: 'Owner@Example.com' }));
  assert.equal(email.status, 201, JSON.stringify(email.body));

  const both = await post(base({ libraryName: 'Both', mobile: '09876543211', email: 'both@example.com', source: 'landing' }));
  assert.equal(both.status, 201, JSON.stringify(both.body));

  const rows = await DemoRequest.find({ libraryName: { $in: ['Mobile Only', 'Email Only', 'Both'] } }).lean();
  const byName = Object.fromEntries(rows.map((row) => [row.libraryName, row]));
  assert.equal(byName['Mobile Only'].mobile, '919876543210');
  assert.equal(byName['Mobile Only'].email, '');
  assert.equal(byName['Email Only'].email, 'owner@example.com');
  assert.equal(byName['Email Only'].mobile, '');
  assert.equal(byName.Both.mobile, '919876543211');
  assert.equal(byName.Both.email, 'both@example.com');
  assert.equal(byName.Both.status, 'NEW');
  assert.equal(byName.Both.source, 'landing');
  assert.equal(byName.Both.seatCapacity, 40);
});

test('rejects missing contact, bad mobile, bad email, and missing fields', async () => {
  const expect400 = async (body) => {
    resetRateLimits();
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(res.body));
  };
  await expect400(base({ libraryName: 'No contact' }));
  await expect400(base({ mobile: '12345' }));
  await expect400(base({ email: 'nope' }));
  await expect400(base({ libraryName: '   ', mobile: '9876543210' }));
  await expect400(base({ city: '  ', mobile: '9876543210' }));
  await expect400(base({ seatCapacity: 0, mobile: '9876543210' }));
  await expect400(base({ seatCapacity: -4, mobile: '9876543210' }));
  await expect400(base({ seatCapacity: 'nope', mobile: '9876543210' }));
  await expect400(base({ seatCapacity: 1.5, mobile: '9876543210' }));
  const missingSeat = base({ mobile: '9876543210' });
  delete missingSeat.seatCapacity;
  await expect400(missingSeat);
  assert.equal(await DemoRequest.countDocuments({ libraryName: 'No contact' }), 0);
});

test('honeypot returns 200 and stores nothing', async () => {
  const beforeCount = await DemoRequest.countDocuments();
  const honey = await post(base({ libraryName: 'Bot Hall', mobile: '9876543210', website: 'http://spam.test' }));
  assert.equal(honey.status, 200);
  assert.deepEqual(honey.body, { ok: true });
  assert.equal(await DemoRequest.countDocuments(), beforeCount);
});

test('rate limit returns 429 after five submissions', async () => {
  let last;
  for (let i = 0; i < 5; i += 1) {
    last = await post(base({ libraryName: `Rate ${i}`, mobile: `900000000${i}` }));
    assert.equal(last.status, 201, JSON.stringify(last.body));
  }
  last = await post(base({ libraryName: 'Rate blocked', mobile: '9000000009' }));
  assert.equal(last.status, 429);
  assert.equal(last.body.code, 'rate_limited');
});

test('library admin and anonymous callers cannot list or update', async () => {
  const open = await call('GET', '/api/admin/demo-requests');
  assert.equal(open.status, 401);
  const openPatch = await call('PATCH', '/api/admin/demo-requests/000000000000000000000000', { body: { status: 'CLOSED' } });
  assert.equal(openPatch.status, 401);

  const asOwner = await call('GET', '/api/admin/demo-requests', { token: ctx.tokens.a });
  assert.equal(asOwner.status, 403);
  const asOwnerPatch = await call('PATCH', '/api/admin/demo-requests/000000000000000000000000', { token: ctx.tokens.a, body: { note: 'no' } });
  assert.equal(asOwnerPatch.status, 403);
});

test('superadmin lists newest first, filters, searches, and updates status and note', async () => {
  await DemoRequest.deleteMany({});
  const older = await post(base({ libraryName: 'Older Hall', mobile: '9123456780', city: 'Jaipur', seatCapacity: 12 }));
  assert.equal(older.status, 201);
  const newer = await post(base({ libraryName: 'Newer Hall', email: 'new@example.com', city: 'Kochi', seatCapacity: 80 }));
  assert.equal(newer.status, 201);
  await DemoRequest.updateOne({ libraryName: 'Older Hall' }, { $set: { createdAt: new Date(Date.now() - 60_000) } });

  const list = await call('GET', '/api/admin/demo-requests', { token: ctx.tokens.sa });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body[0].libraryName, 'Newer Hall');
  assert.equal(list.body[1].libraryName, 'Older Hall');
  assert.equal(list.body[0].name, 'Newer Hall');
  assert.equal(list.body[0].email, 'new@example.com');
  assert.equal(list.body[0].seatCapacity, 80);
  assert.equal(list.body[0].city, 'Kochi');
  assert.equal(list.body[0].status, 'NEW');
  assert.equal(list.body[0].note, '');
  assert.ok(list.body[0].createdAt);
  assert.ok(list.body[0].id);

  const found = await call('GET', '/api/admin/demo-requests?search=' + encodeURIComponent('jaipur'), { token: ctx.tokens.sa });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.map((row) => row.libraryName), ['Older Hall']);

  const id = list.body[0].id;
  const patched = await call('PATCH', `/api/admin/demo-requests/${id}`, {
    token: ctx.tokens.sa,
    body: { status: 'CONTACTED', note: 'Called the owner' },
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.status, 'CONTACTED');
  assert.equal(patched.body.note, 'Called the owner');

  const onlyNew = await call('GET', '/api/admin/demo-requests?status=NEW', { token: ctx.tokens.sa });
  assert.deepEqual(onlyNew.body.map((row) => row.libraryName), ['Older Hall']);
  const contacted = await call('GET', '/api/admin/demo-requests?status=CONTACTED', { token: ctx.tokens.sa });
  assert.equal(contacted.body.length, 1);
  assert.equal(contacted.body[0].libraryName, 'Newer Hall');

  const missing = await call('PATCH', '/api/admin/demo-requests/000000000000000000000000', {
    token: ctx.tokens.sa,
    body: { status: 'CLOSED' },
  });
  assert.equal(missing.status, 404);
  const bad = await call('PATCH', `/api/admin/demo-requests/${id}`, { token: ctx.tokens.sa, body: { status: 'MAYBE' } });
  assert.equal(bad.status, 400);
});

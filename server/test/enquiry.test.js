// Public enquiry form: validation, honeypot, rate limit, dedupe, tenant isolation, lock.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { Library } from '../src/models.js';
import { Enquiry } from '../src/enquiry.js';
import { resetRateLimits } from '../src/accounts.js';

before(async () => {
  await setup('enquiry');
  process.env.FRONTEND_URL = 'https://app.example.test';
  for (const [token, id, name] of [[ctx.tokens.a, 's1', 'Morning'], [ctx.tokens.b, 's2', 'Evening']]) {
    assert.equal((await call('POST', '/api/shifts', { token, body: { id, name } })).status, 201);
    assert.equal((await call('POST', '/api/plans', { token, body: { id: `p-${id}`, name: `${name} Plan`, price: 999 } })).status, 201);
  }
  await call('PUT', '/api/settings', { token: ctx.tokens.a, body: { logo: 'LOGO-A' } });
});
after(async () => { delete process.env.FRONTEND_URL; await teardown(); });
beforeEach(() => resetRateLimits());

const linkOf = async (token) => (await call('GET', '/api/enquiries/link', { token })).body;

test('public form returns names only and accepts a valid enquiry', async () => {
  const link = await linkOf(ctx.tokens.a);
  assert.match(link.token, /^[A-Za-z0-9_-]{16,}$/);
  assert.equal(link.url, `https://app.example.test/enquiry/${link.token}`);
  const pub = await call('GET', `/api/public/enquiry/${link.token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.libraryName, 'Library A');
  assert.equal(pub.body.logo, 'LOGO-A');
  assert.deepEqual(pub.body.shifts, ['Morning']);
  assert.deepEqual(pub.body.plans, ['Morning Plan']);
  assert.equal(pub.body.price, undefined);
  assert.equal(JSON.stringify(pub.body).includes('999'), false);

  const bad = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'A', mobile: '12345' } });
  assert.equal(bad.status, 400);
  const longMsg = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'A', mobile: '9876543210', message: 'x'.repeat(501) } });
  assert.equal(longMsg.status, 400);
  const badEmail = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'A', mobile: '9876543210', email: 'nope' } });
  assert.equal(badEmail.status, 400);

  const ok = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Riya', mobile: '+91 98765 43210', email: 'riya@example.com', preferred: 'Morning', message: 'Need a seat' },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const list = await call('GET', '/api/enquiries', { token: ctx.tokens.a });
  assert.equal(list.body.waitingCount, 1);
  assert.equal(list.body.items[0].name, 'Riya');
  assert.equal(list.body.items[0].mobile, '919876543210');
  assert.equal(list.body.items[0].status, 'waiting');
  assert.equal(list.body.items[0].source, 'qr');
  const count = await call('GET', '/api/enquiries/count', { token: ctx.tokens.a });
  assert.equal(count.body.waiting, 1);
});

test('honeypot is discarded and the same mobile within 24h updates', async () => {
  const link = await linkOf(ctx.tokens.a);
  const before = await Enquiry.countDocuments({ tenantId: 'lib-a' });
  const honey = await call('POST', `/api/public/enquiry/${link.token}`, {
    body: { name: 'Bot', mobile: '9876543211', website: 'http://spam.test', message: 'buy now' },
  });
  assert.equal(honey.status, 200);
  assert.equal(await Enquiry.countDocuments({ tenantId: 'lib-a' }), before);

  const first = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'Aman', mobile: '9123456780', message: 'Hi' } });
  assert.equal(first.status, 201);
  const second = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'Aman Kumar', mobile: '09123456780', message: 'Updated' } });
  assert.equal(second.status, 200);
  const rows = await Enquiry.find({ tenantId: 'lib-a', mobile: '919123456780' }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Aman Kumar');
  assert.equal(rows[0].message, 'Updated');
});

test('rate limit is per IP and token', async () => {
  const link = await linkOf(ctx.tokens.b);
  for (let i = 0; i < 5; i += 1) {
    const r = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: `N${i}`, mobile: `900000000${i}` } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const blocked = await call('POST', `/api/public/enquiry/${link.token}`, { body: { name: 'Too many', mobile: '9000000009' } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'rate_limited');
});

test('tenants cannot see each other; regenerate kills the old token', async () => {
  const a = await linkOf(ctx.tokens.a);
  const b = await linkOf(ctx.tokens.b);
  await call('POST', `/api/public/enquiry/${b.token}`, { body: { name: 'Only B', mobile: '9988776655' } });
  const listA = (await call('GET', '/api/enquiries', { token: ctx.tokens.a })).body.items.map(i => i.name);
  assert.equal(listA.includes('Only B'), false);
  const pubB = await call('GET', `/api/public/enquiry/${b.token}`);
  assert.equal(pubB.body.libraryName, 'Library B');
  assert.deepEqual(pubB.body.shifts, ['Evening']);

  const next = await call('POST', '/api/enquiries/link/regenerate', { token: ctx.tokens.b });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.token, b.token);
  assert.equal((await call('GET', `/api/public/enquiry/${b.token}`)).status, 404);
  assert.equal((await call('GET', `/api/public/enquiry/${next.body.token}`)).status, 200);

  const item = (await call('GET', '/api/enquiries', { token: ctx.tokens.b })).body.items.find(i => i.name === 'Only B');
  const patched = await call('PATCH', `/api/enquiries/${item.id}`, { token: ctx.tokens.b, body: { status: 'admitted' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.status, 'admitted');
  const other = await call('PATCH', `/api/enquiries/${item.id}`, { token: ctx.tokens.a, body: { status: 'removed' } });
  assert.equal(other.status, 404);
});

test('a locked library still accepts the public form; the owner list stays locked', async () => {
  const link = await linkOf(ctx.tokens.a);
  assert.ok(link.token);
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { subscription: { planId: 'x', status: 'expired', price: 1, interval: 'month', currentPeriodEnd: new Date(Date.now() - 864e5) } } });
  assert.equal((await call('GET', '/api/enquiries/link', { token: ctx.tokens.a })).status, 402);
  const token = link.token;
  const sent = await call('POST', `/api/public/enquiry/${token}`, { body: { name: 'After lock', mobile: '9811111111', message: 'Still here' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal((await call('GET', '/api/enquiries', { token: ctx.tokens.a })).status, 402);
  assert.equal((await call('GET', '/api/enquiries/count', { token: ctx.tokens.a })).status, 402);
  await Library.updateOne({ libraryId: 'lib-a' }, { $set: { 'subscription.status': 'active', 'subscription.currentPeriodEnd': new Date(Date.now() + 10 * 864e5) } });
  const list = await call('GET', '/api/enquiries', { token: ctx.tokens.a });
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some(i => i.name === 'After lock'));
});

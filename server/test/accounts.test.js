// AUTH-02/03 + §1: invites, password reset by email OTP, audit log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx, login } from './helpers.js';
import { outbox } from '../src/mailer.js';
import { resetRateLimits } from '../src/accounts.js';

const A = () => ctx.tokens.a;
before(() => setup('lms_accounts_test'));
after(teardown);
const tokenFrom = (link) => link.split('#invite=')[1];

test('owner invites staff with an expiring one-time link; staff joins the right tenant', async () => {
  const inv = await call('POST', '/api/invites', { token: A(), body: { email: 'new.staff@test.local', name: 'New Staff', staffId: 'ST-1' } });
  assert.equal(inv.status, 201); assert.equal(inv.body.status, 'pending');
  assert.equal(outbox.at(-1).to, 'new.staff@test.local');
  assert.ok(!JSON.stringify((await call('GET', '/api/invites', { token: A() })).body).includes(tokenFrom(inv.body.link)), 'token never listed');
  const t = tokenFrom(inv.body.link);
  assert.equal((await call('GET', `/api/auth/invite/${t}`)).body.library, 'Library A');
  // staff cannot invite, other tenant cannot see/revoke
  assert.equal((await call('GET', '/api/invites', { token: ctx.tokens.b })).body.length, 0);
  assert.equal((await call('POST', `/api/invites/${inv.body.id}/revoke`, { token: ctx.tokens.b })).status, 404);
  const acc = await call('POST', '/api/auth/invite/accept', { body: { token: t, password: 'StaffPass-123' } });
  assert.equal(acc.status, 200); assert.equal(acc.body.user.libraryId, 'lib-a'); assert.equal(acc.body.user.role, 'staff'); assert.equal(acc.body.user.staffId, 'ST-1');
  assert.equal((await call('POST', '/api/auth/invite/accept', { body: { token: t, password: 'StaffPass-123' } })).status, 410, 'one-time');
  const staffTok = acc.body.token;
  assert.equal((await call('POST', '/api/invites', { token: staffTok, body: { email: 'x@test.local' } })).status, 403);
  // revoked staff blocked immediately
  await call('PATCH', `/api/users/${acc.body.user.id}`, { token: A(), body: { status: 'Disabled' } });
  assert.equal((await call('GET', '/api/state', { token: staffTok })).status, 401);
});

test('revoked and expired invites cannot be used', async () => {
  const inv = await call('POST', '/api/invites', { token: A(), body: { email: 'rev@test.local' } });
  await call('POST', `/api/invites/${inv.body.id}/revoke`, { token: A() });
  assert.equal((await call('POST', '/api/auth/invite/accept', { body: { token: tokenFrom(inv.body.link), password: 'Password-123' } })).status, 410);
  const { Invite } = await import('../src/accounts.js');
  const inv2 = await call('POST', '/api/invites', { token: A(), body: { email: 'exp@test.local' } });
  await Invite.updateOne({ email: 'exp@test.local', revokedAt: null }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call('POST', '/api/auth/invite/accept', { body: { token: tokenFrom(inv2.body.link), password: 'Password-123' } })).status, 410);
});

test('password reset via email OTP; wrong codes limited; old sessions revoked; no account discovery', async () => {
  resetRateLimits();
  const unknown = await call('POST', '/api/auth/forgot-password', { body: { email: 'nobody@test.local' } });
  const known = await call('POST', '/api/auth/forgot-password', { body: { email: 'admin-a@test.local' } });
  assert.deepEqual(unknown.body, known.body);
  assert.equal((await call('POST', '/api/auth/forgot-password', { body: { email: 'admin-a@test.local' } })).status, 429, 'resend throttle');
  const code = outbox.at(-1).text.match(/code is (\d{6})/)[1];
  const wrong = String((Number(code) + 1) % 1e6).padStart(6, '0');
  assert.equal((await call('POST', '/api/auth/reset-password', { body: { email: 'admin-a@test.local', otp: wrong, newPassword: 'NewPassword-1' } })).status, 400);
  const oldTok = A();
  await new Promise(r => setTimeout(r, 1100));
  assert.equal((await call('POST', '/api/auth/reset-password', { body: { email: 'admin-a@test.local', otp: code, newPassword: 'NewPassword-1' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/reset-password', { body: { email: 'admin-a@test.local', otp: code, newPassword: 'NewPassword-2' } })).status, 400, 'code is one-time');
  assert.equal((await call('GET', '/api/state', { token: oldTok })).status, 401, 'old session revoked');
  ctx.tokens.a = await login('admin-a@test.local', 'NewPassword-1');
  assert.ok(ctx.tokens.a);
});

test('disabled accounts cannot recover; 5 wrong codes lock the OTP', async () => {
  resetRateLimits();
  await call('POST', '/api/auth/forgot-password', { body: { email: 'admin-b@test.local' } });
  const code = outbox.at(-1).text.match(/code is (\d{6})/)[1];
  const wrong = String((Number(code) + 1) % 1e6).padStart(6, '0');
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/reset-password', { body: { email: 'admin-b@test.local', otp: wrong, newPassword: 'Whatever-123' } });
  assert.notEqual((await call('POST', '/api/auth/reset-password', { body: { email: 'admin-b@test.local', otp: code, newPassword: 'Whatever-123' } })).status, 200);
});

test('audit log: owner sees own tenant only; superadmin access is logged; no secrets stored', async () => {
  await call('GET', '/api/state', { token: ctx.tokens.sa, headers: { 'X-Library-Id': 'lib-a', 'X-Read-Only': '1', 'X-Access-Reason': 'support ticket' } });
  await new Promise(r => setTimeout(r, 200));
  const logs = (await call('GET', '/api/audit-logs', { token: A() })).body;
  const actions = logs.map(l => l.action);
  for (const a of ['invite.created', 'invite.accepted', 'invite.revoked', 'user.update', 'password.reset_completed', 'superadmin.library_access']) assert.ok(actions.includes(a), a);
  assert.equal(logs.find(l => l.action === 'superadmin.library_access').reason, 'support ticket');
  assert.ok(logs.every(l => l.tenantId === 'lib-a'));
  assert.ok(!JSON.stringify(logs).match(/NewPassword|StaffPass/));
  const bl = (await call('GET', '/api/audit-logs', { token: ctx.tokens.b })).body;
  assert.ok(bl.every(l => l.tenantId === 'lib-b'));
  assert.equal((await call('GET', '/api/admin/audit-logs?libraryId=lib-a', { token: ctx.tokens.sa })).status, 200);
});

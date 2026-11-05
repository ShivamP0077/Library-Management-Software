import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, login, ctx } from './helpers.js';

before(() => setup('chpw'));
after(teardown);

test('change password: validation, wrong current, success, old stops working', async () => {
  const t = ctx.tokens.a;
  assert.equal((await call('POST', '/api/auth/change-password', { token: t, body: { currentPassword: 'Password-a-123', newPassword: 'short' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/change-password', { token: t, body: { currentPassword: 'wrong', newPassword: 'NewPassword-1' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/change-password', { token: t, body: { currentPassword: 'Password-a-123', newPassword: 'Password-a-123' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/change-password', { token: t, body: { currentPassword: 'Password-a-123', newPassword: 'NewPassword-1' } })).status, 200);
  assert.equal(await login('admin-a@test.local', 'Password-a-123'), undefined);
  assert.ok(await login('admin-a@test.local', 'NewPassword-1'));
});

test('change password: no password set without auth', async () => {
  assert.equal((await call('POST', '/api/auth/change-password', { body: { currentPassword: 'x', newPassword: 'NewPassword-1' } })).status, 401);
});

test('change password: 5 wrong tries then 429', async () => {
  const t = ctx.tokens.b;
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/auth/change-password', { token: t, body: { currentPassword: 'bad', newPassword: 'NewPassword-2' } })).status, 400);
  assert.equal((await call('POST', '/api/auth/change-password', { token: t, body: { currentPassword: 'Password-b-123', newPassword: 'NewPassword-2' } })).status, 429);
});

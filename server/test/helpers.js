// Shared harness: in-memory MongoDB, app server, and two tenants (lib-a, lib-b).
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { ensureSuperAdmin } from '../src/seed.js';

export const SA = { email: 'super@test.local', password: 'SuperSecret#123' };
export const ctx = { base: null, tokens: {}, server: null, mongod: null };

export const call = async (method, path, { token, body, headers = {} } = {}) => {
  const res = await fetch(ctx.base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers };
};
export const login = async (email, password) => (await call('POST', '/api/auth/login', { body: { email, password } })).body?.token;

export async function setup(dbName) {
  process.env.JWT_SECRET = 'test-secret';
  ctx.mongod = await MongoMemoryServer.create();
  await mongoose.connect(ctx.mongod.getUri(), { dbName });
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
  await ensureSuperAdmin({ SUPERADMIN_EMAIL: SA.email, SUPERADMIN_PASSWORD: SA.password });
  ctx.server = createApp().listen(0);
  ctx.base = `http://127.0.0.1:${ctx.server.address().port}`;
  ctx.tokens.sa = await login(SA.email, SA.password);
  for (const k of ['a', 'b']) {
    const r = await call('POST', '/api/admin/libraries', { token: ctx.tokens.sa, body: { name: `Library ${k.toUpperCase()}`, libraryId: `lib-${k}`, adminEmail: `admin-${k}@test.local`, adminPassword: `Password-${k}-123` } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ctx.tokens[k] = await login(`admin-${k}@test.local`, `Password-${k}-123`);
  }
  return ctx;
}

export async function teardown() {
  ctx.server?.close();
  await mongoose.disconnect();
  await ctx.mongod?.stop();
}

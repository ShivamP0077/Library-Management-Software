// OPS-01: backup → wipe → restore rehearsal; wrong key rejected; retention pruning.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import mongoose from 'mongoose';
import { setup, teardown, call, ctx } from './helpers.js';
import { createBackup, restoreBackup, readBackup, prune } from '../src/backup.js';

const KEY = 'test-backup-key-0123456789abcdef-XYZ';
before(async () => {
  await setup('lms_backup_test');
  await call('PUT', '/api/students', { token: ctx.tokens.a, body: [{ id: 'S1', name: 'Asha', phone: '9000000001', status: 'Active' }] });
});
after(teardown);

test('restore rehearsal: backup, wipe, restore, data and login are back', async () => {
  const db = mongoose.connection.db;
  const { buffer, counts } = await createBackup(db, KEY);
  assert.ok(counts.users >= 3);
  assert.ok(!buffer.toString('latin1').includes('Asha'), 'file is encrypted');
  assert.throws(() => readBackup(buffer, KEY + 'wrong'), /Wrong BACKUP_KEY/);
  await db.collection('students').deleteMany({});
  await db.collection('users').deleteMany({});
  const r = await restoreBackup(db, buffer, KEY);
  assert.equal(r.restored.users, counts.users);
  const list = (await call('GET', '/api/students', { token: ctx.tokens.a })).body;
  assert.equal(list.find(s => s.id === 'S1')?.name, 'Asha');
  const login = await call('POST', '/api/auth/login', { body: { email: 'admin-a@test.local', password: 'Password-a-123' } });
  assert.equal(login.status, 200);
});

test('retention keeps the newest N files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) fs.writeFileSync(path.join(dir, `library-os-${d}.bak`), 'x');
  assert.deepEqual(prune(dir, 2), ['library-os-2026-01-01.bak']);
  assert.equal(fs.readdirSync(dir).length, 2);
});

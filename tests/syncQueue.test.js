import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncQueue, LOCKED_CONFIG_COLLECTIONS, SYNCED_COLLECTIONS } from '../src/utils/syncQueue.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 20));

test('createSyncQueue ignores push and queue until the key was loaded', async () => {
  const writes = [];
  const q = createSyncQueue({
    delay: 0,
    write: async (key, value) => { writes.push([key, value]); },
  });
  q.enable();
  await q.push('branches', []);
  await q.push('students', [{ id: 's1' }]);
  q.queue('plans', [{ id: 'p1' }]);
  q.queue('settings', { name: 'Local only' });
  await tick();
  assert.deepEqual(writes, []);
  assert.equal(q.isLoaded('branches'), false);

  q.markSynced('branches', [{ id: 'b1', name: 'Main' }]);
  await q.push('branches', [{ id: 'b1', name: 'Main' }]);
  assert.deepEqual(writes, [], 'identical server snapshot is not written again');
  await q.push('branches', [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Annex' }]);
  assert.deepEqual(writes, [['branches', [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Annex' }]]]);

  q.markLoaded('settings');
  await q.push('settings', { name: 'Seeded' });
  assert.deepEqual(writes[1], ['settings', { name: 'Seeded' }]);
});

test('createSyncQueue never pushes blocked keys, even after markSynced', async () => {
  const writes = [];
  const q = createSyncQueue({
    delay: 0,
    write: async (key, value) => { writes.push(key); },
  });
  const blocked = SYNCED_COLLECTIONS.filter(col => !LOCKED_CONFIG_COLLECTIONS.includes(col));
  assert.ok(blocked.includes('students'));
  assert.ok(blocked.includes('payments'));
  assert.ok(blocked.includes('seats'));
  assert.ok(!blocked.includes('branches'));
  q.block(blocked);
  q.enable();
  for (const key of blocked) {
    q.markSynced(key, [{ id: 'keep' }]);
    await q.push(key, []);
    q.queue(key, []);
  }
  q.markSynced('plans', [{ id: 'p1' }]);
  await q.push('plans', []);
  await tick();
  assert.deepEqual(writes, ['plans']);
});

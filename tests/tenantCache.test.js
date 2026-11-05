import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setStorage, setCacheScope, clearCacheScope, scopedStorage, canSeedServer,
  scopedDocKey, legacyDocAllowed, LEGACY_OWNER_KEY, getCacheScope,
} from '../src/utils/tenantCache.js';

/** In-memory stand-in for window.localStorage (one browser shared by two libraries). */
const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()],
    raw: m,
  };
};

/**
 * Mirrors LibraryProvider's first load: read cache, then if the server is empty
 * either upload (only when canSeedServer) or start clean. Returns what was uploaded.
 */
const mountWorkspace = (server, tenantId, { readOnly = false } = {}) => {
  setCacheScope({ tenantId, readOnly });
  const local = JSON.parse(scopedStorage.getItem('library_students') || '[]');
  const uploaded = [];
  let shown = local;
  const remote = server[tenantId] || [];
  if (remote.length) shown = remote;
  else if (!readOnly && canSeedServer()) { server[tenantId] = local; uploaded.push(...local); shown = local; }
  else if (!readOnly) shown = [];
  scopedStorage.setItem('library_students', JSON.stringify(shown)); // provider persists state
  return { shown, uploaded };
};

let ls;
beforeEach(() => { ls = fakeStorage(); __setStorage(ls); clearCacheScope(); });

test('keys are namespaced per library', () => {
  setCacheScope({ tenantId: 'lib-a' });
  scopedStorage.setItem('library_students', '[1]');
  assert.equal(ls.getItem('t:lib-a:library_students'), '[1]');
  assert.equal(ls.getItem('library_students'), null);
  setCacheScope({ tenantId: 'lib-b' });
  assert.equal(scopedStorage.getItem('library_students'), null);
});

test('switch A -> B: B shows nothing of A and B\'s empty server never receives A\'s data', () => {
  const server = { 'lib-a': [{ id: 'A1', name: 'Asha (Blue Lagoon)' }] };
  const a = mountWorkspace(server, 'lib-a');
  assert.deepEqual(a.shown.map(s => s.id), ['A1']);
  const b = mountWorkspace(server, 'lib-b');
  assert.deepEqual(b.shown, []);
  assert.deepEqual(b.uploaded, []);
  assert.equal(server['lib-b'], undefined);
});

test('A\'s cache is still intact after switching back', () => {
  const server = { 'lib-a': [{ id: 'A1' }] };
  mountWorkspace(server, 'lib-a');
  mountWorkspace(server, 'lib-b');
  setCacheScope({ tenantId: 'lib-a' });
  assert.deepEqual(JSON.parse(scopedStorage.getItem('library_students')), [{ id: 'A1' }]);
});

test('same library: its own cache may seed its own empty server (offline-first kept)', () => {
  setCacheScope({ tenantId: 'lib-a' });
  scopedStorage.setItem('library_students', JSON.stringify([{ id: 'A1' }]));
  const server = {};
  const r = mountWorkspace(server, 'lib-a');
  assert.deepEqual(r.uploaded.map(s => s.id), ['A1']);
});

test('legacy keys move only into the library the old marker proves owns them', () => {
  ls.setItem('library_students', JSON.stringify([{ id: 'OLD' }]));
  ls.setItem(LEGACY_OWNER_KEY, 'lib-a');
  setCacheScope({ tenantId: 'lib-b' });
  assert.equal(scopedStorage.getItem('library_students'), null, 'never loaded into another library');
  setCacheScope({ tenantId: 'lib-a' });
  assert.deepEqual(JSON.parse(scopedStorage.getItem('library_students')), [{ id: 'OLD' }]);
  assert.ok(ls.getItem('library_students'), 'legacy key is not deleted');
});

test('migrated legacy data is never auto-uploaded to an empty server', () => {
  ls.setItem('library_students', JSON.stringify([{ id: 'OLD' }]));
  ls.setItem(LEGACY_OWNER_KEY, 'lib-a');
  const server = {};
  const r = mountWorkspace(server, 'lib-a');
  assert.deepEqual(r.uploaded, []);
  assert.equal(server['lib-a'], undefined);
  // still not on a later visit
  assert.deepEqual(mountWorkspace(server, 'lib-a').uploaded, []);
});

test('legacy marker with ":ro" suffix or another id migrates nothing', () => {
  ls.setItem('library_students', '[1]');
  ls.setItem(LEGACY_OWNER_KEY, 'lib-a:ro');
  setCacheScope({ tenantId: 'lib-a' });
  assert.equal(scopedStorage.getItem('library_students'), null);
});

test('super-admin read-only drill-in never reads or writes browser cache', () => {
  setCacheScope({ tenantId: 'lib-a' });
  scopedStorage.setItem('library_students', '["mine"]');
  const before = [...ls.raw.entries()];
  const server = { 'lib-a': [{ id: 'A1' }] };
  setCacheScope({ tenantId: 'lib-a', readOnly: true });
  assert.equal(scopedStorage.getItem('library_students'), null);
  mountWorkspace(server, 'lib-a', { readOnly: true });
  assert.deepEqual([...ls.raw.entries()], before);
  assert.equal(canSeedServer(), false);
});

test('read-only drill-in into an empty library uploads nothing', () => {
  const server = {};
  assert.deepEqual(mountWorkspace(server, 'lib-x', { readOnly: true }).uploaded, []);
  assert.equal(server['lib-x'], undefined);
});

test('offline mode keeps the original unprefixed cache', () => {
  ls.setItem('library_students', '["offline"]');
  setCacheScope({ offline: true });
  assert.equal(scopedStorage.getItem('library_students'), '["offline"]');
  scopedStorage.setItem('library_plans', '[]');
  assert.equal(ls.getItem('library_plans'), '[]');
  assert.equal(canSeedServer(), false);
});

test('signed out: memory only, nothing persisted', () => {
  clearCacheScope();
  scopedStorage.setItem('library_students', '[1]');
  assert.deepEqual(ls.keys(), []);
  assert.equal(getCacheScope().mode, 'none');
});

test('IndexedDB document keys are per library', () => {
  setCacheScope({ tenantId: 'lib-a' });
  assert.equal(scopedDocKey('doc1'), 't:lib-a:doc1');
  assert.equal(legacyDocAllowed(), false);
  ls.setItem(LEGACY_OWNER_KEY, 'lib-a');
  assert.equal(legacyDocAllowed(), true);
  setCacheScope({ offline: true });
  assert.equal(scopedDocKey('doc1'), 'doc1');
});

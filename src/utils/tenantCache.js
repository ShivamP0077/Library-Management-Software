/**
 * Tenant-scoped browser cache (Issue #2: cross-library data leak).
 *
 * Every library gets its own localStorage namespace: `t:<tenantId>:<key>`.
 * Modes:
 * - 'tenant'   : a signed-in library. Keys are prefixed with the tenant id.
 * - 'readonly' : super-admin / partner read-only drill-in. Memory only: it never
 *                reads or writes anyone's browser cache.
 * - 'legacy'   : offline (local) mode. Uses the old unprefixed keys, unchanged.
 * - 'none'     : signed out / not chosen yet. Memory only.
 *
 * Old unprefixed keys are never deleted. They are copied into a tenant's
 * namespace only when the old owner marker proves they belong to that tenant.
 */
export const LEGACY_OWNER_KEY = 'library_cache_owner';
export const CACHE_KEYS = [
  'library_settings', 'library_branches', 'library_sections', 'library_seat_types', 'library_seats',
  'library_shifts', 'library_plans', 'library_staff', 'library_students', 'library_archived_students',
  'library_expenses', 'library_payments', 'library_waiting_list', 'wizardDraft',
];
const TAG = '__tenant';
const MIGRATED = '__migrated_legacy';

let storageOverride = null;
const storage = () => storageOverride || globalThis.localStorage;
/** Tests only: swap in a fake localStorage. */
export const __setStorage = (s) => { storageOverride = s; };

let scope = { mode: 'none', tenantId: null, canSeed: false };
let memory = new Map();

export const prefixFor = (tenantId) => `t:${tenantId}:`;
const rawGet = (k) => { try { return storage().getItem(k); } catch { return null; } };
const rawSet = (k, v) => { try { storage().setItem(k, v); } catch (e) { console.warn(`[STORAGE] Could not persist key "${k}":`, e); } };

function hasTenantData(tenantId) {
  const p = prefixFor(tenantId);
  return CACHE_KEYS.some(k => rawGet(p + k) !== null);
}

/** Copies old unprefixed keys into this tenant, only if the old owner marker is exactly this tenant. */
export function migrateLegacyCache(tenantId) {
  const p = prefixFor(tenantId);
  if (rawGet(p + MIGRATED)) return 0;
  if (rawGet(LEGACY_OWNER_KEY) !== String(tenantId)) return 0;
  let copied = 0;
  for (const k of CACHE_KEYS) {
    const v = rawGet(k);
    if (v !== null && rawGet(p + k) === null) { rawSet(p + k, v); copied++; }
  }
  rawSet(p + MIGRATED, new Date().toISOString());
  return copied;
}

/**
 * Chooses the cache for the workspace about to mount.
 * { tenantId, readOnly, offline } — call before LibraryProvider mounts.
 */
export function setCacheScope({ tenantId = null, readOnly = false, offline = false } = {}) {
  memory = new Map();
  if (offline) { scope = { mode: 'legacy', tenantId: null, canSeed: false }; return scope; }
  if (!tenantId) { scope = { mode: 'none', tenantId: null, canSeed: false }; return scope; }
  if (readOnly) { scope = { mode: 'readonly', tenantId: String(tenantId), canSeed: false }; return scope; }
  const id = String(tenantId);
  // Only data this tenant wrote itself (tagged, from before this mount) may seed an empty server.
  // Migrated legacy data is never pushed automatically.
  const canSeed = rawGet(prefixFor(id) + TAG) === id && !rawGet(prefixFor(id) + MIGRATED + ':only') && hasTenantData(id);
  const copied = migrateLegacyCache(id);
  if (copied && !canSeed) rawSet(prefixFor(id) + MIGRATED + ':only', '1');
  scope = { mode: 'tenant', tenantId: id, canSeed };
  return scope;
}

/** Signed out: nothing is read from or written to any library's cache. */
export const clearCacheScope = () => setCacheScope({});
export const getCacheScope = () => ({ ...scope });
/** True only when the cache was written by this same tenant (safe to upload to its empty server). */
export const canSeedServer = () => scope.mode === 'tenant' && scope.canSeed === true;

const keyFor = (k) => prefixFor(scope.tenantId) + k;

/** Drop-in for `localStorage` inside the library workspace. */
export const scopedStorage = {
  getItem(k) {
    if (scope.mode === 'legacy') return rawGet(k);
    if (scope.mode === 'tenant') return rawGet(keyFor(k));
    return memory.has(k) ? memory.get(k) : null;
  },
  setItem(k, v) {
    const s = String(v);
    if (scope.mode === 'legacy') return rawSet(k, s);
    if (scope.mode === 'tenant') {
      rawSet(keyFor(k), s);
      if (rawGet(keyFor(TAG)) !== scope.tenantId) rawSet(keyFor(TAG), scope.tenantId);
      return;
    }
    memory.set(k, s);
  },
  removeItem(k) {
    if (scope.mode === 'legacy') { try { storage().removeItem(k); } catch { /* ignore */ } return; }
    if (scope.mode === 'tenant') { try { storage().removeItem(keyFor(k)); } catch { /* ignore */ } return; }
    memory.delete(k);
  },
};

/** IndexedDB document key for the current scope (legacy/offline keeps the old key). */
export const scopedDocKey = (key) => (scope.mode === 'tenant' || scope.mode === 'readonly') ? prefixFor(scope.tenantId) + key : key;
/** Whether the old unprefixed IndexedDB entry may be read for this tenant. */
export const legacyDocAllowed = () => scope.mode === 'legacy' || (scope.mode === 'tenant' && rawGet(LEGACY_OWNER_KEY) === scope.tenantId);
export const isMemoryOnly = () => scope.mode === 'readonly' || scope.mode === 'none';

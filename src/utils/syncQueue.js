/** Collections persisted by LibraryContext, mapped to backend collection names. */
export const SYNCED_COLLECTIONS = [
  'branches', 'sections', 'seatTypes', 'seats', 'shifts', 'plans', 'staffMembers',
  'students', 'archivedStudents', 'expenses', 'payments', 'waitingList'
];

/**
 * Config a locked library may still read and write.
 * Students, seats, staff, payments and the seat waiting list stay unloaded so they are never pushed.
 */
export const LOCKED_CONFIG_COLLECTIONS = ['branches', 'sections', 'shifts', 'seatTypes', 'plans'];

/**
 * Debounced, change-detecting sync of one piece of state to the backend.
 * Only runs once the initial load from the backend has completed (enable()).
 * A key is pushed only after it was loaded from the server in this session (`markSynced` or `markLoaded`).
 * `block(keys)` refuses those keys even if they were marked loaded (locked students, payments, seats, …).
 * `write` performs the HTTP call. Tests pass their own; api.js supplies the real one.
 */
export function createSyncQueue({ delay = 400, onError, write } = {}) {
  const last = new Map();
  const loaded = new Set();
  const timers = new Map();
  let blocked = new Set();
  let enabled = false;
  const allowed = (key) => loaded.has(key) && !blocked.has(key);
  const clearTimer = (key) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
  };
  const push = async (key, value) => {
    if (!allowed(key)) return;
    const json = JSON.stringify(value);
    if (last.get(key) === json) return;
    try {
      await write?.(key, value);
      last.set(key, json);
    } catch (e) {
      onError?.(key, e);
    }
  };
  return {
    enable: () => { enabled = true; },
    disable: () => { enabled = false; },
    isEnabled: () => enabled,
    isLoaded: (key) => loaded.has(key),
    markSynced(key, value) {
      loaded.add(key);
      last.set(key, JSON.stringify(value));
    },
    /** Allow a push of a key the server confirmed (including the empty-remote seed upload). */
    markLoaded(key) { loaded.add(key); },
    block(keys) {
      blocked = new Set(keys || []);
      for (const key of blocked) clearTimer(key);
    },
    push,
    queue(key, value) {
      if (!enabled || !allowed(key)) {
        clearTimer(key);
        return;
      }
      clearTimer(key);
      timers.set(key, setTimeout(() => push(key, value), delay));
    },
  };
}

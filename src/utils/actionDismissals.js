// Dashboard "Action required" Skip / Later.
// An occurrence is type + entity + the due/expiry (or other marker) so a new period shows again.
import { addDays } from './billingCycle.js';

export const MAX_SKIPS = 500;
export const MAX_SNOOZES = 500;
export const MAX_DISMISSAL_INPUT = 2000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isoIn = (text) => {
  const m = String(text || '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
};

export function occurrenceKey(item = {}) {
  const type = String(item.type || item.category || 'item').replace(/[^\w.-]/g, '').slice(0, 40) || 'item';
  const params = item.link?.params && typeof item.link.params === 'object' ? item.link.params : {};
  const entity = String(
    item.entityId || params.student || params['expense-instance'] || item.recordId || item.id || 'none',
  ).slice(0, 80);
  const marker = String(item.occurrence || item.expiryDate || item.dueDate || isoIn(item.body) || isoIn(item.title) || '').slice(0, 40);
  return `${type}|${entity}|${marker}`;
}

export function nextLocalDay(today) {
  return addDays(String(today || '').slice(0, 10), 1);
}

export function dismissalStorageKey(libraryId) {
  return `lms.actionDismissals.${libraryId || 'local'}`;
}

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function cleanKey(key) {
  const k = String(key || '').trim();
  if (!k || k.length > 180) return '';
  if (/[\u0000-\u001f]/.test(k)) return '';
  return k;
}

/** Drop past snoozes and cap skips. Lenient: bad rows are ignored. */
export function normalizeDismissals(raw, today) {
  const day = String(today || '').slice(0, 10);
  const snoozeMap = new Map();
  for (const row of Array.isArray(raw?.snoozes) ? raw.snoozes : []) {
    const key = cleanKey(row?.key);
    const until = String(row?.until || '').slice(0, 10);
    if (!key || !ISO_DAY.test(until) || !(until > day)) continue;
    snoozeMap.set(key, { key, until });
  }
  const skipMap = new Map();
  for (const row of Array.isArray(raw?.skips) ? raw.skips : []) {
    const key = cleanKey(row?.key);
    if (!key) continue;
    const at = String(row?.at || '').slice(0, 10);
    skipMap.set(key, { key, ...(ISO_DAY.test(at) ? { at } : {}) });
  }
  for (const key of skipMap.keys()) snoozeMap.delete(key);
  return {
    snoozes: [...snoozeMap.values()].slice(-MAX_SNOOZES),
    skips: [...skipMap.values()].slice(-MAX_SKIPS),
  };
}

/** PUT body. Rejects malformed input; still prunes past snoozes and caps skips. */
export function validateDismissals(body, today) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Dismissals must be an object');
  const snoozes = body.snoozes == null ? [] : body.snoozes;
  const skips = body.skips == null ? [] : body.skips;
  if (!Array.isArray(snoozes) || !Array.isArray(skips)) throw bad('snoozes and skips must be arrays');
  if (snoozes.length > MAX_DISMISSAL_INPUT || skips.length > MAX_DISMISSAL_INPUT) throw bad('Too many dismissals');
  const day = String(today || '').slice(0, 10);
  for (const row of snoozes) {
    if (!row || typeof row !== 'object') throw bad('Invalid snooze');
    if (!cleanKey(row.key)) throw bad('Invalid snooze key');
    if (!ISO_DAY.test(String(row.until || '').slice(0, 10))) throw bad('Snooze until must be YYYY-MM-DD');
  }
  for (const row of skips) {
    if (!row || typeof row !== 'object') throw bad('Invalid skip');
    if (!cleanKey(row.key)) throw bad('Invalid skip key');
    if (row.at != null && row.at !== '' && !ISO_DAY.test(String(row.at).slice(0, 10))) throw bad('Skip date must be YYYY-MM-DD');
  }
  return normalizeDismissals({
    snoozes: snoozes.map(row => ({ key: cleanKey(row.key), until: String(row.until).slice(0, 10) })),
    skips: skips.map(row => ({ key: cleanKey(row.key), at: row.at ? String(row.at).slice(0, 10) : day })),
  }, day);
}

export function snoozeItem(dismissals, item, today) {
  const key = occurrenceKey(item);
  return normalizeDismissals({
    snoozes: [...(dismissals?.snoozes || []).filter(s => s.key !== key), { key, until: nextLocalDay(today) }],
    skips: dismissals?.skips || [],
  }, today);
}

export function skipItem(dismissals, item, today) {
  const key = occurrenceKey(item);
  return normalizeDismissals({
    snoozes: (dismissals?.snoozes || []).filter(s => s.key !== key),
    skips: [...(dismissals?.skips || []).filter(s => s.key !== key), { key, at: String(today || '').slice(0, 10) }],
  }, today);
}

export function restoreItem(dismissals, item, today) {
  const key = occurrenceKey(item);
  return normalizeDismissals({
    snoozes: (dismissals?.snoozes || []).filter(s => s.key !== key),
    skips: (dismissals?.skips || []).filter(s => s.key !== key),
  }, today);
}

/** Split open items into what the dashboard should show and what Skip/Later hid. */
export function partitionActions(items, dismissals, today) {
  const stored = normalizeDismissals(dismissals, today);
  const skipped = new Set(stored.skips.map(s => s.key));
  const until = new Map(stored.snoozes.map(s => [s.key, s.until]));
  const day = String(today || '').slice(0, 10);
  const shown = [];
  const hidden = [];
  for (const item of items || []) {
    const key = occurrenceKey(item);
    const snooze = until.get(key);
    if (skipped.has(key) || (snooze && snooze > day)) hidden.push(item);
    else shown.push(item);
  }
  return { shown, hidden, dismissals: stored };
}

/** Pure helpers for the expired-plan lock and the Subscription page. */

export const LOCKED_SECTIONS = ['dashboard', 'settings', 'profile'];

const HISTORY_LABELS = {
  trial: 'Trial',
  new: 'New',
  renew: 'Renewal',
  renewal: 'Renewal',
  early_renew: 'Early renewal',
  early_renewal: 'Early renewal',
  upgrade: 'Upgrade',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

/** Tabs that stay usable while the library plan is locked. */
export function isSectionAllowedWhenLocked(tab) {
  return LOCKED_SECTIONS.includes(String(tab || '').trim().toLowerCase());
}

/** Owner and staff lock. Super Admin drill-in never locks. Missing access stays open. */
export function isLibraryLocked(access, user) {
  if (user?.role === 'superadmin') return false;
  if (!access) return false;
  return access.locked === true || access.ok === false;
}

export function isSubscriptionLockError(error) {
  return Boolean(error && (error.status === 402 || error.code === 'SUBSCRIPTION_LOCKED'));
}

/** Invoice history type → the label shown on the Subscription page. */
export function historyTypeLabel(type) {
  return HISTORY_LABELS[String(type || '').toLowerCase()] || 'New';
}

/** Whole days until `date`, or 0 when the date is missing or already past. */
export function daysLeftUntil(date, now = new Date()) {
  if (!date) return 0;
  const end = new Date(date).getTime();
  const start = new Date(now).getTime();
  if (Number.isNaN(end) || Number.isNaN(start) || end <= start) return 0;
  return Math.ceil((end - start) / DAY_MS);
}

/** Calendar date as DD MMM YYYY in the local timezone. */
export function formatPlanDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function statusPillLabel(status) {
  if (status === 'trial') return 'Trial';
  if (status === 'active') return 'Active';
  if (status === 'expired') return 'Expired';
  return status ? String(status) : 'No plan';
}

export function cycleLabel(interval) {
  if (interval === 'year') return 'year';
  return 'month';
}

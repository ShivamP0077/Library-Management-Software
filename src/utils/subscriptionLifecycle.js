/**
 * One subscription lifecycle for occupy, lists, and auto-cancel.
 * Dates are calendar days (YYYY-MM-DD) in the app timezone. Callers pass "today".
 * Grace days and expired-period days come from the student snapshot, then library
 * settings. A missing expired-period setting uses DEFAULT_EXPIRED_PERIOD_DAYS only
 * while the value is being resolved — comparisons use the resolved dates.
 */
import { addDays } from './billingCycle.js';

/** Default grace for a library that does not exist yet. Existing libraries keep their saved value. */
export const NEW_LIBRARY_GRACE_DAYS = 5;
/** Used only when a library has no expiredPeriodDays yet (new library, or the field's first read). */
export const DEFAULT_EXPIRED_PERIOD_DAYS = 25;

const day = (value) => {
  const v = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
};

const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

const num = (value) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Library values copied onto a student when a period starts (admission or renewal). */
export function periodSnapshots(settings = {}, student = {}) {
  const custom = num(student.customGraceDays);
  const grace = custom != null ? custom : (num(settings.gracePeriodDays) ?? 0);
  const expired = num(settings.expiredPeriodDays) ?? DEFAULT_EXPIRED_PERIOD_DAYS;
  return { graceDaysSnapshot: grace, expiredPeriodDaysSnapshot: expired };
}

/**
 * Stamp snapshots onto a new admission or a renewal (expiry moved forward).
 * Other saves keep the snapshots already stored.
 */
export function stampPeriodSnapshots(student, prev, settings) {
  if (!student) return student;
  const exp = day(student.expiryDate || student.endDate);
  const prevExp = day(prev?.expiryDate || prev?.endDate);
  const fresh = !prev;
  const renewing = Boolean(prev && exp && prevExp && exp > prevExp);
  if (!fresh && !renewing) {
    if (student.graceDaysSnapshot == null && prev?.graceDaysSnapshot != null) student.graceDaysSnapshot = prev.graceDaysSnapshot;
    if (student.expiredPeriodDaysSnapshot == null && prev?.expiredPeriodDaysSnapshot != null) student.expiredPeriodDaysSnapshot = prev.expiredPeriodDaysSnapshot;
    return student;
  }
  Object.assign(student, periodSnapshots(settings, student));
  return student;
}

function graceDaysOf(student, settings) {
  const custom = num(student.customGraceDays);
  if (custom != null) return custom;
  const snap = num(student.graceDaysSnapshot);
  if (snap != null) return snap;
  const lib = num(settings?.gracePeriodDays);
  return lib != null ? lib : 0;
}

function expiredPeriodDaysOf(student, settings) {
  const snap = num(student.expiredPeriodDaysSnapshot);
  if (snap != null) return snap;
  const lib = num(settings?.expiredPeriodDays);
  return lib != null ? lib : DEFAULT_EXPIRED_PERIOD_DAYS;
}

/**
 * @returns lifecycle status, whether the desk is held, and the period dates.
 */
export function subscriptionLifecycle(student, { settings = null, today = '', soonDays = 3 } = {}) {
  const stored = student?.status;
  const empty = {
    status: 'Active', label: 'Active', holdsDesk: false, expiringSoon: false,
    graceEndDate: '', firstExpiredDate: '', autoCancelDate: '',
    graceDays: 0, expiredPeriodDays: 0, daysRemaining: 0,
  };
  if (!student) return empty;
  if (stored === 'Archived') return { ...empty, status: 'Archived', label: 'Archived' };
  if (stored === 'Cancelled') return { ...empty, status: 'Cancelled', label: 'Cancelled' };

  const graceDays = graceDaysOf(student, settings);
  const expiredPeriodDays = expiredPeriodDaysOf(student, settings);
  const due = day(student.expiryDate || student.endDate);
  const extended = day(student.extendedDueDate);
  const effectiveDue = extended && due && extended > due ? extended : (due || extended);

  if (!effectiveDue) {
    const status = stored === 'Expired' ? 'Expired' : 'Active';
    return {
      ...empty, status, label: status, holdsDesk: status === 'Active',
      graceDays, expiredPeriodDays,
    };
  }

  const graceEndDate = addDays(effectiveDue, graceDays);
  const firstExpiredDate = addDays(graceEndDate, 1);
  const autoCancelDate = addDays(firstExpiredDate, expiredPeriodDays);
  const base = { graceEndDate, firstExpiredDate, autoCancelDate, graceDays, expiredPeriodDays };

  if (today && today <= effectiveDue) {
    const daysRemaining = daysBetween(today, effectiveDue);
    const expiringSoon = daysRemaining <= Number(soonDays ?? 3);
    return {
      ...base,
      status: 'Active',
      label: expiringSoon ? 'Active (expiring soon)' : 'Active',
      holdsDesk: true,
      expiringSoon,
      daysRemaining,
    };
  }

  if (today && today <= graceEndDate) {
    const daysRemaining = daysBetween(today, graceEndDate);
    return {
      ...base,
      status: 'Grace Period',
      label: `Grace (${daysRemaining}d left)`,
      holdsDesk: true,
      expiringSoon: false,
      daysRemaining,
    };
  }

  const overdueDays = today ? daysBetween(effectiveDue, today) : 0;
  return {
    ...base,
    status: 'Expired',
    label: overdueDays > 0 ? `Expired (${overdueDays}d ago)` : 'Expired',
    holdsDesk: false,
    expiringSoon: false,
    daysRemaining: -overdueDays,
  };
}

export function holdsDesk(student, settings, today) {
  return subscriptionLifecycle(student, { settings, today }).holdsDesk;
}

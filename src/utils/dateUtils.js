/**
 * Calendar-based Subscription and Billing Utilities
 *
 * Implements strict calendar month arithmetic (respecting 28/29/30/31 day months),
 * anniversary billing, grace period calculations, and custom due-date extensions.
 * Month steps use the same anchored helper as library billing cycles.
 */
import { addDays, addMonthsAnchored, cycleConfig, cycleFor } from './billingCycle.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in Asia/Kolkata, as YYYY-MM-DD. */
export function todayIST(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export function isIsoDate(value) {
  const v = String(value || '').slice(0, 10);
  if (!ISO_DAY.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Payment date window: not in the future, and not more than 60 days ago.
 * Returns '' when the date is allowed, otherwise a short message in plain English.
 */
export function validatePaidOn(paidOn, today = todayIST()) {
  const v = String(paidOn || '').slice(0, 10);
  if (!isIsoDate(v)) return 'Enter a valid payment date (YYYY-MM-DD).';
  const day = String(today || '').slice(0, 10);
  if (v > day) return 'Payment date cannot be in the future.';
  if (v < addDays(day, -60)) return 'Payment date cannot be more than 60 days ago.';
  return '';
}

/**
 * Format a Date object to 'YYYY-MM-DD'
 */
export function formatDate(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse 'YYYY-MM-DD' safely without timezone offset issues
 */
export function parseDate(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return new Date(dateStr.getTime());
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    return new Date(y, m, d, 12, 0, 0); // Noon prevents any midnight daylight-saving drift
  }
  return new Date(dateStr);
}

function asIso(value) {
  if (!value) return '';
  if (value instanceof Date) return formatDate(value);
  return String(value).slice(0, 10);
}

function resolvedCycle(cycle) {
  if (!cycle) return cycleConfig({});
  return cycle.mode ? cycle : cycleConfig(cycle);
}

/**
 * Inclusive period end. Default rule: end = start + N months − 1 day, keeping the
 * anchor day of the month (31 Jan → 28 Feb → 31 Mar; 29 Feb stays on the 29th in
 * leap years and the last day of February otherwise).
 * Every-N-days libraries extend by N × the library cycle length instead of months.
 */
export function periodEndDate(startDate, durationMonths = 1, { anchorDay, cycle } = {}) {
  const start = asIso(startDate);
  const n = Math.max(1, parseInt(durationMonths, 10) || 1);
  const c = resolvedCycle(cycle);
  if (c.mode === 'N_DAYS') return addDays(start, n * c.cycleDays - 1);
  // Anniversary, calendar-month and yearly plans: N months from the anchor day, inclusive end.
  // Yearly libraries still take the duration in months (12 months = one year). The owner
  // "align to library cycle" option walks real yearly / calendar cycles separately.
  const next = addMonthsAnchored(start, n, anchorDay || undefined);
  return addDays(next, -1);
}

/**
 * Add calendar months to a start date and subtract 1 day to get the period expiry.
 * Pass anchorDay to keep a 31st / 29 Feb start when this period itself began on a
 * shorter month (for example a renewal that continued from 28 Feb).
 */
export function calculateSubscriptionExpiry(startDate, durationMonths = 1, anchorDay) {
  return periodEndDate(startDate, durationMonths, { anchorDay });
}

/**
 * Next renewal starts the day after the previous end date, whether that end
 * is still ahead or already past. A missing end date falls back to `asOf`.
 */
export function calculateRenewalStartDate(currentExpiryDate, asOf = todayIST()) {
  const end = asIso(currentExpiryDate);
  if (!isIsoDate(end)) return asIso(asOf) || todayIST();
  return addDays(end, 1);
}

/** Paid more than one month after the old end date (the end date's own day, one month later). */
export function isMoreThanOneMonthLate(previousEnd, paidOn) {
  const end = asIso(previousEnd);
  const paid = asIso(paidOn);
  if (!isIsoDate(end) || !isIsoDate(paid) || paid <= end) return false;
  return paid > addMonthsAnchored(end, 1);
}

/** Day of month to keep across renewals. Prefers an explicit anchor, then the join date. */
export function anchorDayFromStudent(student) {
  if (!student) return undefined;
  const explicit = Number(student.billingAnchorDay);
  if (explicit >= 1 && explicit <= 31) return explicit;
  const src = student.joinedDate || student.renewalHistory?.[0]?.startDate || student.startDate;
  const day = Number(asIso(src).slice(8, 10));
  return day >= 1 && day <= 31 ? day : undefined;
}

/**
 * One renewal period. Start is the day after the previous end (early or late).
 * If the payment is more than a month late and choice is 'fresh', start is the
 * chosen date (default: the payment date). End follows periodEndDate.
 * alignTo walks library cycles from the day after that date (owner "align" option).
 */
export function planRenewalPeriod({
  previousEnd, paidOn, durationMonths = 1, choice = 'continue', freshStart, anchorDay, cycle, alignTo,
} = {}) {
  const paid = asIso(paidOn) || todayIST();
  const longGap = isMoreThanOneMonthLate(previousEnd, paid);
  const useFresh = choice === 'fresh' && longGap;
  const start = useFresh
    ? (asIso(freshStart) || paid)
    : calculateRenewalStartDate(previousEnd, paid);
  const chosen = useFresh ? 'fresh' : 'continue';
  if (alignTo && isIsoDate(asIso(alignTo))) {
    const c = resolvedCycle(cycle);
    let next = addDays(asIso(alignTo), 1);
    const n = Math.max(1, parseInt(durationMonths, 10) || 1);
    let end = next;
    for (let i = 0; i < n; i++) {
      const cy = cycleFor(next, c);
      end = cy.end;
      next = addDays(cy.end, 1);
    }
    return { start, end, longGap, choice: chosen };
  }
  const end = periodEndDate(start, durationMonths, { anchorDay: useFresh ? undefined : anchorDay, cycle });
  return { start, end, longGap, choice: chosen };
}

/** Same dates for the single-student renew screen and bulk renew. */
export function renewalPeriodForStudent(student, opts = {}) {
  const period = planRenewalPeriod({
    previousEnd: student?.expiryDate || student?.endDate,
    anchorDay: anchorDayFromStudent(student),
    ...opts,
  });
  const billingAnchorDay = period.choice === 'fresh'
    ? Number(String(period.start).slice(8, 10))
    : (anchorDayFromStudent(student) || Number(String(period.start).slice(8, 10)));
  return { ...period, billingAnchorDay };
}

/** Append a renewal without throwing when older students have no history arrays. */
export function applyRenewalToStudent(student, renewal, payment, { billingAnchorDay } = {}) {
  const s = student || {};
  const months = Number(renewal?.durationMonths || s.durationMonths || 1);
  return {
    ...s,
    planId: renewal?.planId || s.planId,
    shiftId: renewal?.shiftId || s.shiftId,
    shift: renewal?.shift || s.shift,
    durationMonths: months,
    startDate: renewal?.startDate,
    expiryDate: renewal?.endDate || renewal?.expiryDate,
    status: 'Active',
    billingAnchorDay: billingAnchorDay || s.billingAnchorDay || anchorDayFromStudent(s),
    renewalHistory: [renewal, ...(Array.isArray(s.renewalHistory) ? s.renewalHistory : [])],
    paymentHistory: [payment, ...(Array.isArray(s.paymentHistory) ? s.paymentHistory : [])],
  };
}

/**
 * Calculate effective student status considering grace period and custom extensions
 * 
 * @param {Object} student 
 * @param {number} defaultGraceDays 
 * @returns {{ status: 'Active' | 'Grace Period' | 'Expired', label: string, isGrace: boolean, daysRemaining: number }}
 */
export function getSubscriptionStatus(student, defaultGraceDays = 3) {
  if (!student) return { status: 'Active', label: 'Active', isGrace: false, daysRemaining: 0 };
  if (student.status === 'Cancelled') return { status: 'Cancelled', label: 'Cancelled', isGrace: false, daysRemaining: 0 };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = parseDate(student.expiryDate);
  expiry.setHours(0, 0, 0, 0);

  const graceDays = student.customGraceDays != null ? Number(student.customGraceDays) : Number(defaultGraceDays || 0);
  
  // Effective due date may have an individual student extension
  let effectiveDueDate = new Date(expiry);
  if (student.extendedDueDate) {
    const ext = parseDate(student.extendedDueDate);
    ext.setHours(0, 0, 0, 0);
    if (ext > effectiveDueDate) {
      effectiveDueDate = ext;
    }
  }

  const graceBoundary = new Date(effectiveDueDate);
  graceBoundary.setDate(graceBoundary.getDate() + graceDays);

  const diffTime = effectiveDueDate.getTime() - today.getTime();
  const daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (today <= effectiveDueDate) {
    return {
      status: 'Active',
      label: 'Active',
      isGrace: false,
      daysRemaining: daysUntilDue
    };
  }

  if (today <= graceBoundary) {
    const graceDiff = graceBoundary.getTime() - today.getTime();
    const graceDaysLeft = Math.ceil(graceDiff / (1000 * 60 * 60 * 24));
    return {
      status: 'Grace Period',
      label: `Grace (${graceDaysLeft}d left)`,
      isGrace: true,
      daysRemaining: graceDaysLeft
    };
  }

  const overdueDiff = today.getTime() - effectiveDueDate.getTime();
  const overdueDays = Math.ceil(overdueDiff / (1000 * 60 * 60 * 24));
  return {
    status: 'Expired',
    label: `Expired (${overdueDays}d ago)`,
    isGrace: false,
    daysRemaining: -overdueDays
  };
}

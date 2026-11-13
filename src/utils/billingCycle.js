// Issue #9: one billing cycle per library, pro-rating by calendar days.
// Rules (approved): count calendar days, round only the final amount to the nearest rupee.
// Modes: ANNIVERSARY (each student's own date, no pro-rating), CALENDAR_MONTH, N_DAYS, YEARLY.
// Existing students keep their stored dates; these helpers never change stored data.

const pad = (n) => String(n).padStart(2, '0');
const parse = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return { y, m, d }; };
const toUTC = (iso) => { const { y, m, d } = parse(iso); return Date.UTC(y, m - 1, d); };
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 864e5);
/** Calendar days from a to b, both included. */
export const daysInclusive = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5) + 1;

/** Same day-of-month n months later; short months use their last day (no drift: 31 Jan -> 28 Feb -> 31 Mar). */
export function addMonthsAnchored(iso, months, anchorDay) {
  const { y, m, d } = parse(iso);
  const day = anchorDay || d;
  const total = (m - 1) + months;
  const yy = y + Math.floor(total / 12), mm = (total % 12) + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(day, daysInMonth(yy, mm)))}`;
}

/** n-th anniversary due date from the join date (always computed from the join date, so no drift). */
export const anniversaryDue = (joinDate, n) => addMonthsAnchored(joinDate, n);

export const CYCLE_MODES = ['ANNIVERSARY', 'CALENDAR_MONTH', 'N_DAYS', 'YEARLY'];

export const CYCLE_MODE_LABELS = {
  ANNIVERSARY: 'Anniversary',
  CALENDAR_MONTH: 'Calendar month',
  N_DAYS: 'Every N days',
  YEARLY: 'Yearly',
};

/** Library cycle settings from the settings object (with safe defaults). */
export function cycleConfig(settings = {}) {
  const mode = CYCLE_MODES.includes(settings.billingCycleMode) ? settings.billingCycleMode : 'ANNIVERSARY';
  return {
    mode,
    calendarBillingDay: Math.min(28, Math.max(1, Number(settings.calendarBillingDay) || 1)),
    cycleDays: Math.max(1, Math.round(Number(settings.cycleDays) || 30)),
    cycleAnchorDate: /^\d{4}-\d{2}-\d{2}$/.test(settings.cycleAnchorDate || '') ? settings.cycleAnchorDate : null,
  };
}

/** Fields worth storing on a plan for one mode (same defaults as library settings). */
export function normalizePlanBillingCycle(input) {
  if (!input || !CYCLE_MODES.includes(input.mode)) return null;
  const cfg = cycleConfig({
    billingCycleMode: input.mode,
    calendarBillingDay: input.calendarBillingDay,
    cycleDays: input.cycleDays,
    cycleAnchorDate: input.cycleAnchorDate,
  });
  const stored = { mode: cfg.mode };
  if (cfg.mode === 'CALENDAR_MONTH') stored.calendarBillingDay = cfg.calendarBillingDay;
  if (cfg.mode === 'N_DAYS') {
    stored.cycleDays = cfg.cycleDays;
    if (cfg.cycleAnchorDate) stored.cycleAnchorDate = cfg.cycleAnchorDate;
  }
  if (cfg.mode === 'YEARLY' && cfg.cycleAnchorDate) stored.cycleAnchorDate = cfg.cycleAnchorDate;
  return stored;
}

/**
 * Cycle used for a student on this plan. A saved plan.billingCycle wins.
 * Plans with no mode keep the library default.
 */
export function effectiveCycleConfig(settings = {}, plan = null) {
  const raw = plan?.billingCycle;
  if (!raw || !CYCLE_MODES.includes(raw.mode)) return cycleConfig(settings);
  return cycleConfig({
    billingCycleMode: raw.mode,
    calendarBillingDay: raw.calendarBillingDay != null && raw.calendarBillingDay !== '' ? raw.calendarBillingDay : settings.calendarBillingDay,
    cycleDays: raw.cycleDays != null && raw.cycleDays !== '' ? raw.cycleDays : settings.cycleDays,
    cycleAnchorDate: raw.cycleAnchorDate || settings.cycleAnchorDate,
  });
}

/** The library cycle that contains `date`: { start, end, totalDays }. ANNIVERSARY returns the student's own month. */
export function cycleFor(date, cfg) {
  const c = cfg.mode ? cfg : cycleConfig(cfg);
  if (c.mode === 'CALENDAR_MONTH') {
    const { y, m, d } = parse(date);
    const bd = c.calendarBillingDay;
    let start = `${y}-${pad(m)}-${pad(bd)}`;
    if (d < bd) start = addMonthsAnchored(start, -1, bd);
    const end = addDays(addMonthsAnchored(start, 1, bd), -1);
    return { start, end, totalDays: daysInclusive(start, end) };
  }
  if (c.mode === 'N_DAYS') {
    const anchor = c.cycleAnchorDate || `${parse(date).y}-01-01`;
    const k = Math.floor((toUTC(date) - toUTC(anchor)) / 864e5 / c.cycleDays);
    const start = addDays(anchor, k * c.cycleDays);
    return { start, end: addDays(start, c.cycleDays - 1), totalDays: c.cycleDays };
  }
  if (c.mode === 'YEARLY') {
    const anchor = c.cycleAnchorDate || `${parse(date).y}-01-01`;
    const { m: am, d: ad } = parse(anchor);
    const y = parse(date).y;
    let start = addMonthsAnchored(`${y}-${pad(am)}-01`, 0, ad);
    if (start > date) start = addMonthsAnchored(`${y - 1}-${pad(am)}-01`, 0, ad);
    const next = addMonthsAnchored(`${parse(start).y + 1}-${pad(am)}-01`, 0, ad);
    const end = addDays(next, -1);
    return { start, end, totalDays: daysInclusive(start, end) };
  }
  const end = addDays(anniversaryDue(date, 1), -1);
  return { start: date, end, totalDays: daysInclusive(date, end) };
}

/** fee x remaining/total days, rounded once at the end. */
export const proRate = (fee, remainingDays, totalDays) => Math.round((Number(fee) * remainingDays) / totalDays);

/** First admission: pro-rated to the end of the current library cycle (full fee in ANNIVERSARY mode). */
export function firstAdmissionCharge(fee, joinDate, cfg) {
  const c = cfg.mode ? cfg : cycleConfig(cfg);
  const cyc = cycleFor(joinDate, c);
  if (c.mode === 'ANNIVERSARY') return { amount: Math.round(Number(fee)), from: joinDate, to: cyc.end, days: cyc.totalDays, totalDays: cyc.totalDays, prorated: false };
  const days = daysInclusive(joinDate, cyc.end);
  return { amount: proRate(fee, days, cyc.totalDays), from: joinDate, to: cyc.end, days, totalDays: cyc.totalDays, prorated: days !== cyc.totalDays };
}

/**
 * Seat/plan move mid-cycle: (newFee - oldFee) x remaining/total days. Positive = charge, negative = credit.
 * remaining counts from the move date to the paid-until date, both included.
 */
export function upgradeCharge(oldFee, newFee, moveDate, paidUntil, totalDays) {
  const remaining = Math.max(0, daysInclusive(moveDate, paidUntil));
  const amount = proRate(Number(newFee) - Number(oldFee), remaining, totalDays);
  return { amount: Object.is(amount, -0) ? 0 : amount, remainingDays: remaining, totalDays, kind: amount > 0 ? 'charge' : amount < 0 ? 'credit' : 'none' };
}

/**
 * Owner-triggered migration at the next renewal: bridge from the day after the student's
 * stored expiry to the end of that library cycle. Nothing is changed unless the owner applies it.
 */
export function bridgeCharge(fee, currentExpiry, cfg) {
  const c = cfg.mode ? cfg : cycleConfig(cfg);
  if (c.mode === 'ANNIVERSARY') return null;
  const from = addDays(currentExpiry, 1);
  const cyc = cycleFor(from, c);
  if (from === cyc.start) return { amount: 0, from, to: addDays(from, -1), days: 0, totalDays: cyc.totalDays, aligned: true };
  const days = daysInclusive(from, cyc.end);
  return { amount: proRate(fee, days, cyc.totalDays), from, to: cyc.end, days, totalDays: cyc.totalDays, aligned: false };
}

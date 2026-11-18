/**
 * Pure utility to calculate pricing, discounts, and net totals for student plans.
 *
 * durationPricing rows stay backward compatible: `durationMonths` is the count
 * (months, days, or years). `durationUnit` is 'month' | 'day' | 'year' and
 * defaults to 'month' when a stored row does not have it.
 */

export const DURATION_UNITS = ['month', 'day', 'year'];

const MONTH_PRESETS = [1, 2, 3, 6, 12];
const MONTH_DEFAULT_DISCOUNTS = { 1: 0, 2: 0, 3: 5, 6: 10, 12: 15 };

/** Price unit that belongs to a fee-plan billing cycle mode. */
export function durationUnitForCycle(mode) {
  if (mode === 'N_DAYS') return 'day';
  if (mode === 'YEARLY') return 'year';
  return 'month';
}

export function normalizeDurationUnit(unit) {
  return unit === 'day' || unit === 'year' ? unit : 'month';
}

/** Missing durationUnit on older plans means a month. */
export function tierUnit(row) {
  return normalizeDurationUnit(row?.durationUnit);
}

export function tierCount(row) {
  const n = Number(row?.durationMonths ?? row?.count ?? row?.months);
  return Number.isFinite(n) ? n : 0;
}

export function planPricingUnit(plan) {
  const rows = plan?.durationPricing;
  if (Array.isArray(rows) && rows.length > 0) return tierUnit(rows[0]);
  return 'month';
}

export function defaultCountsForUnit(unit) {
  const u = normalizeDurationUnit(unit);
  if (u === 'day') return [1, 7, 15, 30];
  if (u === 'year') return [1, 2, 3];
  return [...MONTH_PRESETS];
}

export function defaultDiscountFor(unit, count) {
  if (normalizeDurationUnit(unit) !== 'month') return { discountType: 'None', discountValue: 0 };
  const pct = MONTH_DEFAULT_DISCOUNTS[count] || 0;
  return pct > 0
    ? { discountType: 'Percentage', discountValue: pct }
    : { discountType: 'None', discountValue: 0 };
}

export function defaultTiers(unit) {
  return defaultCountsForUnit(unit).map(count => ({ count, ...defaultDiscountFor(unit, count) }));
}

/** Labels and preset tabs for the shared Setup / Settings price control. */
export function describePricingControl(mode) {
  const unit = durationUnitForCycle(mode);
  const priceLabel = unit === 'day' ? 'Daily Price (₹)' : unit === 'year' ? 'Yearly Price (₹)' : 'Monthly Price (₹)';
  const tabs = defaultCountsForUnit(unit).map(count => ({
    count,
    label: formatDurationLabel(count, unit),
  }));
  return { unit, priceLabel, tabs };
}

export function formatDurationLabel(count, unit) {
  const n = Number(count) || 0;
  const u = normalizeDurationUnit(unit);
  if (u === 'day') return n === 1 ? '1 Day' : `${n} Days`;
  if (u === 'year') return n === 1 ? '1 Year' : `${n} Years`;
  return `${n} Mo`;
}

export function durationUnitWord(unit, count = 2) {
  const u = normalizeDurationUnit(unit);
  const plural = Number(count) !== 1;
  if (u === 'day') return plural ? 'Days' : 'Day';
  if (u === 'year') return plural ? 'Years' : 'Year';
  return plural ? 'Months' : 'Month';
}

function rowsForUnit(rows, unit) {
  const list = Array.isArray(rows) ? rows : [];
  const same = list.filter(row => tierUnit(row) === normalizeDurationUnit(unit));
  return same.length > 0 ? same : list;
}

export function inferUnitPrice(plan, unit) {
  const u = normalizeDurationUnit(unit || planPricingUnit(plan));
  if (plan && plan.unitPrice != null && plan.unitPrice !== '') {
    const explicit = Number(plan.unitPrice);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  }
  if (u === 'month' && plan && plan.monthlyPrice != null && plan.monthlyPrice !== '') {
    const monthly = Number(plan.monthlyPrice);
    if (Number.isFinite(monthly) && monthly >= 0) return monthly;
  }
  const rows = rowsForUnit(plan?.durationPricing, u);
  const one = rows.find(row => tierCount(row) === 1);
  if (one && Number.isFinite(Number(one.basePrice))) return Number(one.basePrice);
  if (rows[0] && tierCount(rows[0]) > 0) return Number(rows[0].basePrice || 0) / tierCount(rows[0]);
  return u === 'day' ? 100 : u === 'year' ? 15000 : 1500;
}

/** Rebuild the editor model from a saved plan (common price, tabs, discounts). */
export function editorStateFromPlan(plan, unit) {
  const u = normalizeDurationUnit(unit || planPricingUnit(plan));
  const rows = (Array.isArray(plan?.durationPricing) ? plan.durationPricing : [])
    .filter(row => tierUnit(row) === u && tierCount(row) > 0);
  const source = rows.length > 0 ? rows : (u === 'month' ? (plan?.durationPricing || []).filter(row => tierCount(row) > 0) : []);
  const tiers = source
    .map(row => ({
      count: tierCount(row),
      discountType: row.discountType === 'Percentage' || row.discountType === 'Fixed' ? row.discountType : 'None',
      discountValue: Number(row.discountValue) || 0,
    }))
    .sort((a, b) => a.count - b.count);
  return { unit: u, unitPrice: inferUnitPrice(plan, u), tiers };
}

export function getPlanBasePrice(plan, durationMonths = 1) {
  if (!plan) return 0;
  const dur = Number(durationMonths) || 1;
  if (Array.isArray(plan.durationPricing) && plan.durationPricing.length > 0) {
    const unit = planPricingUnit(plan);
    const list = rowsForUnit(plan.durationPricing, unit);
    const match = list.find(dp => Number(dp.durationMonths) === dur);
    if (match) return Number(match.basePrice || 0);
    const one = list.find(dp => Number(dp.durationMonths) === 1);
    if (one) return Math.round(Number(one.basePrice || 0) * dur);
    const first = list[0];
    const unitPrice = Number(first.basePrice || 0) / (Number(first.durationMonths) || 1);
    return Math.round(unitPrice * dur);
  }
  return Math.round(Number(plan.price || 0) * dur);
}

export function getPlanDefaultDuration(plan) {
  if (!plan) return 1;
  if (Array.isArray(plan.durationPricing) && plan.durationPricing.length > 0) {
    return Number(plan.durationPricing[0].durationMonths || 1);
  }
  return Number(plan.durationMonths || 1);
}

export function calculatePricing({
  plan,
  durationMonths = 1,
  isManualDuration = false,
  manualBasePrice = null,
  userDiscountType = null,
  userDiscountValue = null,
  transactionFine = 0
}) {
  const dur = Number(durationMonths) || 1;
  
  // Extract robust unit price (handling modern durationPricing-only plans as well as legacy price plans)
  const pricingUnit = planPricingUnit(plan);
  let unitPrice = Number(plan?.price || 0);
  if (!unitPrice && Array.isArray(plan?.durationPricing) && plan.durationPricing.length > 0) {
    unitPrice = inferUnitPrice(plan, pricingUnit);
  }

  let basePrice = Math.round(unitPrice * dur);
  let discountType = 'None';
  let discountValue = 0;

  if (plan && Array.isArray(plan.durationPricing) && !isManualDuration) {
    const list = rowsForUnit(plan.durationPricing, pricingUnit);
    const match = list.find(dp => Number(dp.durationMonths) === dur);
    if (match) {
      basePrice = Number(match.basePrice || 0);
      discountType = match.discountType || 'None';
      discountValue = Number(match.discountValue || 0);
    }
  }

  // If a manual base price is explicitly provided from component state
  if (manualBasePrice !== null && manualBasePrice !== undefined) {
    basePrice = Number(manualBasePrice);
  }

  // Allow UI to completely override discount
  if (userDiscountType !== null) {
    discountType = userDiscountType;
  }
  if (userDiscountValue !== null) {
    discountValue = Number(userDiscountValue || 0);
  }

  let calculatedDiscount = 0;
  if (discountType === 'Percentage') {
    calculatedDiscount = Math.round((Number(basePrice) * Number(discountValue || 0)) / 100);
  } else if (discountType === 'Fixed') {
    calculatedDiscount = Number(discountValue || 0);
  }

  const fine = Number(transactionFine || 0);

  const netTotal = Number(basePrice) - calculatedDiscount + fine;

  return {
    basePrice,
    discountType,
    discountValue,
    calculatedDiscount,
    fine,
    netTotal: Math.max(0, netTotal)
  };
}

/**
 * Build pricing tiers for a plan.
 * Unit price × count: monthly × months, daily × days, yearly × years.
 * `months` remains accepted as the count so existing callers stay valid.
 * Without an explicit discountType, rows stay Percentage (including 0%).
 *
 * @param {number} unitPrice - Price for one day, month, or year.
 * @param {Array<{months?: number, count?: number, discountPercent?: number, discountType?: string, discountValue?: number}>} durations
 * @param {{ unit?: 'month'|'day'|'year' }} [options]
 */
export function buildDurationPricing(unitPrice, durations, options = {}) {
  const parsed = Number(unitPrice);
  const safeUnitPrice = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  const unit = normalizeDurationUnit(options.unit);

  if (!Array.isArray(durations)) return [];

  return durations.reduce((pricing, duration) => {
    const count = Number(duration?.count ?? duration?.months);
    if (!Number.isFinite(count) || count <= 0) return pricing;

    const parsedDiscount = Number(duration?.discountPercent ?? (duration?.discountType === 'Percentage' ? duration?.discountValue : 0));
    const discountPercent = Number.isFinite(parsedDiscount)
      ? Math.min(100, Math.max(0, parsedDiscount))
      : 0;

    const basePrice = safeUnitPrice * count;
    let discountType = 'Percentage';
    let discountValue = discountPercent;
    let discountAmount = Math.round((basePrice * discountPercent) / 100);

    if (duration?.discountType === 'Fixed') {
      discountType = 'Fixed';
      const raw = Number(duration.discountValue);
      discountValue = Number.isFinite(raw) && raw > 0 ? raw : 0;
      discountAmount = Math.min(basePrice, discountValue);
    } else if (duration?.discountType === 'None') {
      discountType = 'None';
      discountValue = 0;
      discountAmount = 0;
    } else if (duration?.discountType === 'Percentage') {
      discountType = 'Percentage';
      discountValue = discountPercent;
      discountAmount = Math.round((basePrice * discountPercent) / 100);
    }

    pricing.push({
      durationMonths: count,
      durationUnit: unit,
      basePrice,
      discountType,
      discountValue,
      discountAmount,
      netPrice: Math.max(0, basePrice - discountAmount)
    });

    return pricing;
  }, []);
}

/** Shared writer used by Setup Wizard and Library Settings. */
export function compileDurationPricing(unitPrice, tiers, unit = 'month') {
  const u = normalizeDurationUnit(unit);
  const list = (Array.isArray(tiers) ? tiers : [])
    .map(tier => ({
      count: Number(tier.count),
      discountType: tier.discountType === 'Percentage' || tier.discountType === 'Fixed' ? tier.discountType : 'None',
      discountValue: Number(tier.discountValue) || 0,
      discountPercent: tier.discountType === 'Percentage' ? Number(tier.discountValue) || 0 : 0,
    }))
    .filter(tier => tier.count > 0)
    .sort((a, b) => a.count - b.count);
  return buildDurationPricing(unitPrice, list, { unit: u });
}

export function planPricingPatch(unitPrice, tiers, unit) {
  const u = normalizeDurationUnit(unit);
  const price = Number(unitPrice) || 0;
  const patch = {
    unitPrice: price,
    durationPricing: compileDurationPricing(price, tiers, u),
  };
  if (u === 'month') patch.monthlyPrice = price;
  return patch;
}

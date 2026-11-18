// Issues #15/#19: subscription state and the payment-provider seam.
// No real provider is connected. A provider must implement:
//   name: string
//   createCheckout({ library, plan, interval, amount, returnUrl }) -> { url, reference }
//   cancel({ library }) -> void
// Until one is registered, paid steps answer "payments not set up yet" and nothing is charged.
let provider = null;
export const setPaymentProvider = (p) => { provider = p || null; };
export const paymentProvider = () => provider;

export const INTERVALS = ['month', 'quarter', 'year'];
const DAY = 864e5;
const MONTHS = { month: 1, quarter: 3, year: 12 };
const DISCOUNT_TYPES = new Set(['none', 'percent', 'fixed']);

const addInterval = (date, interval) => {
  const d = new Date(date);
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else if (interval === 'quarter') d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

/** How many calendar months this billing interval covers. */
export const intervalMonths = (interval) => MONTHS[interval] || 1;

/**
 * Server-side price for one duration, in paise.
 * When `durationPricing` is missing, infer from legacy `priceMonthly` / `priceYearly`
 * without writing anything back. A missing yearly price means no 12-month offer.
 * Quarter is 3 × the monthly price with no invented discount.
 */
export function priceQuote(plan, interval) {
  if (!plan || !MONTHS[interval]) return null;
  const months = MONTHS[interval];
  const monthly = Number(plan.priceMonthly);
  const monthlyKnown = Number.isFinite(monthly);
  const monthlyMinor = monthlyKnown ? Math.round(monthly * 100) : 0;
  const originalMinor = monthlyMinor * months;
  const stored = plan.durationPricing && typeof plan.durationPricing === 'object' ? plan.durationPricing[interval] : null;
  if (stored && typeof stored === 'object') {
    if (interval !== 'month' && stored.offered === false) {
      return { interval, months, available: false, originalMinor, discountMinor: 0, savingMinor: 0, finalMinor: null, discountType: 'none', discountValue: 0 };
    }
    const discountType = DISCOUNT_TYPES.has(stored.discountType) ? stored.discountType : 'none';
    const discountValue = Number(stored.discountValue) || 0;
    let discountMinor = 0;
    if (discountType === 'percent') discountMinor = Math.round(originalMinor * discountValue / 100);
    else if (discountType === 'fixed') discountMinor = Math.round(discountValue * 100);
    const finalMinor = Math.max(0, originalMinor - discountMinor);
    return { interval, months, available: monthlyKnown, originalMinor, discountMinor, savingMinor: discountMinor, finalMinor, discountType, discountValue: discountType === 'none' ? 0 : discountValue };
  }
  if (!monthlyKnown) return { interval, months, available: false, originalMinor: 0, discountMinor: 0, savingMinor: 0, finalMinor: null, discountType: 'none', discountValue: 0 };
  if (interval === 'year') {
    if (plan.priceYearly == null || plan.priceYearly === '') {
      return { interval, months, available: false, originalMinor, discountMinor: 0, savingMinor: 0, finalMinor: null, discountType: 'none', discountValue: 0 };
    }
    const finalMinor = Math.round(Number(plan.priceYearly) * 100);
    const discountMinor = Math.max(0, originalMinor - finalMinor);
    return {
      interval, months, available: true, originalMinor, discountMinor, savingMinor: discountMinor, finalMinor,
      discountType: discountMinor > 0 ? 'fixed' : 'none',
      discountValue: discountMinor > 0 ? discountMinor / 100 : 0,
    };
  }
  return { interval, months, available: true, originalMinor, discountMinor: 0, savingMinor: 0, finalMinor: originalMinor, discountType: 'none', discountValue: 0 };
}

/** Final price in rupees, or null when that duration is not offered. Month with no number is 0. */
export function planPrice(plan, interval) {
  const quote = priceQuote(plan, interval === 'quarter' || interval === 'year' ? interval : 'month');
  if (!quote?.available || quote.finalMinor == null) return interval === 'year' || interval === 'quarter' ? null : (Number(plan?.priceMonthly) || 0);
  return quote.finalMinor / 100;
}

const badDiscount = (msg) => Object.assign(new Error(msg), { status: 400 });

/** Reject a discount that is negative, over 100%, or larger than the original. */
export function assertDurationDiscounts(plan) {
  const monthly = Number(plan?.priceMonthly);
  if (!Number.isFinite(monthly)) return;
  const monthlyMinor = Math.round(monthly * 100);
  const pricing = plan?.durationPricing;
  if (!pricing || typeof pricing !== 'object') return;
  for (const interval of INTERVALS) {
    const row = pricing[interval];
    if (!row || typeof row !== 'object' || row.offered === false) continue;
    const type = row.discountType || 'none';
    if (!DISCOUNT_TYPES.has(type)) throw badDiscount(`Invalid discount type for ${interval}`);
    const value = Number(row.discountValue) || 0;
    if (value < 0) throw badDiscount(`Discount for ${interval} cannot be negative`);
    if (type === 'percent' && value > 100) throw badDiscount(`Discount for ${interval} cannot exceed 100%`);
    const originalMinor = monthlyMinor * MONTHS[interval];
    if (type === 'fixed' && Math.round(value * 100) > originalMinor) throw badDiscount(`Discount for ${interval} cannot exceed the original price`);
    if (type === 'percent' && Math.round(originalMinor * value / 100) > originalMinor) throw badDiscount(`Discount for ${interval} cannot exceed the original price`);
  }
}

/** Starting subscription for a new library on `plan`. */
export function initialSubscription(plan, interval = 'month', now = new Date()) {
  if (!plan) return null;
  const iv = INTERVALS.includes(interval) ? interval : 'month';
  const price = Number(planPrice(plan, iv)) || 0;
  const base = { planId: plan.planId, interval: iv, price, startedAt: now, cancelAtPeriodEnd: false, pendingPlanId: null };
  if (plan.trialDays > 0) return { ...base, status: 'trialing', trialEndsAt: new Date(now.getTime() + plan.trialDays * DAY), currentPeriodEnd: new Date(now.getTime() + plan.trialDays * DAY) };
  if (price === 0) return { ...base, status: 'active', currentPeriodEnd: addInterval(now, iv) };
  return { ...base, status: 'pending_payment', currentPeriodEnd: null };
}

export { addInterval };

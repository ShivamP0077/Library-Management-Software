// Issues #15/#19: subscription state and the payment-provider seam.
// No real provider is connected. A provider must implement:
//   name: string
//   createCheckout({ library, plan, interval, amount, returnUrl }) -> { url, reference }
//   cancel({ library }) -> void
// Until one is registered, paid steps answer "payments not set up yet" and nothing is charged.
let provider = null;
export const setPaymentProvider = (p) => { provider = p || null; };
export const paymentProvider = () => provider;

export const INTERVALS = ['month', 'year'];
const DAY = 864e5;
const addInterval = (date, interval) => {
  const d = new Date(date);
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

export const planPrice = (plan, interval) => (interval === 'year' ? plan?.priceYearly ?? null : plan?.priceMonthly ?? 0);

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

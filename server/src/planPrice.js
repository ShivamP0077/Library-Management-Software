// Issue #9: server-side plan price for payment amount checks.
// Uses the same approved algorithms as the UI (calendar-day pro-rate, round final only).
import { getPlanBasePrice } from '../../src/utils/pricingCalculator.js';
import { firstAdmissionCharge, upgradeCharge, effectiveCycleConfig } from '../../src/utils/billingCycle.js';

const n = (v) => Number(v ?? 0);

/** Plan's listed fee for a duration (before optional pro-rate / manual edit). */
export function planFee(plan, durationMonths = 1) {
  if (!plan) return null;
  return getPlanBasePrice(plan, durationMonths);
}

/**
 * Expected payment amounts the server will accept without an amount-edit permission.
 * Returns null when there is not enough trusted input to compute a price (caller then
 * falls back to suggestedAmount comparison / requiring permission).
 *
 * Supported kinds (from payment.priceKind or inferred):
 *   admission | renewal — planId + durationMonths (+ optional proRated / settings for first month)
 *   relocate             — oldFee, newFee, moveDate, paidUntil, totalDays
 */
export function expectedPayment(payment, { plan = null, settings = {} } = {}) {
  if (!payment) return null;
  const fine = n(payment.fine);
  const kind = payment.priceKind || (payment.proRated ? 'admission' : payment.bridge ? 'renewal' : payment.planId ? 'renewal' : null);

  if (kind === 'relocate' || (payment.oldFee != null && payment.newFee != null && payment.paidUntil)) {
    const totalDays = Number(payment.totalDays) || 0;
    if (!(totalDays > 0) || !payment.moveDate || !payment.paidUntil) return null;
    const u = upgradeCharge(payment.oldFee, payment.newFee, payment.moveDate, payment.paidUntil, totalDays);
    // Credits (negative) are recorded as the charge amount; UI may send absolute with method Refund.
    const amount = u.amount;
    return { amount, discount: 0, fine: 0, netTotal: amount, source: 'relocate' };
  }

  if (!plan && payment.planId) return null; // planId given but not found — caller decides
  if (!plan) return null;

  const months = Number(payment.durationMonths) || 1;
  let fee = planFee(plan, months);
  if (fee == null || !Number.isFinite(fee)) return null;

  // Plan-built-in duration discount (Percentage / Fixed on the matching tier).
  let discount = 0;
  if (Array.isArray(plan.durationPricing) && !payment.proRated) {
    const match = plan.durationPricing.find(dp => Number(dp.durationMonths) === months);
    if (match) {
      fee = Number(match.basePrice || fee);
      if (match.discountType === 'Percentage') discount = Math.round((fee * Number(match.discountValue || 0)) / 100);
      else if (match.discountType === 'Fixed') discount = Number(match.discountValue || 0);
    }
  }

  if (payment.proRated && payment.priceKind !== 'renewal') {
    // Recompute from join date + the plan's duration type, else library settings.
    const join = payment.proRated.from || payment.startDate || payment.date;
    if (join) {
      const recomputed = firstAdmissionCharge(planFee(plan, 1) ?? fee, join, effectiveCycleConfig(settings, plan));
      fee = recomputed.amount;
      discount = 0; // pro-rated first month has no separate duration discount
    } else if (payment.proRated.amount != null) {
      fee = Number(payment.proRated.amount);
      discount = 0;
    }
  }

  if (payment.bridge && payment.bridge.amount != null) {
    // Bridge is an additive alignment charge already baked into amount by the UI;
    // expected net is the plan fee for the renewal period (bridge is separate receipt in some flows).
    // When bridge fields ride on the same payment, accept plan fee + bridge.
    const bridgeAmt = Number(payment.bridge.amount) || 0;
    const net = Math.max(0, fee - discount + fine) + bridgeAmt;
    return { amount: fee + bridgeAmt, discount, fine, netTotal: net, source: 'renewal_bridge' };
  }

  const netTotal = Math.max(0, fee - discount + fine);
  return { amount: fee, discount, fine, netTotal, source: kind || 'plan' };
}

/** True when client's money fields differ from the server expectation. */
export function differsFromExpected(payment, expected) {
  if (!expected) return false;
  return ['amount', 'discount', 'fine', 'netTotal'].some(k => n(payment[k]) !== n(expected[k]));
}

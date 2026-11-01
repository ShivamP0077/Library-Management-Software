/**
 * Pure utility to calculate pricing, discounts, and net totals for student plans.
 */
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
  const unitPrice = Number(plan?.price || 0);
  let basePrice = unitPrice * dur;
  let discountType = 'None';
  let discountValue = 0;

  if (plan && plan.durationPricing && !isManualDuration) {
    const match = plan.durationPricing.find(dp => dp.durationMonths === dur);
    if (match) {
      basePrice = match.basePrice;
      discountType = match.discountType || 'None';
      discountValue = match.discountValue || 0;
    }
  }

  // If a manual base price is explicitly provided from component state
  if (manualBasePrice !== null && manualBasePrice !== undefined) {
    basePrice = Number(manualBasePrice);
  }

  // Allow UI to completely override discount (e.g., if user changes dropdown from 'Percentage' to 'Fixed' or modifies value)
  if (userDiscountType !== null) {
    discountType = userDiscountType;
  }
  if (userDiscountValue !== null) {
    discountValue = userDiscountValue;
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
 * Build percentage-based pricing tiers for a plan.
 *
 * @param {number} monthlyPrice - Base price for a single month.
 * @param {Array<{months: number, discountPercent: number}>} durations - Optional durations.
 * @returns {Array<{
 *   durationMonths: number,
 *   basePrice: number,
 *   discountType: 'Percentage',
 *   discountValue: number,
 *   discountAmount: number,
 *   netPrice: number
 * }>}
 */
export function buildDurationPricing(monthlyPrice, durations) {
  const parsedMonthly = Number(monthlyPrice);
  const safeMonthlyPrice = Number.isFinite(parsedMonthly) && parsedMonthly > 0 ? parsedMonthly : 0;

  if (!Array.isArray(durations)) return [];

  return durations.reduce((pricing, duration) => {
    const months = Number(duration?.months);
    if (!Number.isFinite(months) || months <= 0) return pricing;

    const parsedDiscount = Number(duration?.discountPercent);
    const discountPercent = Number.isFinite(parsedDiscount)
      ? Math.min(100, Math.max(0, parsedDiscount))
      : 0;

    const basePrice = safeMonthlyPrice * months;
    const discountAmount = Math.round((basePrice * discountPercent) / 100);

    pricing.push({
      durationMonths: months,
      basePrice,
      discountType: 'Percentage',
      discountValue: discountPercent,
      discountAmount,
      netPrice: basePrice - discountAmount
    });

    return pricing;
  }, []);
}

/**
 * Pure utility to calculate pricing, discounts, and net totals for student plans.
 */

export function getPlanBasePrice(plan, durationMonths = 1) {
  if (!plan) return 0;
  const dur = Number(durationMonths) || 1;
  if (Array.isArray(plan.durationPricing) && plan.durationPricing.length > 0) {
    const match = plan.durationPricing.find(dp => Number(dp.durationMonths) === dur);
    if (match) return Number(match.basePrice || 0);
    const oneMonth = plan.durationPricing.find(dp => Number(dp.durationMonths) === 1);
    if (oneMonth) return Math.round(Number(oneMonth.basePrice || 0) * dur);
    const first = plan.durationPricing[0];
    const unit = Number(first.basePrice || 0) / (Number(first.durationMonths) || 1);
    return Math.round(unit * dur);
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
  let unitPrice = Number(plan?.price || 0);
  if (!unitPrice && Array.isArray(plan?.durationPricing) && plan.durationPricing.length > 0) {
    const oneMonth = plan.durationPricing.find(dp => Number(dp.durationMonths) === 1);
    unitPrice = oneMonth ? Number(oneMonth.basePrice) : Number(plan.durationPricing[0].basePrice) / (Number(plan.durationPricing[0].durationMonths) || 1);
  }

  let basePrice = Math.round(unitPrice * dur);
  let discountType = 'None';
  let discountValue = 0;

  if (plan && Array.isArray(plan.durationPricing) && !isManualDuration) {
    const match = plan.durationPricing.find(dp => Number(dp.durationMonths) === dur);
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


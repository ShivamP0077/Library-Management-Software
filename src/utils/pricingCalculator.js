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

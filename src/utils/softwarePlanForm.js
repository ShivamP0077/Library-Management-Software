export const DURATION_ROWS = [
  ['month', '1 month'],
  ['quarter', '3 months'],
  ['year', '12 months'],
];

export function emptyDurations() {
  return {
    month: { offered: true, discountType: 'none', discountValue: '' },
    quarter: { offered: true, discountType: 'none', discountValue: '' },
    year: { offered: false, discountType: 'none', discountValue: '' },
  };
}

/** Editor rows. Discounts are copied as stored and are not recomputed from the monthly price. */
export function durationsFromPlan(plan) {
  const rows = emptyDurations();
  const stored = plan?.durationPricing;
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(rows)) {
      const row = stored[key];
      if (!row) continue;
      rows[key] = {
        offered: key === 'month' ? true : row.offered !== false,
        discountType: row.discountType || 'none',
        discountValue: row.discountValue ? row.discountValue : '',
      };
    }
    return rows;
  }
  const year = (plan?.intervals || []).find(item => item.interval === 'year');
  if (year?.available) {
    rows.year = {
      offered: true,
      discountType: year.discountType || 'none',
      discountValue: year.discountValue || '',
    };
  }
  return rows;
}

export function setMonthlyKeepingDiscounts(form, priceMonthly) {
  return { ...form, priceMonthly, durationPricing: form.durationPricing };
}

export function durationPayload(rows) {
  const out = {};
  for (const [key] of DURATION_ROWS) {
    const row = rows[key] || {};
    out[key] = {
      offered: key === 'month' ? true : !!row.offered,
      discountType: row.discountType || 'none',
      discountValue: row.discountValue === '' || row.discountValue == null ? 0 : Number(row.discountValue),
    };
  }
  return out;
}

export function intervalOffered(plan, interval) {
  const row = (plan?.intervals || []).find(item => item.interval === interval);
  if (row) return row.available !== false;
  if (interval === 'year') return plan?.priceYearly != null;
  return interval === 'month' || interval === 'quarter';
}

export function subscriptionCta(changeType) {
  if (changeType === 'renewal') return 'Renew';
  if (changeType === 'upgrade') return 'Upgrade';
  return 'Continue to Pay';
}

export function showsTrialOnSubscription() {
  return false;
}

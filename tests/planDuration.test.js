import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedPayment } from '../server/src/planPrice.js';

test('server price check uses the plan duration type ahead of the library cycle', () => {
  const plan = {
    id: 'P1',
    durationPricing: [{ durationMonths: 1, basePrice: 1000, discountType: 'None', discountValue: 0 }],
    billingCycle: { mode: 'N_DAYS', cycleDays: 30, cycleAnchorDate: '2026-06-01' },
  };
  const settings = { billingCycleMode: 'CALENDAR_MONTH', calendarBillingDay: 1 };
  const priced = expectedPayment({
    planId: 'P1', durationMonths: 1, fine: 0, priceKind: 'admission',
    proRated: { from: '2026-06-10' },
  }, { plan, settings });
  assert.equal(priced.amount, 700);
  const libraryOnly = expectedPayment({
    planId: 'P1', durationMonths: 1, fine: 0, priceKind: 'admission',
    proRated: { from: '2026-06-20' },
  }, {
    plan: { ...plan, billingCycle: undefined },
    settings,
  });
  assert.equal(libraryOnly.amount, 367);
});

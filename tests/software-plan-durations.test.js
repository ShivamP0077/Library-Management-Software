import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { durationsFromPlan, setMonthlyKeepingDiscounts, subscriptionCta, showsTrialOnSubscription, DURATION_ROWS } from '../src/utils/softwarePlanForm.js';
import { recommendedId, catalogueUrl, intervalPrice } from '../landing/src/planCatalogue.js';

test('editor keeps each duration discount when the monthly price changes', () => {
  const form = {
    priceMonthly: '200',
    durationPricing: durationsFromPlan({
      durationPricing: {
        month: { discountType: 'none', discountValue: 0 },
        quarter: { offered: true, discountType: 'percent', discountValue: 10 },
        year: { offered: true, discountType: 'fixed', discountValue: 400 },
      },
    }),
  };
  const next = setMonthlyKeepingDiscounts(form, '250');
  assert.equal(next.priceMonthly, '250');
  assert.equal(next.durationPricing.quarter.discountValue, 10);
  assert.equal(next.durationPricing.year.discountType, 'fixed');
  assert.equal(next.durationPricing.year.discountValue, 400);
});

test('duration selector offers 1, 3 and 12 months', () => {
  assert.deepEqual(DURATION_ROWS.map(row => row[0]), ['month', 'quarter', 'year']);
});

test('logged-in subscription has no trial call to action', () => {
  assert.equal(showsTrialOnSubscription(), false);
  assert.equal(subscriptionCta('renewal'), 'Renew');
  assert.equal(subscriptionCta('upgrade'), 'Upgrade');
  assert.equal(subscriptionCta('new'), 'Continue to Pay');
  const page = readFileSync(new URL('../src/components/profile/SubscriptionPage.jsx', import.meta.url), 'utf8');
  assert.equal(page.includes('trialDays'), false);
  assert.equal(page.includes('Start free trial'), false);
  assert.equal(page.includes('Start Free Trial'), false);
});

test('landing recommended badge comes from the catalogue, not a hardcoded plan', () => {
  const plans = [
    { planId: 'starter', recommended: false, intervals: [{ interval: 'month', available: true, finalMinor: 10000, originalMinor: 10000, savingMinor: 0 }] },
    { planId: 'growth', recommended: true, intervals: [{ interval: 'month', available: true, finalMinor: 20000, originalMinor: 20000, savingMinor: 0 }] },
  ];
  assert.equal(recommendedId(plans), 'growth');
  assert.equal(intervalPrice(plans[1], 'month').finalMinor, 20000);
  assert.equal(catalogueUrl(''), null);
  assert.equal(catalogueUrl('https://api.example.com'), 'https://api.example.com/api/public/software-plans');
  const landing = readFileSync(new URL('../landing/src/components/Pricing.jsx', import.meta.url), 'utf8');
  assert.equal(landing.includes('featured: true'), false);
  assert.equal(landing.includes('Placeholder — plans and prices are not final'), false);
  assert.equal(landing.includes('recommendedId'), true);
});

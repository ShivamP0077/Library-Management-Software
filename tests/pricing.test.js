import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDurationPricing,
  calculatePricing,
  compileDurationPricing,
  defaultTiers,
  describePricingControl,
  editorStateFromPlan,
  getPlanBasePrice,
} from '../src/utils/pricingCalculator.js';
import { expectedPayment } from '../server/src/planPrice.js';

test('BUG-08: 2500 x 3 months @5% = 7125', () => {
  const [t] = buildDurationPricing(2500, [{ months: 3, discountPercent: 5 }]);
  assert.equal(t.basePrice, 7500); assert.equal(t.discountAmount, 375); assert.equal(t.netPrice, 7125);
});
test('BUG-08: multiple durations, rounding via Math.round', () => {
  const r = buildDurationPricing(999, [{ months: 1, discountPercent: 0 }, { months: 2, discountPercent: 0 }, { months: 6, discountPercent: 10 }, { months: 12, discountPercent: 15 }]);
  assert.deepEqual(r.map(x => x.netPrice), [999, 1998, 5994 - 599, 11988 - 1798]);
});
test('BUG-08: invalid inputs are clamped/ignored', () => {
  const r = buildDurationPricing(-5, [{ months: 0, discountPercent: 5 }, { months: 2, discountPercent: 150 }]);
  assert.equal(r.length, 1); assert.equal(r[0].netPrice, 0); assert.equal(r[0].discountValue, 100);
});
test('BUG-08: tiers plug into calculatePricing consistently', () => {
  const durationPricing = buildDurationPricing(2500, [{ months: 3, discountPercent: 5 }]);
  const p = calculatePricing({ plan: { price: 2500, durationPricing }, durationMonths: 3 });
  assert.equal(p.netTotal, 7125);
});

test('cycle mode switches the shared price control unit label and tabs', () => {
  const month = describePricingControl('ANNIVERSARY');
  const calendar = describePricingControl('CALENDAR_MONTH');
  const daily = describePricingControl('N_DAYS');
  const yearly = describePricingControl('YEARLY');
  assert.equal(month.priceLabel, 'Monthly Price (₹)');
  assert.equal(calendar.priceLabel, 'Monthly Price (₹)');
  assert.deepEqual(month.tabs.map(t => t.label), ['1 Mo', '2 Mo', '3 Mo', '6 Mo', '12 Mo']);
  assert.equal(daily.priceLabel, 'Daily Price (₹)');
  assert.deepEqual(daily.tabs.map(t => t.label), ['1 Day', '7 Days', '15 Days', '30 Days']);
  assert.equal(yearly.priceLabel, 'Yearly Price (₹)');
  assert.deepEqual(yearly.tabs.map(t => t.label), ['1 Year', '2 Years', '3 Years']);
  const ui = readFileSync(new URL('../src/components/PlanPricingFields.jsx', import.meta.url), 'utf8');
  assert.match(ui, /describePricingControl/);
  const setup = readFileSync(new URL('../src/components/SetupWizard.jsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/components/LibrarySettings.jsx', import.meta.url), 'utf8');
  assert.match(setup, /PlanPricingFields/);
  assert.match(settings, /PlanPricingFields/);
  assert.doesNotMatch(setup, /STANDARD_DURATIONS/);
  assert.doesNotMatch(settings, /\+ Add \{m\} Mo/);
});

test('Setup and Settings share one durationPricing shape', () => {
  const tiers = defaultTiers('day');
  const fromSetup = compileDurationPricing(80, tiers, 'day');
  const fromSettings = compileDurationPricing(80, tiers, 'day');
  assert.deepEqual(fromSetup, fromSettings);
  assert.equal(fromSetup[0].durationUnit, 'day');
  assert.equal(fromSetup[0].durationMonths, 1);
  assert.ok(fromSetup.every(row => row.durationUnit === 'day' && row.basePrice === 80 * row.durationMonths));
});

test('reopening a plan prefills the saved common price, tabs, and discounts', () => {
  const saved = {
    unitPrice: 80,
    billingCycle: { mode: 'N_DAYS', cycleDays: 30 },
    durationPricing: compileDurationPricing(80, [
      { count: 7, discountType: 'Percentage', discountValue: 10 },
      { count: 30, discountType: 'Fixed', discountValue: 50 },
    ], 'day'),
  };
  const editor = editorStateFromPlan(saved, 'day');
  assert.equal(editor.unitPrice, 80);
  assert.deepEqual(editor.tiers.map(t => t.count), [7, 30]);
  assert.equal(editor.tiers[0].discountType, 'Percentage');
  assert.equal(editor.tiers[0].discountValue, 10);
  assert.equal(editor.tiers[1].discountType, 'Fixed');
  assert.equal(editor.tiers[1].discountValue, 50);
  const again = compileDurationPricing(editor.unitPrice, editor.tiers, editor.unit);
  assert.equal(again[0].basePrice, 560);
  assert.equal(again[0].netPrice, 504);
  assert.equal(again[1].basePrice, 2400);
  assert.equal(again[1].netPrice, 2350);
});

test('buildDurationPricing multiplies daily and yearly units', () => {
  const [day] = buildDurationPricing(100, [{ months: 7, discountPercent: 10 }], { unit: 'day' });
  assert.equal(day.durationUnit, 'day');
  assert.equal(day.durationMonths, 7);
  assert.equal(day.basePrice, 700);
  assert.equal(day.discountAmount, 70);
  assert.equal(day.netPrice, 630);
  const [year] = buildDurationPricing(5000, [{ count: 2, discountPercent: 0 }], { unit: 'year' });
  assert.equal(year.durationUnit, 'year');
  assert.equal(year.basePrice, 10000);
  assert.equal(year.netPrice, 10000);
  const legacy = { durationPricing: [{ durationMonths: 3, basePrice: 3000, discountType: 'Percentage', discountValue: 5 }] };
  assert.equal(getPlanBasePrice(legacy, 3), 3000);
  const dailyPlan = { durationPricing: buildDurationPricing(100, [{ months: 1, discountPercent: 0 }, { months: 7, discountPercent: 10 }], { unit: 'day' }) };
  assert.equal(calculatePricing({ plan: dailyPlan, durationMonths: 7 }).netTotal, 630);
});

test('a stored payment amount is not rewritten when the plan price later changes', () => {
  const receipt = {
    amount: 7500, discount: 375, fine: 0, netTotal: 7125,
    durationMonths: 3, priceKind: 'renewal', planId: 'P',
  };
  const soldAt = { durationPricing: buildDurationPricing(2500, [{ months: 3, discountPercent: 5 }]) };
  const atSale = expectedPayment(receipt, { plan: soldAt });
  assert.equal(atSale.amount, receipt.amount);
  assert.equal(atSale.netTotal, receipt.netTotal);
  const edited = { durationPricing: buildDurationPricing(4000, [{ months: 3, discountPercent: 5 }]) };
  const laterCheck = expectedPayment(receipt, { plan: edited });
  assert.equal(receipt.amount, 7500);
  assert.equal(receipt.netTotal, 7125);
  assert.notEqual(laterCheck.amount, receipt.amount);
});

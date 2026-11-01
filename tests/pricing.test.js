import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDurationPricing, calculatePricing } from '../src/utils/pricingCalculator.js';

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

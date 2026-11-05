import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleFor, firstAdmissionCharge, upgradeCharge, anniversaryDue, bridgeCharge, daysInclusive, cycleConfig, proRate } from '../src/utils/billingCycle.js';

const MONTH = { mode: 'CALENDAR_MONTH', calendarBillingDay: 1 };

test('worked example: ₹1000 monthly, joins 20 Jun -> ₹367 (11 of 30 days)', () => {
  const r = firstAdmissionCharge(1000, '2026-06-20', MONTH);
  assert.deepEqual([r.amount, r.days, r.totalDays, r.to], [367, 11, 30, '2026-06-30']);
});

test('worked example: upgrade ₹1000 -> ₹1500 with 12 of 30 days left -> ₹200', () => {
  const r = upgradeCharge(1000, 1500, '2026-06-19', '2026-06-30', 30);
  assert.deepEqual([r.amount, r.remainingDays, r.kind], [200, 12, 'charge']);
});

test('worked example: same upgrade in a 31-day month -> ₹194 (12 of 31)', () => {
  const cyc = cycleFor('2026-07-20', MONTH);
  assert.equal(cyc.totalDays, 31);
  assert.equal(upgradeCharge(1000, 1500, '2026-07-20', cyc.end, cyc.totalDays).amount, 194);
});

test('worked example: 30-day cycle, join on day 10 -> ₹700 (21 of 30)', () => {
  const cfg = { mode: 'N_DAYS', cycleDays: 30, cycleAnchorDate: '2026-06-01' };
  const r = firstAdmissionCharge(1000, '2026-06-10', cfg);
  assert.deepEqual([r.amount, r.days, r.totalDays, r.to], [700, 21, 30, '2026-06-30']);
  // the next cycles keep rolling every 30 days from the anchor
  assert.deepEqual(cycleFor('2026-07-05', cfg), { start: '2026-07-01', end: '2026-07-30', totalDays: 30 });
});

test('worked example: yearly in a leap year -> ₹847 (310 of 366 days)', () => {
  const cfg = { mode: 'YEARLY', cycleAnchorDate: '2028-01-01' };
  const r = firstAdmissionCharge(1000, '2028-02-26', cfg);
  assert.deepEqual([r.amount, r.days, r.totalDays, r.to], [847, 310, 366, '2028-12-31']);
  assert.equal(cycleFor('2027-05-01', cfg).totalDays, 365);
});

test('worked example: anniversary from 31 Jan does not drift', () => {
  assert.deepEqual([1, 2, 3, 4, 13].map(n => anniversaryDue('2027-01-31', n)), ['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2028-02-29']);
  const r = firstAdmissionCharge(1000, '2027-01-31', { mode: 'ANNIVERSARY' });
  assert.equal(r.amount, 1000); assert.equal(r.prorated, false);
});

test('rounding happens once, on the final amount', () => {
  assert.equal(proRate(999, 7, 30), 233); // 233.1
  assert.equal(proRate(1000, 1, 3), 333);
  assert.equal(proRate(1000, 2, 3), 667);
});

test('downgrade gives a credit; no change gives nothing; after paid-until gives nothing', () => {
  assert.deepEqual(upgradeCharge(1500, 1000, '2026-06-19', '2026-06-30', 30).amount, -200);
  assert.equal(upgradeCharge(1500, 1000, '2026-06-19', '2026-06-30', 30).kind, 'credit');
  assert.equal(upgradeCharge(1000, 1000, '2026-06-19', '2026-06-30', 30).kind, 'none');
  assert.equal(upgradeCharge(1000, 1500, '2026-07-05', '2026-06-30', 30).amount, 0);
});

test('calendar month with billing day 15, and February', () => {
  const cfg = { mode: 'CALENDAR_MONTH', calendarBillingDay: 15 };
  assert.deepEqual(cycleFor('2026-03-10', cfg), { start: '2026-02-15', end: '2026-03-14', totalDays: 28 });
  assert.deepEqual(cycleFor('2028-02-01', MONTH), { start: '2028-02-01', end: '2028-02-29', totalDays: 29 });
  assert.equal(firstAdmissionCharge(1000, '2026-06-01', MONTH).prorated, false);
});

test('bridge for an owner-chosen migration starts the day after the stored expiry', () => {
  const b = bridgeCharge(1000, '2026-06-19', MONTH);
  assert.deepEqual([b.from, b.to, b.days, b.amount], ['2026-06-20', '2026-06-30', 11, 367]);
  assert.equal(bridgeCharge(1000, '2026-06-30', MONTH).aligned, true);
  assert.equal(bridgeCharge(1000, '2026-06-30', { mode: 'ANNIVERSARY' }), null);
});

test('config defaults and day counting', () => {
  assert.equal(cycleConfig({}).mode, 'ANNIVERSARY');
  assert.equal(cycleConfig({ billingCycleMode: 'N_DAYS', cycleDays: '0' }).cycleDays, 30);
  assert.equal(daysInclusive('2026-06-20', '2026-06-30'), 11);
});

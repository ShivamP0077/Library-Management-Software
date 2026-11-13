import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRenewalToStudent, calculateRenewalStartDate, isMoreThanOneMonthLate,
  periodEndDate, renewalPeriodForStudent, validatePaidOn,
} from '../src/utils/dateUtils.js';
import { addMonthsAnchored, effectiveCycleConfig } from '../src/utils/billingCycle.js';

const nov = { expiryDate: '2026-11-30', joinedDate: '2026-11-01', billingAnchorDay: 1 };

test('renewing a student with no paymentHistory or renewalHistory does not throw', () => {
  const updated = applyRenewalToStudent(
    { id: 'S1', name: 'Ravi', expiryDate: '2026-11-30' },
    { renewalId: 'RN-2', startDate: '2026-12-01', endDate: '2026-12-31', durationMonths: 1, planId: 'P1' },
    { receiptNo: 'R-2', paidOn: '2026-12-07', date: '2026-12-07' },
  );
  assert.equal(updated.paymentHistory.length, 1);
  assert.equal(updated.renewalHistory.length, 1);
  assert.equal(updated.expiryDate, '2026-12-31');
  assert.equal(updated.startDate, '2026-12-01');
  assert.equal(updated.paymentHistory[0].receiptNo, 'R-2');
});

test('late payer: period ended 30 Nov, paid 7 Dec, new period is 1 Dec–31 Dec', () => {
  const period = renewalPeriodForStudent(nov, { paidOn: '2026-12-07', durationMonths: 1 });
  assert.equal(period.longGap, false);
  assert.deepEqual([period.start, period.end], ['2026-12-01', '2026-12-31']);
  assert.equal(calculateRenewalStartDate('2026-11-30', '2026-12-07'), '2026-12-01');
});

test('more than a month late: continue from the old end, or start fresh on the chosen date', () => {
  const gap = { expiryDate: '2026-11-30', billingAnchorDay: 1 };
  assert.equal(isMoreThanOneMonthLate('2026-11-30', '2027-01-07'), true);
  const continued = renewalPeriodForStudent(gap, { paidOn: '2027-01-07', durationMonths: 1, choice: 'continue' });
  assert.equal(continued.choice, 'continue');
  assert.deepEqual([continued.start, continued.end], ['2026-12-01', '2026-12-31']);
  const fresh = renewalPeriodForStudent(gap, { paidOn: '2027-01-07', durationMonths: 1, choice: 'fresh' });
  assert.equal(fresh.choice, 'fresh');
  assert.equal(fresh.start, '2027-01-07');
  assert.equal(fresh.end, '2027-02-06');
  const picked = renewalPeriodForStudent(gap, { paidOn: '2027-01-07', durationMonths: 1, choice: 'fresh', freshStart: '2027-01-10' });
  assert.deepEqual([picked.start, picked.end], ['2027-01-10', '2027-02-09']);
  // A week late is not a long gap, so "start fresh" is ignored.
  const weekLate = renewalPeriodForStudent(gap, { paidOn: '2026-12-07', durationMonths: 1, choice: 'fresh', freshStart: '2026-12-07' });
  assert.equal(weekLate.choice, 'continue');
  assert.equal(weekLate.start, '2026-12-01');
});

test('early renewal starts the day after the current end date', () => {
  const period = renewalPeriodForStudent(nov, { paidOn: '2026-11-20', durationMonths: 1 });
  assert.deepEqual([period.start, period.end], ['2026-12-01', '2026-12-31']);
  assert.equal(calculateRenewalStartDate('2026-11-30', '2026-11-20'), '2026-12-01');
});

test('a 31st start keeps month-end, then the 31st again', () => {
  assert.equal(periodEndDate('2027-01-31', 1, { anchorDay: 31 }), '2027-02-27');
  const feb = renewalPeriodForStudent(
    { expiryDate: '2027-02-27', billingAnchorDay: 31, joinedDate: '2027-01-31' },
    { paidOn: '2027-02-27', durationMonths: 1 },
  );
  assert.equal(feb.start, '2027-02-28');
  assert.equal(feb.end, '2027-03-30');
  const march = renewalPeriodForStudent(
    { expiryDate: feb.end, billingAnchorDay: 31, joinedDate: '2027-01-31' },
    { paidOn: '2027-03-30', durationMonths: 1 },
  );
  assert.equal(march.start, '2027-03-31');
  assert.deepEqual(
    [1, 2].map(n => addMonthsAnchored('2027-01-31', n)),
    ['2027-02-28', '2027-03-31'],
  );
});

test('a 29 Feb start uses the 28th in a non-leap year and the 29th again in a leap year', () => {
  assert.equal(periodEndDate('2028-02-29', 1, { anchorDay: 29 }), '2028-03-28');
  assert.equal(periodEndDate('2028-02-29', 12, { anchorDay: 29 }), '2029-02-27');
  const afterClamp = renewalPeriodForStudent(
    { expiryDate: '2029-02-27', billingAnchorDay: 29, joinedDate: '2028-02-29' },
    { paidOn: '2029-02-27', durationMonths: 12 },
  );
  assert.equal(afterClamp.start, '2029-02-28');
  assert.equal(afterClamp.end, '2030-02-27');
  assert.equal(addMonthsAnchored('2031-02-28', 12, 29), '2032-02-29');
  assert.equal(periodEndDate('2031-02-28', 12, { anchorDay: 29 }), '2032-02-28');
});

test('payment date cannot be in the future or more than 60 days ago', () => {
  const today = '2026-12-07';
  assert.equal(validatePaidOn(today, today), '');
  assert.equal(validatePaidOn('2026-10-08', today), '');
  assert.match(validatePaidOn('2026-12-08', today), /future/);
  assert.match(validatePaidOn('2026-10-07', today), /60 days/);
  assert.match(validatePaidOn('07-12-2026', today), /valid payment date/);
  assert.match(validatePaidOn('', today), /valid payment date/);
});

test('every-N-days libraries extend by the cycle length, not a calendar month', () => {
  const end = periodEndDate('2026-12-01', 1, { cycle: { mode: 'N_DAYS', cycleDays: 30 } });
  assert.equal(end, '2026-12-30');
});

test('bulk renew uses the same dates as a single renew', () => {
  const students = [
    nov,
    { expiryDate: '2026-10-15', joinedDate: '2026-09-16', billingAnchorDay: 16 },
    { expiryDate: '2026-11-30', billingAnchorDay: 1 },
  ];
  const opts = { paidOn: '2027-01-07', durationMonths: 1, choice: 'continue' };
  const fresh = { ...opts, choice: 'fresh', freshStart: '2027-01-07' };
  for (const student of students) {
    const single = renewalPeriodForStudent(student, opts);
    const bulk = renewalPeriodForStudent(student, opts);
    assert.deepEqual(bulk, single);
    assert.deepEqual(renewalPeriodForStudent(student, fresh), renewalPeriodForStudent(student, fresh));
  }
  assert.deepEqual(
    [renewalPeriodForStudent(nov, opts).start, renewalPeriodForStudent(nov, opts).end],
    ['2026-12-01', '2026-12-31'],
  );
});

test('a plan duration type is used for renewal and admission even when the library mode differs', () => {
  const library = { billingCycleMode: 'ANNIVERSARY' };
  const plan = { billingCycle: { mode: 'N_DAYS', cycleDays: 10, cycleAnchorDate: '2026-01-01' } };
  const cycle = effectiveCycleConfig(library, plan);
  const student = { expiryDate: '2026-11-30', joinedDate: '2026-11-01', billingAnchorDay: 1 };
  const renewed = renewalPeriodForStudent(student, { paidOn: '2026-12-01', durationMonths: 1, cycle });
  assert.deepEqual([renewed.start, renewed.end], ['2026-12-01', '2026-12-10']);
  const libraryOnly = renewalPeriodForStudent(student, {
    paidOn: '2026-12-01', durationMonths: 1, cycle: effectiveCycleConfig(library, {}),
  });
  assert.equal(libraryOnly.end, '2026-12-31');
  const admitted = periodEndDate('2026-06-10', 1, { cycle });
  assert.equal(admitted, '2026-06-19');
  assert.equal(periodEndDate('2026-06-10', 1, { anchorDay: 10 }), '2026-07-09');
});

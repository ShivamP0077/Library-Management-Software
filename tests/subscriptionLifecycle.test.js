import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  subscriptionLifecycle, periodSnapshots, stampPeriodSnapshots,
  NEW_LIBRARY_GRACE_DAYS, DEFAULT_EXPIRED_PERIOD_DAYS, holdsDesk,
} from '../src/utils/subscriptionLifecycle.js';
import { getSubscriptionStatus } from '../src/utils/dateUtils.js';

const settings = { gracePeriodDays: 5, expiredPeriodDays: 25 };
const student = {
  expiryDate: '2026-11-13',
  graceDaysSnapshot: 5,
  expiredPeriodDaysSnapshot: 25,
  status: 'Active',
  seatNo: 'A1',
};

test('13 Nov example: Active, grace 14–18, expired 19 Nov, cancel 14 Dec', () => {
  const on = (today) => subscriptionLifecycle(student, { settings, today });
  assert.equal(on('2026-11-13').status, 'Active');
  assert.equal(on('2026-11-13').holdsDesk, true);
  assert.equal(on('2026-11-14').status, 'Grace Period');
  assert.equal(on('2026-11-18').status, 'Grace Period');
  assert.equal(on('2026-11-18').holdsDesk, true);
  const expired = on('2026-11-19');
  assert.equal(expired.status, 'Expired');
  assert.equal(expired.holdsDesk, false);
  assert.equal(expired.firstExpiredDate, '2026-11-19');
  assert.equal(expired.graceEndDate, '2026-11-18');
  assert.equal(on('2026-12-13').status, 'Expired');
  assert.equal(on('2026-12-13').holdsDesk, false);
  assert.equal(on('2026-12-13').autoCancelDate, '2026-12-14');
  assert.equal(on('2026-11-13').expiringSoon, true);
});

test('a later settings edit does not move a snapshotted deadline; a new period uses the new values', () => {
  const changed = { gracePeriodDays: 1, expiredPeriodDays: 2 };
  const life = subscriptionLifecycle(student, { settings: changed, today: '2026-11-19' });
  assert.equal(life.graceEndDate, '2026-11-18');
  assert.equal(life.autoCancelDate, '2026-12-14');
  const snap = periodSnapshots(changed, {});
  assert.deepEqual(snap, { graceDaysSnapshot: 1, expiredPeriodDaysSnapshot: 2 });
  const renewed = stampPeriodSnapshots({ ...student, expiryDate: '2026-12-13' }, student, changed);
  assert.equal(renewed.graceDaysSnapshot, 1);
  assert.equal(renewed.expiredPeriodDaysSnapshot, 2);
});

test('new library defaults are 5 and 25; an existing grace of 3 is unchanged', () => {
  assert.equal(NEW_LIBRARY_GRACE_DAYS, 5);
  assert.equal(DEFAULT_EXPIRED_PERIOD_DAYS, 25);
  const existing = { gracePeriodDays: 3 };
  assert.equal(periodSnapshots(existing, {}).graceDaysSnapshot, 3);
  const life = subscriptionLifecycle({ expiryDate: '2026-11-13', status: 'Active' }, { settings: existing, today: '2026-11-16' });
  assert.equal(life.status, 'Grace Period');
  assert.equal(life.graceDays, 3);
  assert.equal(life.graceEndDate, '2026-11-16');
});

test('custom grace overrides the snapshot; cancelled and expired do not hold the desk', () => {
  const custom = subscriptionLifecycle({ ...student, customGraceDays: 1 }, { settings, today: '2026-11-15' });
  assert.equal(custom.status, 'Expired');
  assert.equal(holdsDesk({ ...student, status: 'Cancelled' }, settings, '2026-11-01'), false);
  const ui = getSubscriptionStatus(student, settings, '2026-11-14');
  assert.equal(ui.status, 'Grace Period');
  assert.equal(ui.isGrace, true);
});

test('an edit that is not a renewal keeps the old snapshot', () => {
  const next = stampPeriodSnapshots({ ...student, name: 'New' }, student, { gracePeriodDays: 9, expiredPeriodDays: 1 });
  assert.equal(next.graceDaysSnapshot, 5);
  assert.equal(next.expiredPeriodDaysSnapshot, 25);
});

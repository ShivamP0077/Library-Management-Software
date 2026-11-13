import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysLeftUntil, formatPlanDate, historyTypeLabel, isLibraryLocked, isSectionAllowedWhenLocked, isSubscriptionLockError, statusPillLabel,
} from '../src/utils/subscriptionLock.js';

test('locked libraries keep dashboard, settings and profile', () => {
  assert.equal(isSectionAllowedWhenLocked('dashboard'), true);
  assert.equal(isSectionAllowedWhenLocked('Settings'), true);
  assert.equal(isSectionAllowedWhenLocked('profile'), true);
  for (const tab of ['students', 'seats', 'payments', 'expenses', 'reports', 'whatsapp', 'archives', 'notifications', 'support']) {
    assert.equal(isSectionAllowedWhenLocked(tab), false, tab);
  }
  assert.equal(isSectionAllowedWhenLocked(''), false);
});

test('super admin is never locked; owner and staff follow subscriptionAccess', () => {
  const locked = { ok: false, locked: true, code: 'SUBSCRIPTION_LOCKED' };
  assert.equal(isLibraryLocked(locked, { role: 'superadmin' }), false);
  assert.equal(isLibraryLocked(locked, { role: 'client_admin' }), true);
  assert.equal(isLibraryLocked(locked, { role: 'staff' }), true);
  assert.equal(isLibraryLocked({ ok: true, locked: false }, { role: 'client_admin' }), false);
  assert.equal(isLibraryLocked(null, { role: 'staff' }), false);
  assert.equal(isSubscriptionLockError({ status: 402, code: 'SUBSCRIPTION_LOCKED' }), true);
  assert.equal(isSubscriptionLockError({ status: 500 }), false);
});

test('history type labels and status pills', () => {
  assert.equal(historyTypeLabel('trial'), 'Trial');
  assert.equal(historyTypeLabel('new'), 'New');
  assert.equal(historyTypeLabel('renew'), 'Renewal');
  assert.equal(historyTypeLabel('early_renew'), 'Early renewal');
  assert.equal(historyTypeLabel('upgrade'), 'Upgrade');
  assert.equal(historyTypeLabel('something-else'), 'New');
  assert.equal(statusPillLabel('active'), 'Active');
  assert.equal(statusPillLabel('trial'), 'Trial');
  assert.equal(statusPillLabel('expired'), 'Expired');
});

test('days left and DD MMM YYYY dates', () => {
  const now = new Date(2026, 10, 13, 12, 0, 0);
  assert.equal(daysLeftUntil(null, now), 0);
  assert.equal(daysLeftUntil(new Date(2026, 10, 12), now), 0);
  assert.equal(daysLeftUntil(new Date(2026, 10, 13, 18, 0, 0), now), 1);
  assert.equal(daysLeftUntil(new Date(2026, 10, 15, 8, 0, 0), now), 2);
  assert.equal(formatPlanDate(new Date(2026, 10, 13)), '13 Nov 2026');
  assert.equal(formatPlanDate(''), '');
  assert.equal(formatPlanDate('not-a-date'), '');
});

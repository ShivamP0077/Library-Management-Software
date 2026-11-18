import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAllowAllFinancial, sanitizeStaffPermissions, staffAllows, canSeeNetProfit, isWalletBlockedRole,
} from '../src/utils/staffPermissions.js';

test('Allow all financial permissions skips Wallet for a Librarian', () => {
  const next = applyAllowAllFinancial({ payments: { view: true } }, 'Librarian');
  assert.equal(next.allowAllFinancial, true);
  assert.equal(next.payments.collect, true);
  assert.equal(next.payments.create, true);
  assert.equal(next.reports.netProfit, true);
  assert.equal(next.expenses.export, true);
  assert.equal(staffAllows(next, 'Librarian', 'wallet', 'view'), false);
  assert.equal(isWalletBlockedRole('Librarian'), true);
  assert.equal(next.wallet.view, false);
});

test('saved Wallet flags on a Librarian are ignored', () => {
  const dirty = { allowAllFinancial: true, wallet: { view: true, manage: true } };
  const clean = sanitizeStaffPermissions(dirty, 'Librarian');
  assert.equal(staffAllows(clean, 'Librarian', 'wallet', 'view'), false);
  assert.equal(staffAllows({ wallet: { manage: true } }, 'Librarian', 'wallet', 'create'), false);
});

test('Manager Wallet follows the grant; missing keys stay off', () => {
  assert.equal(staffAllows({ wallet: { view: true } }, 'Manager', 'wallet', 'view'), true);
  assert.equal(staffAllows({ wallet: { view: true } }, 'Manager', 'wallet', 'collect'), false);
  assert.equal(staffAllows({}, 'Accountant', 'wallet', 'view'), false);
  const all = applyAllowAllFinancial({}, 'Accountant');
  assert.equal(staffAllows(all, 'Accountant', 'wallet', 'view'), true);
});

test('Net Profit is hidden unless that flag or manage is set', () => {
  assert.equal(canSeeNetProfit({ reports: { view: true } }, 'Manager'), false);
  assert.equal(canSeeNetProfit({ reports: { view: true, netProfit: true } }, 'Manager'), true);
  assert.equal(canSeeNetProfit({ reports: { manage: true } }, 'Librarian'), true);
  assert.equal(canSeeNetProfit({}, 'Accountant'), false);
});

test('Add/Collect accepts the older create flag', () => {
  assert.equal(staffAllows({ payments: { create: true } }, 'Librarian', 'payments', 'collect'), true);
  assert.equal(staffAllows({ payments: { view: true } }, 'Librarian', 'payments', 'delete'), false);
  assert.equal(staffAllows({ payments: { view: true } }, 'Librarian', 'payments', 'export'), false);
});

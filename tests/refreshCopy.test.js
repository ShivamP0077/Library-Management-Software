import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WHATSAPP_REFRESH, SUPERADMIN_REFRESH, whatsappRefreshStateLabel } from '../src/utils/refreshCopy.js';

test('WhatsApp refresh copy is honest about a real status check', () => {
  assert.equal(WHATSAPP_REFRESH.checking, 'Checking connection…');
  assert.equal(WHATSAPP_REFRESH.updated, 'Updated');
  assert.equal(WHATSAPP_REFRESH.failed, 'Failed');
  assert.equal(whatsappRefreshStateLabel('connected'), 'Connected');
  assert.equal(whatsappRefreshStateLabel('close'), 'Disconnected');
  assert.equal(whatsappRefreshStateLabel('disconnected'), 'Disconnected');
  assert.equal(whatsappRefreshStateLabel('not_created'), 'Disconnected');
});

test('Super Admin refresh copy', () => {
  assert.equal(SUPERADMIN_REFRESH.refreshing, 'Refreshing…');
  assert.equal(SUPERADMIN_REFRESH.refreshed, 'Refreshed');
  assert.equal(SUPERADMIN_REFRESH.failed, 'Failed');
});

test('panels use the shared copy and the dead fake RefreshButton is gone', () => {
  const panel = readFileSync(new URL('../src/components/WhatsAppLinkPanel.jsx', import.meta.url), 'utf8');
  const dash = readFileSync(new URL('../src/auth/SuperAdminDashboard.jsx', import.meta.url), 'utf8');
  assert.match(panel, /WHATSAPP_REFRESH\.checking/);
  assert.match(panel, /WHATSAPP_REFRESH\.updated/);
  assert.match(panel, /WHATSAPP_REFRESH\.failed/);
  assert.match(panel, /WHATSAPP_REFRESH\.button/);
  assert.doesNotMatch(panel, /Data refreshed successfully/);
  assert.match(dash, /SUPERADMIN_REFRESH\.refreshing/);
  assert.match(dash, /SUPERADMIN_REFRESH\.refreshed/);
  assert.match(dash, /SUPERADMIN_REFRESH\.failed/);
  let missing = false;
  try { readFileSync(new URL('../src/components/RefreshButton.jsx', import.meta.url)); } catch { missing = true; }
  assert.equal(missing, true);
});

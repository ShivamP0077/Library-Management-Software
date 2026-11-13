import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('owners see a support contact when online payment is not set up', () => {
  const support = read('../src/utils/support.js');
  const sub = read('../src/components/profile/SubscriptionPage.jsx');
  const modal = read('../src/auth/MySoftwarePlanModal.jsx');
  assert.match(support, /Online payment is not set up yet\. Please contact support at \$\{SUPPORT_EMAIL\}\./);
  assert.match(support, /mylibraryosadmin@gmail\.com/);
  for (const src of [sub, modal]) {
    assert.match(src, /PAYMENT_NOT_READY_MESSAGE/);
    assert.match(src, /billing_not_configured/);
    assert.match(src, /billingNotReady/);
  }
  assert.match(sub, /disabled=\{busy \|\| billingNotReady\}/);
  assert.match(sub, /disabled=\{busy \|\| !planId \|\| billingNotReady\}/);
  assert.match(modal, /disabled=\{busy \|\| billingNotReady \|\| gatewayBlocked\}/);
  assert.doesNotMatch(modal, /Super Admin must configure tax\/currency before activation/);
});

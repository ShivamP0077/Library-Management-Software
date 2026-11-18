import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('profile legal screens use view and link to the published pages', () => {
  const profile = read('../src/components/profile/LibraryOsProfile.jsx');
  assert.doesNotMatch(profile, /not published in this app yet/);
  assert.doesNotMatch(profile, /screen === 'terms'/);
  assert.doesNotMatch(profile, /screen === 'about'/);
  assert.match(profile, /view === 'privacy' \|\| view === 'terms' \|\| view === 'refund'/);
  assert.match(profile, /view === 'about'/);
  assert.match(profile, /legalHref\(legal\[1\]\)/);
  assert.match(profile, /\/privacy/);
  assert.match(profile, /\/terms/);
  assert.match(profile, /\/refund/);
  assert.match(profile, /Version \{pkg\.version\}/);
});

test('contact options are email, dedicated WhatsApp, and a ticket — no owner phone', () => {
  const choices = read('../src/components/ContactChoices.jsx');
  const profile = read('../src/components/profile/LibraryOsProfile.jsx');
  const login = read('../src/auth/LoginScreen.jsx');
  const signup = read('../src/auth/SignupPanel.jsx');
  const modal = read('../src/auth/MyProfileModal.jsx');
  const landing = read('../landing/src/pages/ContactExtras.jsx');
  const contact = read('../landing/src/pages/LegalPages.jsx');
  for (const src of [choices, login, signup, modal, landing]) {
    assert.match(src, /Email|mailto/);
    assert.match(src, /Chat on WhatsApp|ContactChoices/);
    assert.match(src, /Raise a support ticket|ContactChoices/);
  }
  assert.match(profile, /Raise a support ticket/);
  assert.match(profile, /<SupportCenter embedded \/>/);
  assert.match(contact, /<ContactExtras \/>/);
  assert.match(contact, /mailto:\$\{DEMO_EMAIL\}/);
  assert.doesNotMatch(profile, /SUPPORT_PHONE/);
  assert.doesNotMatch(profile, /wa\.me/);
  assert.doesNotMatch(choices, /SUPPORT_PHONE/);
  assert.doesNotMatch(landing, /wa\.me\/\d/);
  assert.match(landing, /VITE_SUPPORT_WHATSAPP/);
  assert.match(choices, /Unavailable/);
});

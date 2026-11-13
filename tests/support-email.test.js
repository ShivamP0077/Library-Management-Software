import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const OFFICIAL = 'mylibraryosadmin@gmail.com';

test('app support default is the official address and phone rows are not a placeholder', () => {
  const support = readFileSync(new URL('../src/utils/support.js', import.meta.url), 'utf8');
  const profile = readFileSync(new URL('../src/components/profile/LibraryOsProfile.jsx', import.meta.url), 'utf8');
  const lock = readFileSync(new URL('../src/components/profile/LockScreen.jsx', import.meta.url), 'utf8');
  const help = readFileSync(new URL('../src/components/SupportCenter.jsx', import.meta.url), 'utf8');
  assert.match(support, new RegExp(OFFICIAL.replace('.', '\\.')));
  assert.doesNotMatch(support, /support@libraryos\.app/);
  assert.doesNotMatch(profile, /Not listed/);
  assert.doesNotMatch(profile, /support@libraryos\.app/);
  assert.match(lock, /mailto:\$\{SUPPORT_EMAIL\}/);
  assert.match(help, /mailto:\$\{SUPPORT_EMAIL\}/);
});

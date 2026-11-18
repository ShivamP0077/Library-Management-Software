import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifiedAdminRefresh } from '../src/utils/refreshFeedback.js';

const dash = readFileSync(new URL('../src/auth/SuperAdminDashboard.jsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/components/LibrarySettings.jsx', import.meta.url), 'utf8');

test('verified refresh accepts a real library list and summary', () => {
  assert.equal(verifiedAdminRefresh([{ libraryId: 'a' }], { list: [] }), true);
});

test('a failed or incomplete refresh is not treated as success', () => {
  assert.throws(() => verifiedAdminRefresh(null, { list: [] }), /did not return library data/);
  assert.throws(() => verifiedAdminRefresh([], null), /did not return library data/);
  assert.throws(() => verifiedAdminRefresh([], {}), /did not return library data/);
});

test('Super Admin Refresh shows loading, disables repeats, and toasts success only after the request', () => {
  assert.match(dash, /toast\.loading\(SUPERADMIN_REFRESH\.refreshing\)/);
  assert.match(dash, /if \(result\.ok\) toast\.success\(SUPERADMIN_REFRESH\.refreshed/);
  assert.match(dash, /toast\.error\(result\.error\?\.message \|\| SUPERADMIN_REFRESH\.failed/);
  assert.match(dash, /verifiedAdminRefresh\(libs, sum\)/);
  assert.match(dash, /disabled=\{loading\}/);
  assert.match(dash, /refreshInFlight\.current/);
  const successAt = dash.indexOf('toast.success(SUPERADMIN_REFRESH.refreshed');
  const checkAt = dash.indexOf('if (result.ok)');
  assert.ok(checkAt !== -1 && successAt > checkAt);
});

test('admission document settings restore stored policy and document types', () => {
  assert.match(settings, /idProofRequirement: settings\.idProofRequirement \|\| 'Required'/);
  assert.match(settings, /idProofDeadlineDays: settings\.idProofDeadlineDays \?\? 7/);
  assert.match(settings, /setDocTypes\(settings\.documentTypes\)/);
});

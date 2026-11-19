import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('invite is created inside the existing Add Staff modal', () => {
  const settings = read('../src/components/LibrarySettings.jsx');
  const team = read('../src/components/TeamAccess.jsx');

  const addButtons = settings.match(/id="btn-add-staff"/g) || [];
  assert.equal(addButtons.length, 1);
  assert.match(settings, /Add Staff Member/);
  assert.doesNotMatch(settings, /id="btn-add-staff"[\s\S]{0,800}id="btn-add-staff"/);

  assert.match(settings, /api\.createInvite/);
  assert.match(settings, /role: 'staff'/);
  assert.match(settings, /sanitizeStaffPermissions/);
  assert.match(settings, /staffInvite/);
  assert.match(settings, /https:\/\/wa\.me\/\?text=/);
  assert.match(settings, />Share</);
  assert.match(settings, /Copy/);
  assert.match(settings, /copyText\(/);
  assert.match(settings, /editingStaffId \? false : true/);
  assert.match(settings, /Retry invite/);
  assert.doesNotMatch(settings, /Add Staff Member[\s\S]{0,200}Add Staff Member[\s\S]{0,80}Add Staff/);

  assert.doesNotMatch(team, /Create invite/);
  assert.doesNotMatch(team, /id="invite-email"/);
  assert.doesNotMatch(team, /handleCreate/);
  assert.match(team, /Revoke/);
  assert.match(team, /api\.invites\(/);
  assert.match(team, /api\.revokeInvite/);
  assert.match(team, /Activity log/);
});

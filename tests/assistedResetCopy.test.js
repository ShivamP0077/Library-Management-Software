import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD_ONLY_WARNING } from '../src/auth/assistedResetCopy.js';

test('password method warning names the stolen-password risk', () => {
  assert.match(PASSWORD_ONLY_WARNING, /Super Admin password is stolen/);
  assert.match(PASSWORD_ONLY_WARNING, /Email or WhatsApp/);
});

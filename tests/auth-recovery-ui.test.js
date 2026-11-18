import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const login = readFileSync(new URL('../src/auth/LoginScreen.jsx', import.meta.url), 'utf8');
const signup = readFileSync(new URL('../src/auth/SignupPanel.jsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/utils/api.js', import.meta.url), 'utf8');

test('forgot-password UI offers email, mobile, and linked Google', () => {
  assert.match(login, /id="forgot-method-email"/);
  assert.match(login, /id="forgot-method-mobile"/);
  assert.match(login, /id="forgot-method-google"/);
  assert.match(login, /forgot-password-mobile|forgotPasswordMobile/);
  assert.match(login, /recovery=1/);
  assert.match(login, /does not change your Google password/i);
  assert.match(login, /no login code/);
  assert.match(api, /reset-password-google/);
  assert.match(api, /forgot-password-mobile/);
});

test('signup and forgot resend controls count down from 30 seconds', () => {
  assert.match(login, /id="forgot-resend"/);
  assert.match(login, /Resend code in \$\{resendWait\}s/);
  assert.match(login, /setResendWait\(30\)/);
  assert.match(signup, /id="signup-resend"/);
  assert.match(signup, /setResendWait\(30\)/);
  assert.doesNotMatch(signup, /setResendWait\(60\)/);
  assert.doesNotMatch(login, /setResendWait\(60\)/);
});

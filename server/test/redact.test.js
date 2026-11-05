import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, resetRedactCache } from '../src/redact.js';
test('redact masks secrets', () => {
  process.env.TEST_CLIENT_SECRET = 'supersecretvalue123';
  resetRedactCache();
  const out = redact('mongodb://u:p@h/db Bearer abcdefghijk123 password=hunter22 {"client_secret":"x1"} supersecretvalue123');
  for (const bad of ['u:p@', 'abcdefghijk123', 'hunter22', '"x1"', 'supersecretvalue123']) assert.ok(!out.includes(bad), bad);
  delete process.env.TEST_CLIENT_SECRET; resetRedactCache();
});
test('redact keeps normal text', () => assert.equal(redact('[db] Connected to MongoDB'), '[db] Connected to MongoDB'));

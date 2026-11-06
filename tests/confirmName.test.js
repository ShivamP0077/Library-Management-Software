import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmNameMatches } from '../src/utils/confirmName.js';
test('#16 confirm name: exact trimmed match only', () => {
  assert.ok(confirmNameMatches('Blue Lagoon Test', 'Blue Lagoon Test'));
  assert.ok(confirmNameMatches('  Blue Lagoon Test  ', 'Blue Lagoon Test'));
  assert.ok(confirmNameMatches(" Shivam's Library ", "Shivam's Library"));
  assert.ok(!confirmNameMatches('blue lagoon test', 'Blue Lagoon Test'), 'case must match');
  assert.ok(!confirmNameMatches('Study\u00a0Point', 'Study Point'), 'internal whitespace must match');
  assert.ok(!confirmNameMatches('Shivam’s Library', "Shivam's Library"), 'quote style must match');
  assert.ok(!confirmNameMatches('Ａｂｃ', 'Abc'), 'no unicode folding');
});
test('#16 confirm name: wrong or partial names never match', () => {
  assert.ok(!confirmNameMatches('Blue Lagoon', 'Blue Lagoon Test'));
  assert.ok(!confirmNameMatches('', ''));
  assert.ok(!confirmNameMatches('x', ''));
  assert.ok(!confirmNameMatches('Accomplish Test', 'Blue Lagoon Test'));
});

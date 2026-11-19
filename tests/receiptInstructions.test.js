import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RECEIPT_INSTRUCTIONS,
  DEFAULT_RECEIPT_INSTRUCTIONS_TEXT,
  receiptInstructionLines,
  receiptInstructionsEditorValue,
} from '../src/utils/receiptInstructions.js';

test('unset receipt instructions resolve to the shipped defaults', () => {
  assert.deepEqual(receiptInstructionLines(undefined), DEFAULT_RECEIPT_INSTRUCTIONS);
  assert.deepEqual(receiptInstructionLines(null), DEFAULT_RECEIPT_INSTRUCTIONS);
  assert.equal(receiptInstructionsEditorValue(undefined), DEFAULT_RECEIPT_INSTRUCTIONS_TEXT);
  assert.equal(receiptInstructionsEditorValue(null), DEFAULT_RECEIPT_INSTRUCTIONS_TEXT);
});

test('an explicitly empty value hides the instructions box', () => {
  assert.deepEqual(receiptInstructionLines(''), []);
  assert.deepEqual(receiptInstructionLines('   \n  '), []);
  assert.equal(receiptInstructionsEditorValue(''), '');
});

test('a saved value is split into trimmed lines and not replaced by defaults', () => {
  const raw = 'Fees are non-refundable.\n\nKeep this receipt for your records.\nLibrary timings: 6 AM - 11 PM\n';
  assert.deepEqual(receiptInstructionLines(raw), [
    'Fees are non-refundable.',
    'Keep this receipt for your records.',
    'Library timings: 6 AM - 11 PM',
  ]);
  assert.equal(receiptInstructionsEditorValue(raw), raw);
});

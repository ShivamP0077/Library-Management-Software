/** Pre-written receipt instructions used until the owner sets the field. */
export const DEFAULT_RECEIPT_INSTRUCTIONS = [
  'Fees once paid are non-refundable and non-transferable.',
  'Please keep this receipt for your records.',
  'Pay the next fee on or before the due date to keep your seat.',
  'Maintain silence and keep the library clean.',
  'The library is not responsible for personal belongings.',
];

export const DEFAULT_RECEIPT_INSTRUCTIONS_TEXT = DEFAULT_RECEIPT_INSTRUCTIONS.join('\n');

/** True when the owner has never saved receipt instructions (field is unset). */
export function receiptInstructionsUnset(value) {
  return value == null;
}

/**
 * Lines to print on a receipt.
 * null/undefined → shipped defaults (new and existing libraries).
 * A saved value, including an empty string, is respected: empty hides the box.
 */
export function receiptInstructionLines(value) {
  if (receiptInstructionsUnset(value)) return [...DEFAULT_RECEIPT_INSTRUCTIONS];
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Text to show in Settings: defaults when unset, otherwise the saved value. */
export function receiptInstructionsEditorValue(value) {
  if (receiptInstructionsUnset(value)) return DEFAULT_RECEIPT_INSTRUCTIONS_TEXT;
  return String(value);
}

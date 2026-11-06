// Issue #16: compare a typed confirmation name the way a person means it.
// Phones change what you type: auto-capital first letter, curly quotes (’ “), extra or
// non-breaking spaces. Those must not block a correct confirmation.
export function normalizeConfirmName(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032`´]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, ' ')
    .trim()
    .toLowerCase();
}
export const confirmNameMatches = (typed, name) => !!normalizeConfirmName(name) && normalizeConfirmName(typed) === normalizeConfirmName(name);

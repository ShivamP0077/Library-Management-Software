// Issue #16: task requires an exact confirmation, not a fuzzy one.
// Only leading/trailing whitespace is ignored; case, quotes and internal spacing must match.
export function normalizeConfirmName(s) {
  return String(s ?? '').trim();
}

export const confirmNameMatches = (typed, name) => {
  const expected = String(name ?? '').trim();
  return expected.length > 0 && String(typed ?? '').trim() === expected;
};

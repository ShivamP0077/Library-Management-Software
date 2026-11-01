// Seat Type Utilities and Canonical Resolution

export const normalizeSeatTypeName = (name) => {
  return String(name || '').trim().toLowerCase();
};

export const getCanonicalSeatTypes = (seatTypes = []) => {
  const seen = new Set();
  const canonical = [];
  for (const st of seatTypes || []) {
    if (!st || st.active === false) continue;
    const normName = normalizeSeatTypeName(st.name);
    if (!normName) continue;
    const mode = st.allocationMode || 'Fixed';
    const key = `${normName}_${mode}`;
    if (!seen.has(key)) {
      seen.add(key);
      canonical.push(st);
    }
  }
  return canonical;
};

export const resolveCanonicalSeatType = (seatTypes = [], seatTypeRef) => {
  if (!seatTypeRef) return null;
  // 1. Direct ID match
  const byId = (seatTypes || []).find(st => st && st.id === seatTypeRef);
  if (byId) return byId;
  // 2. Normalized Name match
  const norm = normalizeSeatTypeName(seatTypeRef);
  if (!norm) return null;
  return (seatTypes || []).find(st => st && normalizeSeatTypeName(st.name) === norm) || null;
};

export const areSeatTypesEquivalent = (seatTypes = [], idA, idB) => {
  if (!idA || !idB) return false;
  if (idA === idB) return true;
  const stA = resolveCanonicalSeatType(seatTypes, idA);
  const stB = resolveCanonicalSeatType(seatTypes, idB);
  if (!stA || !stB) return false;
  return (
    normalizeSeatTypeName(stA.name) === normalizeSeatTypeName(stB.name) &&
    (stA.allocationMode || 'Fixed') === (stB.allocationMode || 'Fixed')
  );
};

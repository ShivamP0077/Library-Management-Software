// Issues #5 and #6: group seat types and shifts under section headings.
// Read-only: everything is derived from existing fields; nothing is stored or migrated.
const secOf = (x) => x?.sectionId || x?.blockId || null;

const finish = (sections, map, shared, sharedTitle) => {
  const out = sections.filter(s => map.has(s.id)).map(s => ({ key: s.id, title: s.name || 'Section', items: map.get(s.id) }));
  // Items linked to a section id we don't list (other branch / deleted section) fall back to shared.
  for (const [id, items] of map) if (!sections.some(s => s.id === id)) for (const it of items) if (!shared.includes(it)) shared.push(it);
  if (shared.length) out.push({ key: '__shared', title: sharedTitle, items: shared });
  return out;
};

// Seat type -> section: the type's own sectionId, else the sections of its seats. No section: "All sections".
export function groupSeatTypesBySection(seatTypes = [], seats = [], sections = []) {
  const map = new Map(); const shared = [];
  for (const st of seatTypes) {
    const own = secOf(st);
    const ids = own ? [own] : [...new Set(seats.filter(s => s.seatTypeId === st.id).map(secOf).filter(Boolean))];
    if (!ids.length) { shared.push({ item: st, seatCount: seats.filter(s => s.seatTypeId === st.id).length }); continue; }
    for (const id of ids) {
      const seatCount = seats.filter(s => s.seatTypeId === st.id && (own || secOf(s) === id)).length;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push({ item: st, seatCount });
    }
  }
  return finish(sections, map, shared, 'All sections');
}

// Shift -> section: the sections of the plans that use it. Used by section-less plans or unused: "All sections".
export function groupShiftsBySection(shifts = [], plans = [], sections = []) {
  const map = new Map(); const shared = [];
  for (const sh of shifts) {
    const using = plans.filter(p => (p.shiftIds || []).includes(sh.id));
    const ids = [...new Set(using.map(secOf).filter(Boolean))];
    const inShared = !using.length || using.some(p => !secOf(p));
    if (inShared) shared.push({ item: sh });
    for (const id of ids) { if (!map.has(id)) map.set(id, []); map.get(id).push({ item: sh }); }
  }
  return finish(sections, map, shared, 'All sections');
}

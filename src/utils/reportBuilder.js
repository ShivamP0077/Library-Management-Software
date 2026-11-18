// Custom report builder: approved sections only, date presets, branch/section scope.
// Seat Revenue and Seat Expenses are intentionally absent and rejected if requested.

export const REPORT_SECTIONS = [
  { id: 'payments', label: 'All Student Payments' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'net', label: 'Net Profit' },
  { id: 'newStudents', label: 'New Students' },
  { id: 'studentList', label: 'Student List + Seat Numbers' },
  { id: 'cancelled', label: 'Cancelled Students' },
];

const SECTION_IDS = new Set(REPORT_SECTIONS.map(s => s.id));

export function reportSectionById(id) {
  return REPORT_SECTIONS.find(s => s.id === id) || null;
}

/** Throws if any id is unknown. Empty input means every approved section. */
export function parseReportSections(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!raw.length) return REPORT_SECTIONS.map(s => s.id);
  const unknown = raw.filter(id => !SECTION_IDS.has(id));
  if (unknown.length) {
    const err = new Error(`Unknown report section: ${unknown.join(', ')}`);
    err.code = 'unknown_section';
    throw err;
  }
  return [...new Set(raw)];
}

const pad = (n) => String(n).padStart(2, '0');
export const toIsoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function parseIso(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function addDays(iso, days) {
  const p = parseIso(iso);
  if (!p) return iso;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIsoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** preset: last7 | thisMonth | lastMonth | last2Months | quarter | year | custom */
export function resolveDateRange(preset, { today, from, to } = {}) {
  const end = today || to || new Date().toISOString().slice(0, 10);
  const p = parseIso(end) || { y: 1970, m: 1, d: 1 };
  const name = preset || 'custom';
  if (name === 'custom' || !preset) {
    return { preset: 'custom', from: from || toIsoDate(p.y, p.m, 1), to: to || end };
  }
  if (name === 'last7') return { preset: name, from: addDays(end, -6), to: end };
  if (name === 'thisMonth') return { preset: name, from: toIsoDate(p.y, p.m, 1), to: end };
  if (name === 'lastMonth') {
    const m = p.m === 1 ? 12 : p.m - 1;
    const y = p.m === 1 ? p.y - 1 : p.y;
    return { preset: name, from: toIsoDate(y, m, 1), to: toIsoDate(y, m, lastDayOfMonth(y, m)) };
  }
  if (name === 'last2Months') {
    let m = p.m - 2;
    let y = p.y;
    while (m <= 0) { m += 12; y -= 1; }
    const endM = p.m === 1 ? 12 : p.m - 1;
    const endY = p.m === 1 ? p.y - 1 : p.y;
    return { preset: name, from: toIsoDate(y, m, 1), to: toIsoDate(endY, endM, lastDayOfMonth(endY, endM)) };
  }
  if (name === 'quarter') {
    const qStart = Math.floor((p.m - 1) / 3) * 3 + 1;
    return { preset: name, from: toIsoDate(p.y, qStart, 1), to: end };
  }
  if (name === 'year') return { preset: name, from: toIsoDate(p.y, 1, 1), to: end };
  const err = new Error(`Unknown date preset: ${name}`);
  err.code = 'unknown_preset';
  throw err;
}

export function inDateRange(date, from, to) {
  const d = String(date || '');
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** A cost with no branch, or branch "all" / "shared", belongs to the library once. */
export function isSharedScope(id) {
  return !id || id === 'all' || id === 'shared';
}

/**
 * Specific branch/section: only rows for that id.
 * Shared rows are included only when the filter is All, so they are never added once per branch.
 */
export function matchesScope(rowId, filterId) {
  if (!filterId || filterId === 'all') return true;
  if (isSharedScope(rowId)) return false;
  return rowId === filterId;
}

export function branchFilterState(branches) {
  const list = (branches || []).filter(b => b && b.id && b.id !== 'all');
  if (list.length <= 1) {
    return { locked: true, options: list, value: list[0]?.id || 'all', allowAll: false };
  }
  return { locked: false, options: list, value: 'all', allowAll: true };
}

export function sectionFilterState(sections, branchId) {
  const list = (sections || []).filter(s => {
    if (!s || !s.id) return false;
    if (!branchId || branchId === 'all') return true;
    return !s.branchId || s.branchId === 'all' || s.branchId === branchId;
  });
  if (list.length <= 1) {
    return { locked: true, options: list, value: list[0]?.id || 'all', allowAll: false };
  }
  return { locked: false, options: list, value: 'all', allowAll: true };
}

/** Collection, Refund, or Cancellation. Voided receipts stay labelled Voided. */
export function paymentKind(p) {
  if (!p) return 'Collection';
  if (p.voided === true || p.status === 'Voided') return 'Voided';
  const method = String(p.method || '').toLowerCase();
  if (method === 'cancellation' || p.kind === 'cancellation') return 'Cancellation';
  if (method === 'refund' || Number(p.netTotal ?? p.amount ?? 0) < 0) return 'Refund';
  return 'Collection';
}

export function studentJoinDate(s) {
  return s?.startDate || s?.admissionDate || s?.joinedOn || '';
}

export function cancellationDetail(student) {
  const hist = Array.isArray(student?.cancellationHistory) ? student.cancellationHistory[0] : null;
  const refund = Number(student?.refundAmount ?? hist?.refundAmount ?? 0);
  return {
    date: student?.cancelledDate || hist?.date || studentJoinDate(student),
    reason: student?.cancelReason || hist?.reason || '',
    refundAmount: refund,
    outcome: refund > 0 ? 'Cancellation with refund' : 'Cancellation',
  };
}

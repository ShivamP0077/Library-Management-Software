// Seat Map view colours and payment classification (Phase 1).
// Occupancy still treats only Active and Expiring Soon as holding a desk.
// That rule lives in SeatMap.jsx and is not changed here.

export const SEAT_MAP_VIEWS = [
  { id: 'occupancy', label: 'Occupancy' },
  { id: 'payment', label: 'Payment' },
  { id: 'photo', label: 'Photo' },
];

export const SEAT_COLORS = {
  occupancy: {
    male: '#2563eb',
    female: '#db2777',
    vacant: '#16a34a',
    maintenance: '#d97706',
    unavailable: '#64748b',
  },
  payment: {
    paid: '#16a34a',
    unpaid: '#dc2626',
    mixed: '#eab308',
    unassigned: '#9ca3af',
  },
};

const UNPAID = new Set(['unpaid', 'pending', 'due', 'partial', 'overdue']);

export function occupantPaymentState(student) {
  if (!student) return 'unassigned';
  const explicit = String(student.paymentStatus || student.feeStatus || '').trim().toLowerCase();
  if (UNPAID.has(explicit)) return 'unpaid';
  if (explicit === 'paid' || explicit === 'settled') return 'paid';
  const due = Number(student.dueAmount ?? student.balanceDue ?? student.pendingAmount ?? 0);
  if (Number.isFinite(due) && due > 0) return 'unpaid';
  const history = Array.isArray(student.paymentHistory) ? student.paymentHistory : [];
  const open = history.some((p) => p && !p.voided && UNPAID.has(String(p.status || '').trim().toLowerCase()));
  if (open) return 'unpaid';
  return 'paid';
}

export function deskPaymentState(occupants) {
  if (!occupants || occupants.length === 0) return 'unassigned';
  const states = new Set(occupants.map(occupantPaymentState));
  if (states.size > 1) return 'mixed';
  return [...states][0];
}

export function paymentStatusClass(state) {
  if (state === 'paid') return 'seat-paid';
  if (state === 'unpaid') return 'seat-unpaid';
  if (state === 'mixed') return 'seat-mixed';
  return 'seat-unassigned';
}

export function occupancyStatusClass({ isUnavailable, isMaintenance, isOccupied, gender }) {
  if (isUnavailable) return 'seat-unavailable';
  if (isMaintenance) return 'seat-maintenance';
  if (isOccupied) return gender === 'Female' ? 'seat-occupied-female' : 'seat-occupied-male';
  return 'seat-available';
}

export function filterPhotoTiles(tiles, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return tiles || [];
  return (tiles || []).filter((t) => {
    const name = String(t.name || '').toLowerCase();
    const desk = String(t.desk ?? t.seatNo ?? '').toLowerCase();
    const id = String(t.id || '').toLowerCase();
    return name.includes(q) || desk.includes(q) || id.includes(q);
  });
}

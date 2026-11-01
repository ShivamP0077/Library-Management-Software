/**
 * Seat safety (spec §3.2, SEAT-01/02).
 *
 * Source of truth for "who sits where" on the server: one SeatAllocation per
 * active seated student. Concurrency safety comes from a per-seat lease
 * (SeatLock) whose uniqueness is enforced by a unique index on
 * { tenantId, seatKey }: only one request can hold the lease for a seat, and
 * the overlap check + insert happen while it is held. Two simultaneous
 * requests for the same incompatible seat therefore resolve to exactly one
 * success and one 409 conflict. Everything is tenant-scoped.
 */
import mongoose from 'mongoose';
import express from 'express';
import crypto from 'crypto';
import tenantGuard, { applyBulkWriteGuard } from './tenantGuard.js';
import { models } from './models.js';

const allocSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  seatKey: { type: String, required: true },    // `${branchId}|${seatNo}`
  seatNo: String,
  branchId: String,
  studentId: { type: String, required: true },
  shift: { id: String, name: String, startTime: String, endTime: String, daysOfWeek: [String] },
  status: { type: String, enum: ['active', 'released'], default: 'active' },
  releasedAt: Date,
  releaseReason: String,
  createdBy: String,
}, { timestamps: true });
// A student holds at most one active seat (partial unique index).
allocSchema.index({ tenantId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
allocSchema.index({ tenantId: 1, seatKey: 1, status: 1 });
allocSchema.plugin(tenantGuard);
export const SeatAllocation = applyBulkWriteGuard(mongoose.models.SeatAllocation || mongoose.model('SeatAllocation', allocSchema));

const lockSchema = new mongoose.Schema({
  tenantId: { type: String, required: true },
  seatKey: { type: String, required: true },
  token: String,
  expiresAt: Date,
});
lockSchema.index({ tenantId: 1, seatKey: 1 }, { unique: true });
lockSchema.plugin(tenantGuard);
export const SeatLock = applyBulkWriteGuard(mongoose.models.SeatLock || mongoose.model('SeatLock', lockSchema));

export class SeatConflictError extends Error {
  constructor(message, details = {}) { super(message); this.status = 409; this.code = 'seat_conflict'; this.details = details; }
}

/* ------------------------------------------------------------------ shifts */
const norm = (s) => String(s || '').trim().toLowerCase();
const isFullDay = (sh) => { const n = norm(sh?.name); return /full ?-?day|24 hours/.test(n); };
const times = (sh) => {
  if (sh?.startTime && sh?.endTime) return [sh.startTime, sh.endTime];
  const m = String(sh?.name || '').match(/(\d{1,2}:\d{2})\s*(?:-|to)\s*(\d{1,2}:\d{2})/i);
  return m ? [m[1].padStart(5, '0'), m[2].padStart(5, '0')] : [null, null];
};
/** Mirrors src/utils/shiftUtils.js shiftsOverlap so UI and server agree. */
export function shiftsOverlap(a, b) {
  if (!a || !b) return true; // unknown shift = whole seat (safe default)
  if (a.id && b.id && a.id === b.id) return true;
  const da = a.daysOfWeek || [], db = b.daysOfWeek || [];
  if (da.length && db.length && !da.some(d => db.includes(d))) return false;
  if (isFullDay(a) || isFullDay(b)) return true;
  const [sa, ea] = times(a), [sb, eb] = times(b);
  if (sa && ea && sb && eb) return sa < eb && sb < ea;
  if (!a.name && !b.name) return true;
  return norm(a.name) === norm(b.name);
}

/* ------------------------------------------------------------------ helpers */
export const ACTIVE_STATUSES = ['Active', 'Expiring Soon'];
export const isPhysicalSeat = (seatNo) => { const k = String(seatNo ?? '').trim(); return Boolean(k) && k !== 'Non-Fixed Seat' && k !== 'None'; };
export const seatKeyOf = (branchId, seatNo) => `${branchId || ''}|${String(seatNo ?? '').trim()}`;
export const occupiesSeat = (st) => st && ACTIVE_STATUSES.includes(st.status) && isPhysicalSeat(st.seatNo);

export async function resolveShift(tenantId, student) {
  const shifts = await models.shifts.find({ tenantId }).lean();
  const sh = shifts.find(s => s.id && s.id === student.shiftId) || shifts.find(s => student.shift && norm(s.name) === norm(student.shift));
  if (sh) return { id: sh.id, name: sh.name, startTime: sh.startTime, endTime: sh.endTime, daysOfWeek: sh.daysOfWeek || [] };
  if (student.shiftId || student.shift) return { id: student.shiftId, name: student.shift };
  return null;
}

/** Finds the seat record for a student's seat number within the branch (exact match). */
async function findSeat(tenantId, branchId, seatNo) {
  const key = String(seatNo).trim();
  const q = { tenantId, $or: [{ name: key }, { seatNumber: key }] };
  const seats = await models.seats.find(q).lean();
  return seats.find(s => !branchId || !s.branchId || s.branchId === 'all' || s.branchId === branchId) || null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Acquires the per-seat lease (unique index), retrying briefly. */
async function withSeatLock(tenantId, seatKey, fn) {
  const token = crypto.randomBytes(8).toString('hex');
  let acquired = false;
  for (let i = 0; i < 40 && !acquired; i++) {
    try {
      const now = new Date();
      const r = await SeatLock.findOneAndUpdate(
        { tenantId, seatKey, $or: [{ expiresAt: { $lt: now } }, { expiresAt: null }] },
        { $set: { token, expiresAt: new Date(now.getTime() + 10000) } },
        { upsert: true, new: true, lean: true });
      acquired = r?.token === token;
    } catch (e) {
      if (e?.code !== 11000) throw e; // someone else holds it
    }
    if (!acquired) await sleep(15 + Math.random() * 35);
  }
  if (!acquired) throw new SeatConflictError('This seat is being booked by someone else right now. Please try again.');
  try { return await fn(); } finally { await SeatLock.deleteOne({ tenantId, seatKey, token }); }
}

export async function releaseAllocation(tenantId, id, reason) {
  await SeatAllocation.updateOne({ tenantId, _id: id, status: 'active' }, { $set: { status: 'released', releasedAt: new Date(), releaseReason: reason } });
}

const sameShift = (a, b) => (a?.id || '') === (b?.id || '') && norm(a?.name) === norm(b?.name) && (a?.startTime || '') === (b?.startTime || '') && (a?.endTime || '') === (b?.endTime || '');

/**
 * Moves/assigns a student atomically: the new seat is claimed first; the old
 * allocation is released only after that succeeds; on failure nothing changes.
 * The partial unique index on { tenantId, studentId, status:active } means we
 * must release-then-insert, so we do it inside the target seat lease and
 * restore the old allocation if the insert fails.
 */
export async function assignStudent(tenantId, student, { actor, force = false, reason = 'relocated' } = {}) {
  const sid = String(student.id);
  const current = await SeatAllocation.findOne({ tenantId, studentId: sid, status: 'active' }).lean();
  if (!occupiesSeat(student)) {
    if (current) await releaseAllocation(tenantId, current._id, student.status === 'Archived' || !ACTIVE_STATUSES.includes(student.status) ? 'student inactive' : 'seat removed');
    return null;
  }
  const shift = await resolveShift(tenantId, student);
  const seatKey = seatKeyOf(student.branchId, student.seatNo);
  if (current && current.seatKey === seatKey && sameShift(current.shift, shift || {})) return current;
  return withSeatLock(tenantId, seatKey, async () => {
    if (!force) {
      const seat = await findSeat(tenantId, student.branchId, student.seatNo);
      if (seat && (seat.isMaintenance || seat.isUnavailable || seat.status === 'maintenance')) {
        throw new SeatConflictError(`Seat ${student.seatNo} is under maintenance and cannot be allocated.`, { seatNo: student.seatNo, studentId: sid });
      }
      const others = await SeatAllocation.find({ tenantId, seatKey, status: 'active', studentId: { $ne: sid } }).lean();
      const clash = others.find(o => shiftsOverlap(o.shift && (o.shift.name || o.shift.id) ? o.shift : null, shift));
      if (clash) throw new SeatConflictError(`Seat ${student.seatNo} is already taken by another student for an overlapping shift.`, { seatNo: student.seatNo, studentId: sid, conflictWith: clash.studentId });
    }
    if (current) await releaseAllocation(tenantId, current._id, reason);
    try {
      return (await SeatAllocation.create({ tenantId, seatKey, seatNo: String(student.seatNo).trim(), branchId: student.branchId, studentId: sid, shift: shift || undefined, createdBy: actor, status: 'active' })).toObject();
    } catch (e) {
      if (current) await SeatAllocation.updateOne({ tenantId, _id: current._id }, { $set: { status: 'active' }, $unset: { releasedAt: 1, releaseReason: 1 } });
      if (e?.code === 11000) throw new SeatConflictError('This student was just assigned a seat by someone else. Refresh and try again.');
      throw e;
    }
  });
}

/**
 * Reconciles allocations for a batch of student documents before they are
 * persisted. Changed students are validated; unchanged legacy students are
 * backfilled without validation so existing data never blocks saving.
 * On any conflict every change made by this call is rolled back.
 */
export async function reconcileStudents(tenantId, students, { actor, previous = new Map() } = {}) {
  const undo = [];
  const restore = async () => {
    for (const { before, after } of undo.reverse()) {
      if (after) await SeatAllocation.deleteOne({ tenantId, _id: after._id });
      if (before) await SeatAllocation.updateOne({ tenantId, _id: before._id }, { $set: { status: 'active' }, $unset: { releasedAt: 1, releaseReason: 1 } });
    }
  };
  const rows = students.filter(st => st && st.id != null).map(st => {
    const prev = previous.get(String(st.id));
    const unchanged = Boolean(prev) && prev.seatNo === st.seatNo && prev.branchId === st.branchId && (prev.shiftId || '') === (st.shiftId || '') && (prev.shift || '') === (st.shift || '') && prev.status === st.status;
    return { st, unchanged };
  });
  try {
    // Pass 1: changed students give up seats they are leaving (enables swaps in one save).
    for (const { st, unchanged } of rows) {
      if (unchanged) continue;
      const cur = await SeatAllocation.findOne({ tenantId, studentId: String(st.id), status: 'active' }).lean();
      if (!cur) continue;
      if (occupiesSeat(st) && cur.seatKey === seatKeyOf(st.branchId, st.seatNo) && sameShift(cur.shift, (await resolveShift(tenantId, st)) || {})) continue;
      await releaseAllocation(tenantId, cur._id, occupiesSeat(st) ? 'relocated' : 'seat released');
      undo.push({ before: cur, after: null });
    }
    // Pass 2: claim (validated for changed students, backfill for unchanged legacy rows).
    for (const { st, unchanged } of rows) {
      const before = await SeatAllocation.findOne({ tenantId, studentId: String(st.id), status: 'active' }).lean();
      const after = await assignStudent(tenantId, st, { actor, force: unchanged });
      if (after && before && String(after._id) === String(before._id)) continue;
      if (after || before) undo.push({ before, after });
    }
  } catch (e) {
    await restore();
    throw e;
  }
}

/** Students whose documents are being removed lose their seat. */
export async function releaseForStudents(tenantId, studentIds, reason = 'student removed') {
  if (!studentIds.length) return;
  await SeatAllocation.updateMany({ tenantId, studentId: { $in: studentIds.map(String) }, status: 'active' }, { $set: { status: 'released', releasedAt: new Date(), releaseReason: reason } });
}

/** Seats that must not be deleted or put under maintenance (active assignments). */
export async function occupiedSeatKeys(tenantId) {
  const rows = await SeatAllocation.find({ tenantId, status: 'active' }, { seatKey: 1, seatNo: 1, branchId: 1, studentId: 1 }).lean();
  return rows;
}

export function seatMatchesAllocation(seat, alloc) {
  const name = String(seat.name ?? seat.seatNumber ?? '').trim();
  if (name !== alloc.seatNo) return false;
  return !seat.branchId || seat.branchId === 'all' || !alloc.branchId || seat.branchId === alloc.branchId;
}

/**
 * Validates a seat-collection sync: a seat with an active allocation cannot be
 * removed or switched to maintenance/unavailable. Throws SeatConflictError.
 */
export async function validateSeatSync(tenantId, nextSeats) {
  const allocs = await occupiedSeatKeys(tenantId);
  if (!allocs.length) return;
  const current = await models.seats.find({ tenantId }).lean();
  const nextById = new Map(nextSeats.filter(Boolean).map(s => [String(s.id), s]));
  for (const seat of current) {
    const holders = allocs.filter(a => seatMatchesAllocation(seat, a));
    if (!holders.length) continue;
    const next = nextById.get(String(seat.id));
    const stillThere = next || nextSeats.some(s => s && seatMatchesAllocation(s, holders[0]));
    if (!stillThere) throw new SeatConflictError(`Seat ${seat.name} has an active student. Move the student to another seat before removing it.`, { seatNo: seat.name });
    if (next && (next.isMaintenance || next.isUnavailable) && !(seat.isMaintenance || seat.isUnavailable)) {
      throw new SeatConflictError(`Seat ${seat.name} has an active student. Move the student before marking it under maintenance.`, { seatNo: seat.name });
    }
  }
}

/* ------------------------------------------------------------------ routes */

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicAlloc = (a) => ({ id: String(a._id), seatNo: a.seatNo, branchId: a.branchId, studentId: a.studentId, shift: a.shift, status: a.status, createdAt: a.createdAt, releasedAt: a.releasedAt, releaseReason: a.releaseReason });

export function createSeatRouter() {
  const r = express.Router();
  r.get('/seat-allocations', wrap(async (req, res) => {
    const q = { tenantId: req.tenantId, status: req.query.status === 'all' ? { $in: ['active', 'released'] } : (req.query.status || 'active') };
    if (req.query.studentId) q.studentId = String(req.query.studentId);
    res.json((await SeatAllocation.find(q).sort({ createdAt: -1 }).limit(2000).lean()).map(publicAlloc));
  }));

  // Assign or relocate a student (target validated before the old seat is released).
  r.post('/seat-allocations/assign', wrap(async (req, res) => {
    const { studentId, seatNo, branchId, shiftId, shift } = req.body || {};
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    const Student = models.students;
    const prev = await Student.findOne({ tenantId: req.tenantId, _key: String(studentId) }).lean();
    if (!prev) return res.status(404).json({ error: 'Student not found' });
    const next = { ...prev, id: prev.id ?? prev._key };
    if (seatNo !== undefined) next.seatNo = seatNo;
    if (branchId !== undefined) next.branchId = branchId;
    if (shiftId !== undefined) next.shiftId = shiftId;
    if (shift !== undefined) next.shift = shift;
    if (next.branchId) {
      const branchCount = await models.branches.countDocuments({ tenantId: req.tenantId });
      if (branchCount && !(await models.branches.exists({ tenantId: req.tenantId, _key: String(next.branchId) })) && next.branchId !== 'all') {
        return res.status(400).json({ error: 'Target branch does not exist' });
      }
    }
    await reconcileStudents(req.tenantId, [next], { actor: req.user.email });
    const set = { seatNo: next.seatNo, branchId: next.branchId, shiftId: next.shiftId, shift: next.shift };
    const doc = await Student.findOneAndUpdate({ tenantId: req.tenantId, _key: String(studentId) }, { $set: set }, { new: true, lean: true });
    const alloc = await SeatAllocation.findOne({ tenantId: req.tenantId, studentId: String(studentId), status: 'active' }).lean();
    res.json({ student: { ...doc, _id: undefined, tenantId: undefined, libraryId: req.tenantId }, allocation: alloc && publicAlloc(alloc) });
  }));

  // Toggle maintenance for a seat; refused while a student is assigned.
  r.patch('/seats/:key/maintenance', wrap(async (req, res) => {
    const on = Boolean(req.body?.isMaintenance);
    const seat = await models.seats.findOne({ tenantId: req.tenantId, _key: req.params.key }).lean();
    if (!seat) return res.status(404).json({ error: 'Seat not found' });
    if (on) {
      const held = (await SeatAllocation.find({ tenantId: req.tenantId, status: 'active' }).lean()).some(a => seatMatchesAllocation(seat, a));
      if (held) throw new SeatConflictError(`Seat ${seat.name} has an active student. Move the student before marking it under maintenance.`, { seatNo: seat.name });
    }
    await models.seats.updateOne({ tenantId: req.tenantId, _key: req.params.key }, { $set: { isMaintenance: on } });
    res.json({ ok: true, id: req.params.key, isMaintenance: on });
  }));
  return r;
}

/**
 * Students, history and capacity invariants (spec §3.1, STU-01).
 * - Status: Active / Expiring Soon / Expired derive from expiryDate; Archived lives in archivedStudents.
 * - Capacity counts active + expired (the students collection), never archived/deleted.
 * - Every admission, renewal, seat/shift/branch/plan change, archive, restore and
 *   permanent delete is recorded as an immutable StudentEvent (history is never rewritten).
 * - Permanent delete keeps a snapshot + audit entry; payments are never deleted with the student.
 */
import mongoose from 'mongoose';
import express from 'express';
import tenantGuard, { applyBulkWriteGuard } from './tenantGuard.js';
import { models, Library, clean } from './models.js';
import { audit } from './audit.js';
import { todayIn } from './finance.js';

const eventSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  studentId: { type: String, required: true },
  type: { type: String, required: true }, // admitted|renewed|seat_changed|shift_changed|branch_changed|plan_changed|archived|restored|permanently_deleted
  actor: String,
  detail: mongoose.Schema.Types.Mixed,
  snapshot: mongoose.Schema.Types.Mixed, // only for permanent deletes (retained record)
  at: { type: Date, default: Date.now },
}, { versionKey: false });
eventSchema.index({ tenantId: 1, studentId: 1, at: -1 });
eventSchema.plugin(tenantGuard);
export const StudentEvent = applyBulkWriteGuard(mongoose.models.StudentEvent || mongoose.model('StudentEvent', eventSchema));

export class CapacityError extends Error {
  constructor(limit, count) { super(`Student limit reached (${count}/${limit}). Archive a student or ask your administrator to raise the limit.`); this.status = 409; this.code = 'capacity_exceeded'; this.details = { limit, count }; }
}

/** Single definition of student status used by the server. */
export function studentStatus(s, today = todayIn(), soonDays = 3) {
  if (!s) return null;
  if (s.status === 'Archived') return 'Archived';
  const exp = s.expiryDate || s.endDate;
  if (!exp) return s.status || 'Active';
  if (exp < today) return 'Expired';
  const days = Math.round((Date.parse(exp) - Date.parse(today)) / 864e5);
  return days <= soonDays ? 'Expiring Soon' : 'Active';
}

export async function studentLimit(tenantId) {
  const lib = await Library.findOne({ libraryId: tenantId }).lean();
  return lib?.studentLimit > 0 ? lib.studentLimit : null;
}

/** Reject only when the count grows past the limit (existing over-limit data never blocks edits). */
export async function checkCapacity(tenantId, nextCount, prevCount) {
  const limit = await studentLimit(tenantId);
  if (limit && nextCount > limit && nextCount > prevCount) throw new CapacityError(limit, nextCount);
}

const TRACKED = [['seatNo', 'seat_changed'], ['shiftId', 'shift_changed'], ['branchId', 'branch_changed'], ['planId', 'plan_changed']];
const expiry = (s) => s?.expiryDate || s?.endDate || null;

/** Diff the students collection and record events. `prev` = Map(key -> old doc). */
export async function recordStudentDiff(tenantId, prev, incoming, actor) {
  const archivedKeys = new Set((await models.archivedStudents.find({ tenantId }).lean()).map(d => d._key));
  const newIds = incoming.map(s => String(s.id)).filter(id => !prev.has(id));
  if (newIds.length) (await StudentEvent.find({ tenantId, studentId: { $in: newIds }, type: 'archived' }).lean()).forEach(e => archivedKeys.add(e.studentId));
  const events = [];
  for (const s of incoming) {
    const id = String(s.id);
    const old = prev.get(id);
    if (!old) { events.push({ studentId: id, type: archivedKeys.has(id) ? 'restored' : 'admitted', detail: { seatNo: s.seatNo ?? null, shiftId: s.shiftId ?? null, branchId: s.branchId ?? null, expiryDate: expiry(s) } }); continue; }
    if (expiry(s) && expiry(old) && expiry(s) > expiry(old)) events.push({ studentId: id, type: 'renewed', detail: { from: expiry(old), to: expiry(s) } });
    for (const [f, type] of TRACKED) if ((old[f] ?? null) !== (s[f] ?? null)) events.push({ studentId: id, type, detail: { from: old[f] ?? null, to: s[f] ?? null } });
  }
  if (events.length) await StudentEvent.insertMany(events.map(e => ({ ...e, tenantId, actor })));
  return events.length;
}

/** Diff archivedStudents. New → archived. Removed and back in students → (restore already logged). Removed otherwise → snapshot + audit (true permanent delete goes through DELETE /archived-students/:id). */
export async function recordArchiveDiff(req, prevDocs, incoming) {
  const tenantId = req.tenantId;
  const prevKeys = new Map(prevDocs.map(d => [d._key, d]));
  const inKeys = new Set(incoming.map(s => String(s.id)));
  const activeKeys = new Set((await models.students.find({ tenantId }).lean()).map(d => d._key));
  const events = [];
  for (const s of incoming) if (!prevKeys.has(String(s.id))) events.push({ studentId: String(s.id), type: 'archived', detail: { reason: s.cancellationHistory?.[0]?.reason || null } });
  for (const [k, d] of prevKeys) {
    if (inKeys.has(k) || activeKeys.has(k)) continue;
    // May be a restore whose students sync has not landed yet, so keep a snapshot instead of assuming a delete.
    events.push({ studentId: k, type: 'removed_from_archive', snapshot: clean(d) });
    await audit(req, 'student.archive_record_removed', { target: k, detail: { name: d.name } });
  }
  if (events.length) await StudentEvent.insertMany(events.map(e => ({ ...e, tenantId, actor: req.user.email })));
}

export function createStudentRouter() {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  r.get('/students-summary', wrap(async (req, res) => {
    const today = todayIn();
    const branch = req.query.branchId && req.query.branchId !== 'all' ? String(req.query.branchId) : null;
    const filter = { tenantId: req.tenantId, ...(branch ? { branchId: branch } : {}) };
    const list = await models.students.find(filter).lean();
    const archived = await models.archivedStudents.countDocuments(filter);
    const by = { Active: 0, 'Expiring Soon': 0, Expired: 0 };
    for (const s of list) by[studentStatus(s, today)] = (by[studentStatus(s, today)] || 0) + 1;
    const all = branch ? await models.students.countDocuments({ tenantId: req.tenantId }) : list.length;
    res.json({ active: by.Active + by['Expiring Soon'], expiringSoon: by['Expiring Soon'], expired: by.Expired, archived, capacity: { used: all, limit: await studentLimit(req.tenantId), counts: 'active + expired (archived excluded)' } });
  }));

  r.get('/students/:id/history', wrap(async (req, res) => {
    const ev = await StudentEvent.find({ tenantId: req.tenantId, studentId: String(req.params.id) }).sort({ at: -1 }).lean();
    res.json(ev.map(e => ({ type: e.type, at: e.at, actor: e.actor, detail: e.detail })));
  }));

  /** Explicit, confirmed permanent delete of an archived student (payments are kept). */
  r.delete('/archived-students/:id', wrap(async (req, res) => {
    if (!['client_admin', 'superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Only the owner can permanently delete' });
    if (String(req.body?.confirm || '') !== String(req.params.id)) return res.status(400).json({ error: 'Type the student ID to confirm permanent deletion', code: 'confirmation_required' });
    const d = await models.archivedStudents.findOne({ tenantId: req.tenantId, _key: String(req.params.id) }).lean();
    if (!d) return res.status(404).json({ error: 'Not found' });
    await StudentEvent.create({ tenantId: req.tenantId, studentId: d._key, type: 'permanently_deleted', actor: req.user.email, snapshot: clean(d) });
    await models.archivedStudents.deleteOne({ tenantId: req.tenantId, _key: d._key });
    await audit(req, 'student.permanent_delete', { target: d._key, reason: req.body?.reason, detail: { name: d.name } });
    res.json({ ok: true, paymentsRetained: await models.payments.countDocuments({ tenantId: req.tenantId, studentId: d._key }) });
  }));
  return r;
}

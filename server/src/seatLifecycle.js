/**
 * Daily occupy release and auto-cancel. Idempotent.
 * Uses the same lifecycle, snapshots, and timezone as the seat map.
 */
import { models, Settings, Library } from './models.js';
import { todayIn } from './finance.js';
import { releaseForStudents } from './seats.js';
import { StudentEvent } from './students.js';
import { subscriptionLifecycle } from '../../src/utils/subscriptionLifecycle.js';

const AUTO_REASON = 'Automatic cancellation after the expired period (not renewed).';

export async function billingSettings(tenantId) {
  return (await Settings.findOne({ tenantId }).lean()) || {};
}

export async function runLibrarySeatLifecycle(tenantId, { today = todayIn() } = {}) {
  const settings = await billingSettings(tenantId);
  const students = await models.students.find({ tenantId }).lean();
  let released = 0;
  let cancelled = 0;
  for (const raw of students) {
    const student = { ...raw, id: raw.id || raw._key };
    const life = subscriptionLifecycle(student, { settings, today });
    if (!life.holdsDesk) {
      const before = await models.students.countDocuments({ tenantId, _key: String(student.id) });
      await releaseForStudents(tenantId, [student.id], life.status === 'Expired' ? 'expired — desk released' : 'student inactive');
      if (before) released += 1;
    }
    if (life.status === 'Expired' && life.autoCancelDate && life.autoCancelDate <= today) {
      if (await autoCancelStudent(tenantId, student, life, today)) cancelled += 1;
    }
  }
  return { released, cancelled, today };
}

async function autoCancelStudent(tenantId, student, life, today) {
  const studentId = String(student.id);
  const eventFilter = { tenantId, studentId, type: 'auto_cancelled', 'detail.autoCancelDate': life.autoCancelDate };
  const already = await StudentEvent.exists(eventFilter);
  const record = {
    id: `CANC-AUTO-${studentId}-${life.autoCancelDate}`,
    reason: AUTO_REASON,
    refundAmount: 0,
    date: today,
    staffName: 'System',
    automatic: true,
    autoCancelDate: life.autoCancelDate,
  };
  const archived = {
    ...student,
    id: studentId,
    status: 'Cancelled',
    cancellationHistory: [record, ...(Array.isArray(student.cancellationHistory) ? student.cancellationHistory : [])],
  };
  delete archived._id;
  if (!already) {
    await StudentEvent.create({
      tenantId,
      studentId,
      type: 'auto_cancelled',
      actor: 'system',
      detail: { reason: AUTO_REASON, date: today, autoCancelDate: life.autoCancelDate, expiryDate: student.expiryDate || null },
    });
  }
  const existingArchive = await models.archivedStudents.findOne({ tenantId, _key: studentId }).lean();
  if (!existingArchive) {
    await models.archivedStudents.create({ ...archived, _key: studentId, tenantId, libraryId: tenantId });
  }
  await releaseForStudents(tenantId, [studentId], 'automatic cancellation');
  const removed = await models.students.deleteOne({ tenantId, _key: studentId });
  return !already || removed.deletedCount > 0;
}

export async function runSeatLifecycleJob(LibraryModel = Library) {
  const libs = await LibraryModel.find({ status: 'Active' }).lean();
  for (const lib of libs) {
    try { await runLibrarySeatLifecycle(lib.libraryId); }
    catch (e) { console.error('[seat-lifecycle] failed for', lib.libraryId, e.message); }
  }
}

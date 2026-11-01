/**
 * Scheduled WhatsApp fee & expiry reminders + automatic receipts (spec §6 / WA-02, non-quota parts).
 * - Plan → cancel → send, run by the daily job (idempotent; safe to retry).
 * - Fee reminders only while a due is outstanding; the text shows the live remaining amount
 *   (partial payments reflected); cancelled as soon as the due is cleared.
 * - Expiry reminders: one per student per renewal period (keyed by the expiry date), sent N days
 *   before expiry or on an owner-selected fixed day of the month; a renewal cancels the stale one.
 * - Sending goes through sendWhatsappMessage (owner toggles, consent, provider log) with the
 *   schedule key as dedupeKey, so retries never send a second (billable) message.
 * Quotas / message balance (§6 quota parts) are intentionally NOT handled here.
 */
import mongoose from 'mongoose';
import express from 'express';
import tenantGuard, { applyBulkWriteGuard } from './tenantGuard.js';
import { models, Library } from './models.js';
import { todayIn } from './finance.js';
import { WhatsappConfig, sendWhatsappMessage, buildReceiptText, canManageWhatsapp } from './whatsapp.js';
import { evolutionConfigured } from './evolution.js';

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  key: { type: String, required: true },       // also the WhatsApp dedupeKey
  studentId: { type: String, required: true },
  type: { type: String, enum: ['fee_reminder', 'expiry_reminder'], required: true },
  sendOn: { type: String, required: true },    // YYYY-MM-DD (app timezone)
  periodKey: String,                           // student's expiry date for this period
  status: { type: String, enum: ['scheduled', 'sent', 'failed', 'skipped', 'cancelled'], default: 'scheduled' },
  reason: String,
  attempts: { type: Number, default: 0 },
  sentAt: Date,
}, { timestamps: true });
schema.index({ tenantId: 1, key: 1 }, { unique: true });
schema.index({ tenantId: 1, status: 1, sendOn: 1 });
schema.plugin(tenantGuard);
export const ReminderSchedule = applyBulkWriteGuard(mongoose.models.ReminderSchedule || mongoose.model('ReminderSchedule', schema));

export const DEFAULT_REMINDER_SETTINGS = { expiryDaysBefore: 3, expiryFixedDay: null, feeEveryDays: 3, feeMaxReminders: 3 };
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dueOf = (s) => Math.max(0, Math.round(Number(s.dueAmount ?? s.balanceDue ?? 0)));
const expiryOf = (s) => s.expiryDate || s.endDate || null;
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export async function reminderSettings(tenantId) {
  const c = (await WhatsappConfig.findOne({ libraryId: tenantId }).lean()) || {};
  return { ...DEFAULT_REMINDER_SETTINGS, ...(c.reminderSettings || {}) };
}

/** Desired schedule for one student today (pure). */
export function desiredFor(s, settings, today) {
  const out = [];
  const exp = expiryOf(s);
  const id = String(s._key ?? s.id);
  if (exp && exp >= today) {
    let sendOn = addDays(exp, -Number(settings.expiryDaysBefore || 0));
    if (settings.expiryFixedDay) { // owner-selected fixed day in the expiry month (never after expiry)
      const d = String(Math.min(Number(settings.expiryFixedDay), 28)).padStart(2, '0');
      const fixed = `${exp.slice(0, 7)}-${d}`;
      sendOn = fixed <= exp ? fixed : sendOn;
    }
    out.push({ key: `expiry:${id}:${exp}`, studentId: id, type: 'expiry_reminder', sendOn: sendOn < today ? today : sendOn, periodKey: exp });
  }
  if (dueOf(s) > 0) {
    // Up to N reminders, every K days, starting today for this period; period = current expiry (or 'open').
    const period = exp || 'open';
    for (let i = 0; i < Number(settings.feeMaxReminders || 1); i++) {
      out.push({ key: `fee:${id}:${period}:${i + 1}`, studentId: id, type: 'fee_reminder', sendOn: null, periodKey: period, seq: i });
    }
  }
  return out;
}

/** Plan + cancel for a tenant. Returns {planned, cancelled}. */
export async function planReminders(tenantId, { today = todayIn() } = {}) {
  const settings = await reminderSettings(tenantId);
  const students = await models.students.find({ tenantId }).lean();
  const desired = new Map();
  for (const s of students) for (const d of desiredFor(s, settings, today)) desired.set(d.key, d);
  let planned = 0;
  // Fee reminders are anchored to the first time we saw the due (existing seq 1), then every K days.
  const existingFee = new Map((await ReminderSchedule.find({ tenantId, type: 'fee_reminder' }).lean()).map(r => [r.key, r]));
  for (const d of desired.values()) {
    let sendOn = d.sendOn;
    if (d.type === 'fee_reminder') {
      const firstKey = d.key.replace(/:\d+$/, ':1');
      const anchor = existingFee.get(firstKey)?.sendOn || today;
      sendOn = addDays(anchor, d.seq * Number(settings.feeEveryDays || 1));
    }
    try {
      const r = await ReminderSchedule.updateOne({ tenantId, key: d.key },
        { $setOnInsert: { studentId: d.studentId, type: d.type, sendOn, periodKey: d.periodKey, status: 'scheduled' } }, { upsert: true });
      planned += r.upsertedCount || 0;
    } catch (e) { if (e?.code !== 11000) throw e; }
  }
  // Cancel stale: renewed (expiry changed), due cleared, student archived/removed.
  const stale = (await ReminderSchedule.find({ tenantId, status: 'scheduled' }).lean()).filter(r => !desired.has(r.key));
  for (const r of stale) {
    const s = students.find(x => String(x._key ?? x.id) === r.studentId);
    const reason = !s ? 'student_removed' : r.type === 'fee_reminder' ? 'paid' : 'renewed';
    await ReminderSchedule.updateOne({ tenantId, _id: r._id, status: 'scheduled' }, { $set: { status: 'cancelled', reason } });
  }
  return { planned, cancelled: stale.length };
}

/** Send everything due today, re-checking live data first (latest payment status wins). */
export async function sendDueReminders(tenantId, { today = todayIn(), deps = {} } = {}) {
  const due = await ReminderSchedule.find({ tenantId, status: 'scheduled', sendOn: { $lte: today } }).lean();
  const lib = await Library.findOne({ libraryId: tenantId }).lean();
  const results = { sent: 0, skipped: 0, failed: 0, cancelled: 0 };
  for (const r of due) {
    // Claim it so two workers can't both send.
    const claimed = await ReminderSchedule.findOneAndUpdate({ tenantId, _id: r._id, status: 'scheduled' }, { $set: { status: 'skipped', reason: 'in_progress' }, $inc: { attempts: 1 } }, { new: true });
    if (!claimed) continue;
    const s = await models.students.findOne({ tenantId, _key: r.studentId }).lean();
    const stillValid = s && (r.type === 'fee_reminder' ? dueOf(s) > 0 && (expiryOf(s) || 'open') === r.periodKey : expiryOf(s) === r.periodKey);
    if (!stillValid) { await ReminderSchedule.updateOne({ tenantId, _id: r._id }, { $set: { status: 'cancelled', reason: r.type === 'fee_reminder' ? 'paid' : 'renewed' } }); results.cancelled++; continue; }
    const text = r.type === 'fee_reminder'
      ? `Hi ${s.name || 'there'}, a fee of ${money(dueOf(s))} is pending at ${lib?.name || 'the library'}. Please pay at the desk. Ignore if already paid.`
      : `Hi ${s.name || 'there'}, your plan at ${lib?.name || 'the library'} ends on ${expiryOf(s)}. Please renew to keep your seat.`;
    let out;
    try {
      out = await sendWhatsappMessage({ libraryId: tenantId, type: r.type, to: s.phone, text, dedupeKey: `reminder:${r.key}`, consent: s.whatsappOptOut !== true }, deps);
    } catch (e) { out = { status: 'failed', error: e.message }; }
    const status = out.status === 'sent' || out.status === 'duplicate' ? 'sent' : out.status === 'failed' ? 'failed' : 'skipped';
    await ReminderSchedule.updateOne({ tenantId, _id: r._id }, { $set: { status, reason: out.reason || out.error || (out.status === 'duplicate' ? 'already_sent' : null), ...(status === 'sent' ? { sentAt: new Date() } : {}) } });
    results[status]++;
  }
  // Failed sends are retried next run (dedupe prevents a double send if the provider actually delivered).
  await ReminderSchedule.updateMany({ tenantId, status: 'failed', attempts: { $lt: 3 } }, { $set: { status: 'scheduled' } });
  return results;
}

const localHour = (tz = process.env.APP_TIMEZONE || 'Asia/Kolkata') => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date()));

export async function runReminderJob(deps = {}) {
  if (!evolutionConfigured() && !deps.client) return;
  const h = localHour();
  const sendNow = deps.force || (h >= 9 && h < 20); // no messages at night; planning/cancelling still runs
  for (const l of await Library.find({ status: 'Active' }).lean()) {
    try { await planReminders(l.libraryId); if (sendNow) await sendDueReminders(l.libraryId, { deps }); }
    catch (e) { console.error('[reminders] failed for', l.libraryId, e.message); }
  }
}

/* ---------------------------------------------------------------- auto receipts */
let receiptDeps = {};
export const setReceiptDeps = (d) => { receiptDeps = d || {}; };

/** Fire-and-forget after new payments are saved. Admission vs renewal by prior payment history. */
export async function autoSendReceipts(tenantId, payments) {
  if (!payments?.length || (!evolutionConfigured() && !receiptDeps.client)) return [];
  const out = [];
  for (const p of payments) {
    if (!p?.studentId || Number(p.netTotal ?? p.amount ?? 0) <= 0 || p.method === 'Refund') continue;
    const key = String(p._key ?? p.receiptNo ?? p.id);
    const s = await models.students.findOne({ tenantId, _key: String(p.studentId) }).lean();
    if (!s?.phone) continue;
    const earlier = await models.payments.countDocuments({ tenantId, studentId: String(p.studentId), _key: { $ne: key } });
    const type = earlier > 0 || /renew/i.test(p.planName || p.type || '') ? 'renewal_receipt' : 'admission_receipt';
    try {
      out.push(await sendWhatsappMessage({ libraryId: tenantId, type, to: s.phone, text: buildReceiptText(p, s), dedupeKey: `receipt:${key}`, consent: s.whatsappOptOut !== true }, receiptDeps));
    } catch (e) { console.error('[receipts] send failed:', e.message); }
  }
  return out;
}

/* ---------------------------------------------------------------- routes */
export function createReminderRouter() {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const guard = wrap(async (req, res, next) => (await canManageWhatsapp(req.user, req.tenantId)) ? next() : res.status(403).json({ error: 'You do not have permission to manage WhatsApp reminders' }));

  r.get('/reminders/settings', guard, wrap(async (req, res) => res.json(await reminderSettings(req.tenantId))));
  r.put('/reminders/settings', guard, wrap(async (req, res) => {
    const b = req.body || {}; const set = {};
    const int = (v, lo, hi) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw Object.assign(new Error(`Value must be a whole number between ${lo} and ${hi}`), { status: 400 }); return n; };
    if (b.expiryDaysBefore !== undefined) set['reminderSettings.expiryDaysBefore'] = int(b.expiryDaysBefore, 0, 30);
    if (b.expiryFixedDay !== undefined) set['reminderSettings.expiryFixedDay'] = b.expiryFixedDay === null || b.expiryFixedDay === '' ? null : int(b.expiryFixedDay, 1, 28);
    if (b.feeEveryDays !== undefined) set['reminderSettings.feeEveryDays'] = int(b.feeEveryDays, 1, 30);
    if (b.feeMaxReminders !== undefined) set['reminderSettings.feeMaxReminders'] = int(b.feeMaxReminders, 1, 10);
    await WhatsappConfig.updateOne({ libraryId: req.tenantId }, { $set: { ...set, updatedBy: req.user.email } }, { upsert: true, strict: false });
    res.json(await reminderSettings(req.tenantId));
  }));
  r.get('/reminders', guard, wrap(async (req, res) => {
    const q = { tenantId: req.tenantId };
    if (req.query.status) q.status = String(req.query.status);
    if (req.query.studentId) q.studentId = String(req.query.studentId);
    const list = await ReminderSchedule.find(q).sort({ sendOn: -1 }).limit(Math.min(Number(req.query.limit || 200), 500)).lean();
    res.json(list.map(x => ({ id: String(x._id), studentId: x.studentId, type: x.type, sendOn: x.sendOn, status: x.status, reason: x.reason, sentAt: x.sentAt })));
  }));
  r.post('/reminders/plan', guard, wrap(async (req, res) => res.json(await planReminders(req.tenantId))));
  return r;
}

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
import { WhatsappConfig, sendWhatsappMessage, buildReceiptText, logSkipped, canManageWhatsapp, retryFailedReceipts } from './whatsapp.js';
import { evolutionConfigured } from './evolution.js';
import { getTemplates, renderTemplate } from './templates.js';

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  key: { type: String, required: true },       // also the WhatsApp dedupeKey
  studentId: { type: String, required: true },
  type: { type: String, enum: ['fee_reminder', 'expiry_reminder'], required: true },
  sendOn: { type: String, required: true },    // YYYY-MM-DD (app timezone)
  periodKey: String,                           // student's expiry date for this period
  ruleId: String,                              // Issue #17: auto-reminder rule that planned it
  sendHour: Number,                            // earliest local hour to send (rule's send time)
  onlyIfUnpaid: Boolean,
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

/** Enabled auto-reminder rules, or null when the library still uses the single legacy expiry offset. */
export function activeRules(settings) {
  if (!Array.isArray(settings?.rules) || !settings.rules.length) return null;
  return settings.rules.filter(r => r && r.enabled !== false);
}

export const MAX_RULES = 10;
/** Validate rules from the UI: { id, offsetDays -30..30, sendHour 9..19, enabled, onlyIfUnpaid, template }. */
export function validateRules(list) {
  if (!Array.isArray(list)) throw Object.assign(new Error('rules must be a list'), { status: 400 });
  if (list.length > MAX_RULES) throw Object.assign(new Error(`At most ${MAX_RULES} reminder rules`), { status: 400 });
  const ids = new Set();
  return list.map((r, i) => {
    const bad = (m) => { throw Object.assign(new Error(`Rule ${i + 1}: ${m}`), { status: 400 }); };
    const id = String(r?.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || bad('missing id');
    if (ids.has(id)) bad('duplicate id'); ids.add(id);
    const offsetDays = Number(r.offsetDays);
    if (!Number.isInteger(offsetDays) || offsetDays < -30 || offsetDays > 30) bad('days must be a whole number from -30 to 30');
    const sendHour = r.sendHour == null || r.sendHour === '' ? 9 : Number(r.sendHour);
    if (!Number.isInteger(sendHour) || sendHour < 9 || sendHour > 19) bad('send time must be between 9 AM and 7 PM');
    const template = r.template === 'fee_reminder' ? 'fee_reminder' : 'renewal_reminder';
    return { id, offsetDays, sendHour, enabled: r.enabled !== false, onlyIfUnpaid: !!r.onlyIfUnpaid, template };
  });
}

/** Desired schedule for one student today (pure). */
export function desiredFor(s, settings, today) {
  const out = [];
  const exp = expiryOf(s);
  const id = String(s._key ?? s.id);
  const rules = activeRules(settings);
  if (rules) {
    // Issue #17: each enabled rule plans one reminder per period, `offsetDays` from the expiry date
    // (negative = before). A rule whose day has already passed is not sent late.
    if (exp) for (const r of rules) {
      const sendOn = addDays(exp, Number(r.offsetDays || 0));
      if (sendOn < today) continue;
      out.push({ key: `expiry:${id}:${exp}:r${r.id}`, studentId: id, type: r.template === 'fee_reminder' ? 'fee_reminder' : 'expiry_reminder', sendOn, periodKey: exp, ruleId: r.id, sendHour: r.sendHour ?? null, onlyIfUnpaid: !!r.onlyIfUnpaid, rule: true });
    }
  } else if (exp && exp >= today) {
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
    if (d.type === 'fee_reminder' && !d.rule) {
      const firstKey = d.key.replace(/:\d+$/, ':1');
      const anchor = existingFee.get(firstKey)?.sendOn || today;
      sendOn = addDays(anchor, d.seq * Number(settings.feeEveryDays || 1));
    }
    try {
      const r = await ReminderSchedule.updateOne({ tenantId, key: d.key },
        { $setOnInsert: { studentId: d.studentId, type: d.type, sendOn, periodKey: d.periodKey, status: 'scheduled', ...(d.rule ? { ruleId: d.ruleId, sendHour: d.sendHour, onlyIfUnpaid: d.onlyIfUnpaid } : {}) } }, { upsert: true });
      planned += r.upsertedCount || 0;
    } catch (e) { if (e?.code !== 11000) throw e; }
  }
  // Cancel stale: renewed (expiry changed), due cleared, student archived/removed.
  const stale = (await ReminderSchedule.find({ tenantId, status: 'scheduled' }).lean()).filter(r => !desired.has(r.key));
  for (const r of stale) {
    const s = students.find(x => String(x._key ?? x.id) === r.studentId);
    const reason = !s ? 'student_removed' : r.ruleId && expiryOf(s) === r.periodKey ? 'rule_changed' : r.type === 'fee_reminder' && !r.ruleId ? 'paid' : 'renewed';
    await ReminderSchedule.updateOne({ tenantId, _id: r._id, status: 'scheduled' }, { $set: { status: 'cancelled', reason } });
  }
  return { planned, cancelled: stale.length };
}

/** Send everything due today, re-checking live data first (latest payment status wins). */
export async function sendDueReminders(tenantId, { today = todayIn(), hour = null, deps = {} } = {}) {
  // A rule's send time: today's row waits until that local hour (earlier days' rows go out now).
  const due = (await ReminderSchedule.find({ tenantId, status: 'scheduled', sendOn: { $lte: today } }).lean())
    .filter(r => hour == null || r.sendOn < today || !r.sendHour || hour >= r.sendHour);
  const lib = await Library.findOne({ libraryId: tenantId }).lean();
  const templates = await getTemplates(tenantId).catch(() => ({}));
  const results = { sent: 0, skipped: 0, failed: 0, cancelled: 0 };
  for (const r of due) {
    // Claim it so two workers can't both send.
    const claimed = await ReminderSchedule.findOneAndUpdate({ tenantId, _id: r._id, status: 'scheduled' }, { $set: { status: 'skipped', reason: 'in_progress' }, $inc: { attempts: 1 } }, { new: true });
    if (!claimed) continue;
    const s = await models.students.findOne({ tenantId, _key: r.studentId }).lean();
    const stillValid = s && (r.ruleId
      ? expiryOf(s) === r.periodKey && (!r.onlyIfUnpaid || dueOf(s) > 0)
      : r.type === 'fee_reminder' ? dueOf(s) > 0 && (expiryOf(s) || 'open') === r.periodKey : expiryOf(s) === r.periodKey);
    if (!stillValid) {
      const reason = s && expiryOf(s) === r.periodKey ? 'paid' : r.type === 'fee_reminder' && !r.ruleId ? 'paid' : 'renewed';
      await ReminderSchedule.updateOne({ tenantId, _id: r._id }, { $set: { status: 'cancelled', reason } }); results.cancelled++; continue;
    }
    const text = reminderText(r.type, s, lib, templates);
    let out;
    try {
      out = await sendWhatsappMessage({ libraryId: tenantId, type: r.type, to: s.phone, text, dedupeKey: `reminder:${r.key}`, consent: s.whatsappOptOut !== true, studentId: r.studentId, studentName: s.name }, deps);
    } catch (e) { out = { status: 'failed', error: e.message }; }
    const status = out.status === 'sent' || out.status === 'duplicate' ? 'sent' : out.status === 'failed' ? 'failed' : 'skipped';
    await ReminderSchedule.updateOne({ tenantId, _id: r._id }, { $set: { status, reason: out.reason || out.error || (out.status === 'duplicate' ? 'already_sent' : null), ...(status === 'sent' ? { sentAt: new Date() } : {}) } });
    results[status]++;
  }
  // Failed sends are retried next run (dedupe prevents a double send if the provider actually delivered).
  await ReminderSchedule.updateMany({ tenantId, status: 'failed', attempts: { $lt: 3 } }, { $set: { status: 'scheduled' } });
  return results;
}

/** Reminder text: the library's saved template if any, else the built-in wording. */
export function reminderText(type, s, lib, templates = {}) {
  const vars = { name: s.name || 'there', amount: Number(dueOf(s)).toLocaleString('en-IN'), dueDate: expiryOf(s) || '', library: lib?.name || 'the library', seat: s.seatNo || s.seatNumber || '', shift: s.shift || '' };
  const tpl = type === 'fee_reminder' ? templates.fee_reminder : templates.renewal_reminder;
  if (tpl) return renderTemplate(tpl, vars);
  return type === 'fee_reminder'
    ? `Hi ${vars.name}, a fee of ${money(dueOf(s))} is pending at ${vars.library}. Please pay at the desk. Ignore if already paid.`
    : `Hi ${vars.name}, your plan at ${vars.library} ends on ${vars.dueDate}. Please renew to keep your seat.`;
}

const localHour = (tz = process.env.APP_TIMEZONE || 'Asia/Kolkata') => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date()));

export async function runReminderJob(deps = {}) {
  if (!evolutionConfigured() && !deps.client) return;
  const h = localHour();
  const sendNow = deps.force || (h >= 9 && h < 20); // no messages at night; planning/cancelling still runs
  for (const l of await Library.find({ status: 'Active' }).lean()) {
    try { await planReminders(l.libraryId); if (sendNow) await sendDueReminders(l.libraryId, { hour: deps.hour ?? h, deps }); }
    catch (e) { console.error('[reminders] failed for', l.libraryId, e.message); }
  }
}

/** Every ~3 min: re-send receipts that failed because Evolution was asleep (no time window for receipts). */
export async function runReceiptRetryJob(deps = {}) {
  if (!evolutionConfigured() && !deps.client) return null;
  return retryFailedReceipts(deps);
}

/* ---------------------------------------------------------------- auto receipts */
let receiptDeps = {};
export const setReceiptDeps = (d) => { receiptDeps = d || {}; };

// The UI syncs payments and students in parallel, so a new admission's payment can land before its student.
const RECEIPT_RETRY_MS = [1000, 2000, 4000, 8000]; // ~15s total
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Receipts go out for a real payment, including one whose paidOn is already in the past. Refunds and zero amounts do not. */
export function receiptSendable(p) {
  return Boolean(p?.studentId) && Number(p?.netTotal ?? p?.amount ?? 0) > 0 && p?.method !== 'Refund';
}

/** Fire-and-forget after new payments are saved. Admission vs renewal by prior payment history.
 *  opts.retry=false skips the student lookup retries (used when the student was just written). */
export async function autoSendReceipts(tenantId, payments, { retry = true } = {}) {
  if (!payments?.length || (!evolutionConfigured() && !receiptDeps.client)) return [];
  const delays = retry ? (receiptDeps.retryMs || RECEIPT_RETRY_MS) : [];
  const out = [];
  for (const p of payments) {
    if (!receiptSendable(p)) continue;
    const key = String(p._key ?? p.receiptNo ?? p.id);
    const find = () => models.students.findOne({ tenantId, _key: String(p.studentId) }).lean();
    let s = await find();
    for (const ms of delays) { if (s?.phone) break; await sleep(ms); s = await find(); }
    const earlier = await models.payments.countDocuments({ tenantId, studentId: String(p.studentId), _key: { $ne: key } });
    const type = earlier > 0 || /renew/i.test(p.planName || p.type || '') ? 'renewal_receipt' : 'admission_receipt';
    if (!s?.phone) {
      const reason = s ? 'no_phone' : 'no_student';
      await logSkipped({ libraryId: tenantId, type, dedupeKey: `receipt:${key}`, reason, studentId: p.studentId, studentName: s?.name }, receiptDeps.Message);
      out.push({ status: 'skipped', reason });
      continue;
    }
    try {
      out.push(await sendWhatsappMessage({ libraryId: tenantId, type, to: s.phone, text: buildReceiptText(p, s), dedupeKey: `receipt:${key}`, consent: s.whatsappOptOut !== true, studentId: p.studentId, studentName: s.name }, receiptDeps));
    } catch (e) { console.error('[receipts] send failed:', e.message); }
  }
  return out;
}

/** After a students sync: send receipts for the new students' payments that have no sent receipt yet. */
export async function receiptsForNewStudents(tenantId, studentKeys) {
  if (!studentKeys?.length || (!evolutionConfigured() && !receiptDeps.client)) return [];
  const payments = await models.payments.find({ tenantId, studentId: { $in: studentKeys.map(String) } }).lean();
  return autoSendReceipts(tenantId, payments, { retry: false }); // sendWhatsappMessage dedupes on receipt:<key>
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
    if (b.rules !== undefined) set['reminderSettings.rules'] = b.rules === null ? [] : validateRules(b.rules);
    await WhatsappConfig.updateOne({ libraryId: req.tenantId }, { $set: { ...set, updatedBy: req.user.email } }, { upsert: true, strict: false });
    res.json(await reminderSettings(req.tenantId));
  }));
  r.get('/reminders', guard, wrap(async (req, res) => {
    const q = { tenantId: req.tenantId };
    if (req.query.status) q.status = String(req.query.status);
    if (req.query.studentId) q.studentId = String(req.query.studentId);
    const list = await ReminderSchedule.find(q).sort({ sendOn: -1 }).limit(Math.min(Number(req.query.limit || 200), 500)).lean();
    res.json(list.map(x => ({ id: String(x._id), studentId: x.studentId, type: x.type, sendOn: x.sendOn, status: x.status, reason: x.reason, sentAt: x.sentAt, ruleId: x.ruleId || null })));
  }));
  r.post('/reminders/plan', guard, wrap(async (req, res) => res.json(await planReminders(req.tenantId))));
  return r;
}

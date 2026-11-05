import express from 'express';
import mongoose from 'mongoose';
import { Library, models } from './models.js';
import crypto from 'crypto';
import { createEvolutionClient, evolutionConfigured, instanceNameFor, normalizePhone, webhookTokenFor } from './evolution.js';

/* ---------------------------------------------------------------- Models */
export const MESSAGE_TYPES = ['otp', 'admission_receipt', 'renewal_receipt', 'fee_reminder', 'expiry_reminder', 'test', 'fee_receipt', 'renewal_reminder', 'seat_info', 'custom'];
/** Types a staff member can send by hand from the per-student WhatsApp window. */
export const MANUAL_TYPES = ['fee_reminder', 'fee_receipt', 'renewal_reminder', 'seat_info', 'custom'];
const DEFAULT_TOGGLES = { enabled: true, otp: false, receipts: true, feeReminders: false, expiryReminders: false };

/** Per-library WhatsApp preferences (owner opt-out + per-type toggles). */
export const WhatsappConfig = mongoose.models.WhatsappConfig || mongoose.model('WhatsappConfig', new mongoose.Schema({
  libraryId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: DEFAULT_TOGGLES.enabled },
  otp: { type: Boolean, default: DEFAULT_TOGGLES.otp },
  receipts: { type: Boolean, default: DEFAULT_TOGGLES.receipts },
  feeReminders: { type: Boolean, default: DEFAULT_TOGGLES.feeReminders },
  expiryReminders: { type: Boolean, default: DEFAULT_TOGGLES.expiryReminders },
  connectedNumber: String,
  // Reminder timing (spec §6): set via PUT /reminders/settings
  reminderSettings: { expiryDaysBefore: Number, expiryFixedDay: Number, feeEveryDays: Number, feeMaxReminders: Number },
  updatedBy: String,
}, { timestamps: true }));

/** Message log: provider status, errors, and duplicate prevention via (libraryId, dedupeKey). */
const msgSchema = new mongoose.Schema({
  libraryId: { type: String, required: true, index: true },
  type: { type: String, enum: MESSAGE_TYPES, required: true },
  to: String,
  dedupeKey: { type: String, required: true },
  status: { type: String, enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'skipped'], default: 'queued' },
  studentId: { type: String, index: true },
  studentName: String,
  text: String,
  deliveredAt: Date,
  readAt: Date,
  providerMessageId: String,
  error: String,
  reason: String, // why a message was skipped: no_student, no_phone, disabled, no_consent, invalid_number
  attempts: { type: Number, default: 0 },
  transient: Boolean, // last failure was the provider being asleep/unreachable (retried by whatsapp-receipt-retry)
  permanent: Boolean, // gave up after MAX_ATTEMPTS
}, { timestamps: true });
msgSchema.index({ libraryId: 1, dedupeKey: 1 }, { unique: true });
msgSchema.index({ libraryId: 1, createdAt: -1 });
msgSchema.index({ providerMessageId: 1 }, { sparse: true });
export const WhatsappMessage = mongoose.models.WhatsappMessage || mongoose.model('WhatsappMessage', msgSchema);

/** Statuses that mean the message already went out (never re-sent, never overwritten). */
const DONE = ['queued', 'sent', 'delivered', 'read'];
const TOGGLE_FOR_TYPE = { otp: 'otp', admission_receipt: 'receipts', renewal_receipt: 'receipts', fee_reminder: 'feeReminders', expiry_reminder: 'expiryReminders', test: null, fee_receipt: null, renewal_reminder: null, seat_info: null, custom: null };

/* ---------------------------------------------------------------- Permissions */
/**
 * Who may manage the WhatsApp connection for a library:
 * client_admin (owner) and superadmin (non read-only), or a staff login linked to an
 * active staff record that is Admin/Manager or holds settings.manage / settings.edit.
 */
export async function canManageWhatsapp(user, libraryId, { Staff = models.staffMembers } = {}) {
  if (!user) return false;
  if (user.role === 'client_admin' || user.role === 'superadmin') return true;
  if (user.role !== 'staff' || !user.staffId) return false;
  const s = await Staff.findOne({ tenantId: libraryId, _key: String(user.staffId) }).lean();
  if (!s || (s.status && s.status !== 'Active')) return false;
  if (['Admin', 'Manager'].includes(s.role)) return true;
  const p = s.permissions?.settings || {};
  return Boolean(p.manage || p.edit);
}

/* ---------------------------------------------------------------- Send service */
/**
 * Send one WhatsApp message on behalf of a library. Honors the owner's opt-out and
 * per-type toggles, requires recipient consent (opt-in), prevents duplicates and logs
 * the provider result. Messages are prefixed with the library name (spec §6).
 */
export async function sendWhatsappMessage({ libraryId, type, to, text, dedupeKey, consent = true, studentId, studentName, manual = false }, deps = {}) {
  const { client = createEvolutionClient(), Config = WhatsappConfig, Message = WhatsappMessage, Lib = Library } = deps;
  if (!MESSAGE_TYPES.includes(type)) throw Object.assign(new Error('Unknown message type'), { status: 400 });
  if (!dedupeKey) throw Object.assign(new Error('dedupeKey is required'), { status: 400 });
  const cfg = { ...DEFAULT_TOGGLES, ...((await Config.findOne({ libraryId }).lean()) || {}) };
  const toggle = manual ? null : TOGGLE_FOR_TYPE[type]; // hand-sent messages only honor the master switch
  const number = normalizePhone(to);
  const reason = !cfg.enabled || (toggle && !cfg[toggle]) ? 'disabled' : !consent ? 'no_consent' : !number ? 'invalid_number' : null;
  const who = { ...(studentId != null ? { studentId: String(studentId) } : {}), ...(studentName ? { studentName } : {}) };
  if (reason) { await logSkipped({ libraryId, type, to, dedupeKey, reason, text, ...who }, Message); return { status: 'skipped', reason }; }

  const existing = await Message.findOne({ libraryId, dedupeKey }).lean();
  if (existing && DONE.includes(existing.status)) return { status: 'duplicate', id: String(existing._id) };
  const lib = await Lib.findOne({ libraryId }).lean();
  const body = `*${lib?.name || 'Your library'}*\n${String(text || '').trim()}`;

  // Atomic claim: only one caller can move a key to 'queued'; a sent/queued row makes the upsert hit the unique index.
  let log;
  try {
    log = await Message.findOneAndUpdate(
      { libraryId, dedupeKey, status: { $nin: DONE } },
      { $set: { type, to: number, status: 'queued', error: null, reason: null, text: body, ...who }, $inc: { attempts: 1 } },
      { upsert: true, new: true }
    );
  } catch (e) {
    if (e?.code !== 11000) throw e;
    const dup = await Message.findOne({ libraryId, dedupeKey }).lean();
    return { status: 'duplicate', id: String(dup?._id) };
  }
  return deliver(log, { libraryId, number, body }, { client, Message, delaysMs: deps.retryDelaysMs });
}

export const MAX_ATTEMPTS = 3;
// ~90s of backoff: covers a Render free-plan Evolution cold start once the wake call has kicked it.
const SEND_RETRY_MS = [5000, 10000, 20000, 25000, 30000];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Provider asleep / unreachable / timed out / 502-503-504: worth retrying later. */
export function isTransientError(e) {
  const up = e?.upstreamStatus;
  return e?.status === 503 || [429, 502, 503, 504].includes(up) || /unreachable|timed? ?out|waking|connection closed|not connected|connecting/i.test(String(e?.message || ''));
}

/** Wake Evolution, send with backoff on transient errors, and record the outcome on the log row. */
export async function deliver(log, { libraryId, number, body }, { client, Message = WhatsappMessage, delaysMs = SEND_RETRY_MS }) {
  const instance = instanceNameFor(libraryId);
  if (client.wake) {
    // After a cold start Evolution answers 429 and then reports "connecting" while it restores the WhatsApp
    // session; sending before it is "open" fails. Wait (bounded) for the session to be open.
    for (let w = 0; w < (delaysMs.length ? 6 : 1); w++) {
      try {
        const st = await client.wake(instance);
        const state = st?.instance?.state;
        if (!state || state === 'open') break;
        console.log(`[whatsapp] ${instance} state ${state}, waiting before send`);
      } catch (e) { console.error(`[whatsapp] wake failed for ${instance} (status ${e?.upstreamStatus || e?.status}): ${e?.message}`); }
      if (delaysMs.length) await sleep(Math.min(10000, delaysMs[0] * 2));
    }
  }
  let lastErr;
  for (let i = 0; i <= delaysMs.length; i++) {
    try {
      const r = await client.sendText(instance, number, body);
      await Message.updateOne({ _id: log._id }, { $set: { status: 'sent', providerMessageId: r?.key?.id || null, error: null, transient: false } });
      return { status: 'sent', id: String(log._id) };
    } catch (e) {
      lastErr = e;
      console.error(`[whatsapp] send attempt ${i + 1} failed for ${instance} msg ${log._id} (status ${e?.upstreamStatus || e?.status}): ${e?.message}`);
      if (!isTransientError(e) || i === delaysMs.length) break;
      await sleep(delaysMs[i]);
    }
  }
  const transient = isTransientError(lastErr);
  const permanent = !transient || (log.attempts || 1) >= MAX_ATTEMPTS;
  await Message.updateOne({ _id: log._id }, { $set: { status: 'failed', error: String(lastErr?.message).slice(0, 300), transient, permanent } });
  return { status: 'failed', error: lastErr?.message, id: String(log._id), transient, permanent };
}

/**
 * Re-send receipts whose last attempt failed with a transient error (any time of day), at most MAX_ATTEMPTS
 * in total. Same row and dedupeKey, so a receipt is never sent twice. Older rows without the `transient`
 * flag are matched by their error text.
 */
export async function retryFailedReceipts(deps = {}) {
  const { client = createEvolutionClient(), Message = WhatsappMessage, retryDelaysMs } = deps;
  const rows = await Message.find({
    type: { $in: ['admission_receipt', 'renewal_receipt'] }, status: 'failed', permanent: { $ne: true }, attempts: { $lt: MAX_ATTEMPTS },
    $or: [{ transient: true }, { transient: { $exists: false }, error: /unreachable|timed? ?out|waking|service request failed/i }],
  }).limit(50).lean();
  const out = { retried: 0, sent: 0, failed: 0 };
  for (const row of rows) {
    const log = await Message.findOneAndUpdate({ _id: row._id, status: 'failed', attempts: row.attempts },
      { $set: { status: 'queued' }, $inc: { attempts: 1 } }, { new: true });
    if (!log) continue; // someone else claimed it (or a manual Resend)
    out.retried++;
    const r = await deliver(log, { libraryId: row.libraryId, number: row.to, body: row.text }, { client, Message, delaysMs: retryDelaysMs });
    r.status === 'sent' ? out.sent++ : out.failed++;
  }
  // Rows that already used every attempt are given up on.
  await Message.updateMany({ type: { $in: ['admission_receipt', 'renewal_receipt'] }, status: 'failed', permanent: { $ne: true }, attempts: { $gte: MAX_ATTEMPTS } }, { $set: { permanent: true } });
  if (out.retried) console.log(`[whatsapp] receipt retry: ${JSON.stringify(out)}`);
  return out;
}

/** Log a skipped message (never overwrites a sent/queued row for the same key). */
export async function logSkipped({ libraryId, type, to, dedupeKey, reason, text, studentId, studentName }, Message = WhatsappMessage) {
  const extra = { ...(text ? { text: String(text) } : {}), ...(studentId != null ? { studentId: String(studentId) } : {}), ...(studentName ? { studentName } : {}) };
  try {
    await Message.updateOne({ libraryId, dedupeKey, status: { $nin: DONE } },
      { $set: { type, to: to ? String(to) : null, status: 'skipped', reason, ...extra } }, { upsert: true });
  } catch (e) { if (e?.code !== 11000) throw e; }
}

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
/** Receipt text for an admission/renewal payment (spec §6: admission & renewal receipts). */
export function buildReceiptText(payment, student) {
  const lines = [
    `Hi ${student?.name || 'there'}, thank you for your payment.`,
    `Receipt: ${payment.receiptNo || payment.id}`,
    `Amount: ${money(payment.netTotal ?? payment.amount)}`,
  ];
  if (payment.date) lines.push(`Date: ${payment.date}`);
  if (student?.expiryDate || student?.endDate) lines.push(`Valid till: ${student.expiryDate || student.endDate}`);
  return lines.join('\n');
}

/* ---------------------------------------------------------------- Routes */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const mapState = (s) => (s === 'open' ? 'connected' : s === 'connecting' ? 'connecting' : 'disconnected');
const jidToNumber = (jid) => (jid ? `+${String(jid).split('@')[0].split(':')[0]}` : null);

export function createWhatsappRouter({ client = createEvolutionClient(), isConfigured = () => evolutionConfigured(), wakeDelaysMs = [3000, 6000, 10000] } = {}) {
  const r = express.Router();
  const guard = wrap(async (req, res, next) => {
    if (!(await canManageWhatsapp(req.user, req.libraryId))) return res.status(403).json({ error: 'You do not have permission to manage WhatsApp' });
    if (!isConfigured()) return res.status(503).json({ error: 'WhatsApp integration is not configured on the server' });
    req.instance = instanceNameFor(req.libraryId);
    next();
  });
  r.use(guard);

  /** Status/connect wake the (free-plan) Evolution service and retry while it answers 429/5xx. */
  async function withWake(name, fn) {
    let lastErr;
    for (let i = 0; i <= wakeDelaysMs.length; i++) {
      try { return await fn(); } catch (e) {
        lastErr = e;
        if (!isTransientError(e) || i === wakeDelaysMs.length) break;
        if (i === 0 && client.wake) { try { await client.wake(name); } catch { /* still waking */ } }
        await sleep(wakeDelaysMs[i]);
      }
    }
    throw lastErr;
  }

  async function status(name) {
    const inst = await withWake(name, () => client.findInstance(name));
    if (!inst) return { state: 'not_created', number: null, profileName: null };
    let raw = inst.connectionStatus;
    try { raw = (await client.connectionState(name))?.instance?.state || raw; } catch { /* use cached */ }
    const state = mapState(raw);
    return { state, number: state === 'connected' ? jidToNumber(inst.ownerJid || inst.owner) : null, profileName: state === 'connected' ? (inst.profileName || null) : null };
  }

  r.get('/status', wrap(async (req, res) => {
    const s = await status(req.instance);
    const cfg = (await WhatsappConfig.findOne({ libraryId: req.libraryId }).lean()) || {};
    if (s.number && cfg.connectedNumber !== s.number) await WhatsappConfig.updateOne({ libraryId: req.libraryId }, { $set: { connectedNumber: s.number } }, { upsert: true });
    res.json({ ...s, instance: req.instance, settings: { ...DEFAULT_TOGGLES, ...pickToggles(cfg) } });
  }));

  // Creates the library's instance if needed and returns a fresh QR code.
  r.post('/connect', wrap(async (req, res) => {
    let created = null;
    if (!(await withWake(req.instance, () => client.findInstance(req.instance)))) created = await client.createInstance(req.instance);
    await registerWebhook(client, req.instance, webhookBaseUrl(req));
    const s = await status(req.instance);
    if (s.state === 'connected') return res.json(s);
    const c = await withWake(req.instance, () => client.connect(req.instance));
    const qr = c?.base64 || created?.qrcode?.base64 || null;
    res.json({ state: 'connecting', qr, pairingCode: c?.pairingCode || null });
  }));

  r.post('/logout', wrap(async (req, res) => {
    try { await client.logout(req.instance); } catch (e) { if (e.status !== 404) throw e; }
    await WhatsappConfig.updateOne({ libraryId: req.libraryId }, { $unset: { connectedNumber: 1 } });
    res.json({ state: 'disconnected' });
  }));

  r.put('/settings', wrap(async (req, res) => {
    const set = pickToggles(req.body || {});
    const cfg = await WhatsappConfig.findOneAndUpdate({ libraryId: req.libraryId }, { $set: { ...set, updatedBy: req.user.email } }, { upsert: true, new: true, lean: true });
    res.json({ ...DEFAULT_TOGGLES, ...pickToggles(cfg) });
  }));

  // Send the receipt for an existing payment to the student's phone (admission/renewal receipts).
  r.post('/receipts/:receiptNo', wrap(async (req, res) => {
    const type = req.body?.type === 'renewal_receipt' ? 'renewal_receipt' : 'admission_receipt';
    const out = await sendReceipt({ tenantId: req.tenantId || req.libraryId, libraryId: req.libraryId, receiptNo: req.params.receiptNo, type, client });
    res.status(out.httpStatus || (out.status === 'failed' ? 502 : 200)).json(out.httpStatus ? { error: out.error } : out);
  }));

  // Message log for the Messages screen (tenant-scoped, newest first).
  r.get('/messages', wrap(async (req, res) => {
    const q = { libraryId: req.libraryId };
    if (req.query.studentId) q.studentId = String(req.query.studentId);
    if (req.query.type && MESSAGE_TYPES.includes(String(req.query.type))) q.type = String(req.query.type);
    if (req.query.status && STATUSES.includes(String(req.query.status))) q.status = String(req.query.status);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const [items, total] = await Promise.all([
      WhatsappMessage.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      WhatsappMessage.countDocuments(q),
    ]);
    res.json({ items: items.map(publicMessage), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }));

  // Resend a failed or skipped message. Receipts are rebuilt from the payment; others reuse the stored text.
  r.post('/messages/:id/resend', wrap(async (req, res) => {
    if (req.readOnly) return res.status(403).json({ error: 'Read-only access' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Message not found' });
    const m = await WhatsappMessage.findOne({ _id: req.params.id, libraryId: req.libraryId }).lean();
    if (!m) return res.status(404).json({ error: 'Message not found' });
    if (!['failed', 'skipped'].includes(m.status)) return res.status(409).json({ error: 'Only failed or skipped messages can be resent' });
    const tenantId = req.tenantId || req.libraryId;
    let out;
    if (m.dedupeKey.startsWith('receipt:')) {
      out = await sendReceipt({ tenantId, libraryId: req.libraryId, receiptNo: m.dedupeKey.slice('receipt:'.length), type: m.type, client });
      if (out.httpStatus) return res.status(out.httpStatus).json({ error: out.error });
    } else {
      const student = m.studentId ? await models.students.findOne({ tenantId, _key: m.studentId }).lean() : null;
      const to = student?.phone || m.to;
      if (!to) return res.status(400).json({ error: 'Student has no phone number' });
      const lib = await Library.findOne({ libraryId: req.libraryId }).lean();
      const prefix = `*${lib?.name || 'Your library'}*\n`;
      const text = String(m.text || '').startsWith(prefix) ? m.text.slice(prefix.length) : m.text;
      if (!text) return res.status(400).json({ error: 'Nothing to resend for this message' });
      out = await sendWhatsappMessage({ libraryId: req.libraryId, type: m.type, to, text, dedupeKey: m.dedupeKey, consent: student ? student.whatsappOptOut !== true : true, studentId: m.studentId, studentName: student?.name || m.studentName }, { client });
    }
    const fresh = await WhatsappMessage.findOne({ _id: m._id }).lean();
    res.status(out.status === 'failed' ? 502 : 200).json({ ...out, message: fresh ? publicMessage(fresh) : null });
  }));

  // Send a hand-written / typed message to one student (per-student WhatsApp window).
  r.post('/students/:studentId/send', wrap(async (req, res) => {
    if (req.readOnly) return res.status(403).json({ error: 'Read-only access' });
    const out = await sendManualMessage({ tenantId: req.tenantId || req.libraryId, libraryId: req.libraryId, studentId: req.params.studentId, ...(req.body || {}) }, { client });
    if (out.httpStatus) return res.status(out.httpStatus).json({ error: out.error });
    const fresh = out.id ? await WhatsappMessage.findOne({ _id: out.id, libraryId: req.libraryId }).lean() : null;
    res.status(out.status === 'failed' ? 502 : 200).json({ ...out, message: fresh ? publicMessage(fresh) : null });
  }));

  return r;
}

/** Validate and send one manual message for a student. Every send gets its own log row (never deduped). */
export async function sendManualMessage({ tenantId, libraryId, studentId, type, text, receiptNo }, { client, Students = models.students, Payments = models.payments, send = sendWhatsappMessage } = {}) {
  if (!MANUAL_TYPES.includes(type)) return { httpStatus: 400, error: 'Unknown message type' };
  const body = String(text || '').trim();
  if (!body && type !== 'fee_receipt') return { httpStatus: 400, error: 'Message text is required' };
  if (body.length > 2000) return { httpStatus: 400, error: 'Message is too long (max 2000 characters)' };
  const student = await Students.findOne({ tenantId, _key: String(studentId) }).lean();
  if (!student) return { httpStatus: 404, error: 'Student not found' };
  if (!student.phone) return { httpStatus: 400, error: 'Student has no phone number' };
  let finalText = body;
  if (type === 'fee_receipt') {
    if (!receiptNo) return { httpStatus: 400, error: 'Pick a receipt to send' };
    const payment = await Payments.findOne({ tenantId, _key: String(receiptNo) }).lean();
    if (!payment || String(payment.studentId) !== String(studentId)) return { httpStatus: 404, error: 'Payment not found for this student' };
    if (!finalText) finalText = buildReceiptText(payment, student);
  }
  const dedupeKey = `manual:${type}:${studentId}:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`;
  const out = await send({ libraryId, type, to: student.phone, text: finalText, dedupeKey, consent: student.whatsappOptOut !== true, studentId: String(studentId), studentName: student.name, manual: true }, { client });
  return out;
}

const STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed', 'skipped'];

function publicMessage(m) {
  return {
    id: String(m._id), type: m.type, status: m.status, to: m.to || null,
    studentId: m.studentId || null, studentName: m.studentName || null, text: m.text || '',
    reason: m.reason || null, error: m.error || null, attempts: m.attempts || 0,
    createdAt: m.createdAt, updatedAt: m.updatedAt, deliveredAt: m.deliveredAt || null, readAt: m.readAt || null,
    canResend: m.status === 'failed' || m.status === 'skipped',
  };
}

/** Send (or resend) the receipt for one payment. Same dedupe key as auto-receipts, so a failed/skipped row is retried in place. */
export async function sendReceipt({ tenantId, libraryId, receiptNo, type = 'admission_receipt', client }) {
  const payment = await models.payments.findOne({ tenantId, _key: String(receiptNo) }).lean();
  if (!payment) return { httpStatus: 404, error: 'Payment not found' };
  const student = payment.studentId ? await models.students.findOne({ tenantId, _key: String(payment.studentId) }).lean() : null;
  if (!student?.phone) return { httpStatus: 400, error: 'Student has no phone number' };
  return sendWhatsappMessage({ libraryId, type, to: student.phone, text: buildReceiptText(payment, student), dedupeKey: `receipt:${payment._key}`, consent: student.whatsappOptOut !== true, studentId: payment.studentId, studentName: student.name }, { client });
}

/* ---------------------------------------------------------------- Delivery webhook */
/** Public base URL of this API, used for the Evolution webhook. */
export function webhookBaseUrl(req) {
  const env = process.env.WEBHOOK_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (env) return env.replace(/\/+$/, '');
  return req ? `${req.protocol}://${req.get('host')}` : null;
}
export const webhookUrlFor = (base, instance) => `${base}/api/whatsapp/webhook/${encodeURIComponent(instance)}?token=${webhookTokenFor(instance)}`;

/** Point the instance's MESSAGES_UPDATE webhook at us. Never fails the caller. */
export async function registerWebhook(client, instance, base) {
  if (!base || !webhookTokenFor(instance) || !client.setWebhook) return false;
  try { await client.setWebhook(instance, webhookUrlFor(base, instance)); return true; }
  catch (e) { console.error('[whatsapp] webhook register failed:', e.message); return false; }
}

// Evolution/Baileys ack names (and numeric acks) -> our statuses.
const ACK = { ERROR: 'failed', PENDING: 'sent', SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read', PLAYED: 'read', 0: 'failed', 1: 'sent', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' };
export const mapAckStatus = (s) => ACK[typeof s === 'string' ? s.toUpperCase() : s] || null;
const RANK = { queued: 0, skipped: 0, failed: 1, sent: 2, delivered: 3, read: 4 };

/** Apply one MESSAGES_UPDATE item. Status only moves forward (read never goes back to delivered). */
export async function applyStatusUpdate(instance, item, Message = WhatsappMessage) {
  const id = item?.keyId || item?.key?.id || item?.messageId || item?.id;
  const status = mapAckStatus(item?.status ?? item?.update?.status);
  if (!id || !status) return false;
  const m = await Message.findOne({ providerMessageId: String(id) }).lean();
  if (!m || instanceNameFor(m.libraryId) !== instance) return false; // tenant check: the update must come from the library's own instance
  if (status === 'failed' ? RANK[m.status] >= RANK.delivered : RANK[status] <= RANK[m.status]) return false;
  const set = { status };
  if (status === 'delivered') set.deliveredAt = new Date();
  if (status === 'read') { set.readAt = new Date(); if (!m.deliveredAt) set.deliveredAt = new Date(); }
  if (status === 'failed') set.error = 'WhatsApp reported the message as not delivered';
  await Message.updateOne({ _id: m._id }, { $set: set });
  return true;
}

const safeEqual = (a, b) => { const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Public (no login) router: POST /webhook/:instance?token=... from Evolution. */
export function createWhatsappWebhookRouter({ Message = WhatsappMessage } = {}) {
  const r = express.Router();
  r.post('/webhook/:instance', wrap(async (req, res) => {
    const expected = webhookTokenFor(req.params.instance);
    if (!expected) return res.status(503).json({ error: 'WhatsApp integration is not configured on the server' });
    if (!safeEqual(req.query.token || req.get('x-webhook-token'), expected)) return res.status(401).json({ error: 'Invalid webhook token' });
    const ev = String(req.body?.event || '').toLowerCase().replace(/_/g, '.');
    if (ev && ev !== 'messages.update') return res.json({ ok: true, ignored: true });
    const data = req.body?.data;
    let updated = 0;
    for (const item of Array.isArray(data) ? data : [data]) if (await applyStatusUpdate(req.params.instance, item, Message)) updated++;
    res.json({ ok: true, updated });
  }));
  return r;
}

function pickToggles(o) {
  const out = {};
  for (const k of Object.keys(DEFAULT_TOGGLES)) if (typeof o[k] === 'boolean') out[k] = o[k];
  return out;
}

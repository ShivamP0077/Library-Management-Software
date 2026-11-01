import express from 'express';
import mongoose from 'mongoose';
import { Library, models } from './models.js';
import { createEvolutionClient, evolutionConfigured, instanceNameFor, normalizePhone } from './evolution.js';

/* ---------------------------------------------------------------- Models */
export const MESSAGE_TYPES = ['otp', 'admission_receipt', 'renewal_receipt', 'fee_reminder', 'expiry_reminder', 'test'];
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
  status: { type: String, enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
  providerMessageId: String,
  error: String,
  attempts: { type: Number, default: 0 },
}, { timestamps: true });
msgSchema.index({ libraryId: 1, dedupeKey: 1 }, { unique: true });
export const WhatsappMessage = mongoose.models.WhatsappMessage || mongoose.model('WhatsappMessage', msgSchema);

const TOGGLE_FOR_TYPE = { otp: 'otp', admission_receipt: 'receipts', renewal_receipt: 'receipts', fee_reminder: 'feeReminders', expiry_reminder: 'expiryReminders', test: null };

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
export async function sendWhatsappMessage({ libraryId, type, to, text, dedupeKey, consent = true }, deps = {}) {
  const { client = createEvolutionClient(), Config = WhatsappConfig, Message = WhatsappMessage, Lib = Library } = deps;
  if (!MESSAGE_TYPES.includes(type)) throw Object.assign(new Error('Unknown message type'), { status: 400 });
  if (!dedupeKey) throw Object.assign(new Error('dedupeKey is required'), { status: 400 });
  const cfg = { ...DEFAULT_TOGGLES, ...((await Config.findOne({ libraryId }).lean()) || {}) };
  const toggle = TOGGLE_FOR_TYPE[type];
  if (!cfg.enabled || (toggle && !cfg[toggle])) return { status: 'skipped', reason: 'disabled' };
  if (!consent) return { status: 'skipped', reason: 'no_consent' };
  const number = normalizePhone(to);
  if (!number) return { status: 'skipped', reason: 'invalid_number' };

  const existing = await Message.findOne({ libraryId, dedupeKey }).lean();
  if (existing && ['sent', 'queued'].includes(existing.status)) return { status: 'duplicate', id: String(existing._id) };
  const lib = await Lib.findOne({ libraryId }).lean();
  const body = `*${lib?.name || 'Your library'}*\n${String(text || '').trim()}`;

  const log = await Message.findOneAndUpdate(
    { libraryId, dedupeKey },
    { $set: { type, to: number, status: 'queued', error: null }, $inc: { attempts: 1 } },
    { upsert: true, new: true }
  );
  try {
    const r = await client.sendText(instanceNameFor(libraryId), number, body);
    await Message.updateOne({ _id: log._id }, { $set: { status: 'sent', providerMessageId: r?.key?.id || null } });
    return { status: 'sent', id: String(log._id) };
  } catch (e) {
    await Message.updateOne({ _id: log._id }, { $set: { status: 'failed', error: String(e.message).slice(0, 300) } });
    return { status: 'failed', error: e.message, id: String(log._id) };
  }
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

export function createWhatsappRouter({ client = createEvolutionClient(), isConfigured = () => evolutionConfigured() } = {}) {
  const r = express.Router();
  const guard = wrap(async (req, res, next) => {
    if (!(await canManageWhatsapp(req.user, req.libraryId))) return res.status(403).json({ error: 'You do not have permission to manage WhatsApp' });
    if (!isConfigured()) return res.status(503).json({ error: 'WhatsApp integration is not configured on the server' });
    req.instance = instanceNameFor(req.libraryId);
    next();
  });
  r.use(guard);

  async function status(name) {
    const inst = await client.findInstance(name);
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
    if (!(await client.findInstance(req.instance))) created = await client.createInstance(req.instance);
    const s = await status(req.instance);
    if (s.state === 'connected') return res.json(s);
    const c = await client.connect(req.instance);
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
    const payment = await models.payments.findOne({ tenantId: req.tenantId || req.libraryId, _key: req.params.receiptNo }).lean();
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const student = payment.studentId ? await models.students.findOne({ tenantId: req.tenantId || req.libraryId, _key: String(payment.studentId) }).lean() : null;
    if (!student?.phone) return res.status(400).json({ error: 'Student has no phone number' });
    const type = req.body?.type === 'renewal_receipt' ? 'renewal_receipt' : 'admission_receipt';
    const out = await sendWhatsappMessage({ libraryId: req.libraryId, type, to: student.phone, text: buildReceiptText(payment, student), dedupeKey: `receipt:${payment._key}`, consent: student.whatsappOptOut !== true }, { client });
    res.status(out.status === 'failed' ? 502 : 200).json(out);
  }));

  return r;
}

function pickToggles(o) {
  const out = {};
  for (const k of Object.keys(DEFAULT_TOGGLES)) if (typeof o[k] === 'boolean') out[k] = o[k];
  return out;
}

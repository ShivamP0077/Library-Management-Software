/**
 * Help & Support tickets and owner data exports (spec §10, OPS-01, Issue #20).
 * - Tickets are tenant-scoped (tenantGuard). Owners see all their library's tickets; staff see only
 *   tickets they raised. Super Admin replies, assigns and changes status from /admin/support.
 * - Ticket numbers are globally unique and chronological. They are allocated from a single atomic
 *   SupportTicketCounter document; existing per-tenant numbers are preserved as `legacyAliases` by
 *   scripts/support-global-numbering.mjs (dry-run by default).
 * - Attachments: JPG/PNG/WEBP/PDF, max 5 MB, at most 3 per support message.
 * - Every ticket action and every export is written to the audit log.
 * - Exports (CSV) respect the viewer's module permission; they never cross tenants.
 */
import mongoose from 'mongoose';
import express from 'express';
import tenantGuard, { applyBulkWriteGuard } from './tenantGuard.js';
import { models, Library } from './models.js';
import { audit } from './audit.js';
import { viewerScope, ALLOWED_TYPES, MAX_ATTACHMENT, MAX_SUPPORT_TOTAL, notify } from './notifications.js';
import { toCsv, registerSaasKpi } from './insights.js';

export const TICKET_CATEGORIES = ['general', 'billing', 'technical', 'whatsapp', 'account', 'data', 'feature_request'];
// Kept for backward compatibility: legacy tickets may still use waiting_on_customer/closed.
export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'];
// `medium`/`critical` are the Issue #20 labels; normal/urgent remain accepted for legacy clients.
export const TICKET_PRIORITIES = ['low', 'medium', 'normal', 'high', 'urgent', 'critical'];
const MAX_FILES = 3;
export const SUPPORT_NUMBERING_VERSION = '2026-11-global-v1';
export const SUPPORT_COUNTER_ID = 'support-ticket-global';

const attachmentSchema = new mongoose.Schema({ name: String, type: { type: String }, size: Number, data: String }, { _id: true });
const legacyAliasSchema = new mongoose.Schema({
  tenantId: String,
  number: Number,
  label: String, // e.g. "#12" — exact searchable alias
}, { _id: false });
const statusEventSchema = new mongoose.Schema({ status: String, byId: String, byEmail: String, at: { type: Date, default: Date.now } }, { _id: false });
const messageSchema = new mongoose.Schema({
  authorId: String, authorEmail: String, authorRole: String, fromSupport: Boolean,
  body: String, clientMessageId: String, status: { type: String, default: 'sent' },
  attachments: [attachmentSchema], at: { type: Date, default: Date.now },
});
const internalNoteSchema = new mongoose.Schema({
  authorId: String, authorEmail: String, body: String, at: { type: Date, default: Date.now },
}, { _id: true });
const ticketSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  number: { type: Number, required: true },
  subject: { type: String, required: true },
  category: { type: String, enum: TICKET_CATEGORIES, default: 'general' },
  priority: { type: String, enum: TICKET_PRIORITIES, default: 'normal' },
  status: { type: String, enum: TICKET_STATUSES, default: 'open' },
  createdById: String, createdByEmail: String, createdByRole: String,
  assignedTo: String, // support agent email (Super Admin side)
  clientRequestId: String,
  legacyAliases: { type: [legacyAliasSchema], default: [] },
  migrationVersion: String,
  messages: [messageSchema],
  internalNotes: { type: [internalNoteSchema], default: [] }, // admin-only, never exposed to owners
  statusHistory: { type: [statusEventSchema], default: [] },
  lastMessageAt: { type: Date, default: Date.now },
  firstResponseAt: Date, resolvedAt: Date, closedAt: Date,
  // Per-side read cursors. Missing on older tickets; unread then counts every message from the other side.
  ownerLastReadAt: Date,
  adminLastReadAt: Date,
  // Legacy tickets (pre-messages[]) may store the opening text and the first staff reply here.
  // They are shown as chat messages on read and are never written back.
  description: String,
  reply: String,
}, { timestamps: true });
// Deliberately no {tenantId, number} unique index and no global unique index here: duplicates
// already exist in production and auto-index creation would fail. scripts/support-global-numbering.mjs
// renumbers the data, drops the legacy per-tenant index and creates number_1 unique.
ticketSchema.index({ tenantId: 1, status: 1, lastMessageAt: -1 });
ticketSchema.plugin(tenantGuard);
export const SupportTicket = applyBulkWriteGuard(mongoose.models.SupportTicket || mongoose.model('SupportTicket', ticketSchema));

const counterSchema = new mongoose.Schema({
  _id: { type: String, default: SUPPORT_COUNTER_ID },
  value: { type: Number, default: 0 },
  migrationVersion: String,
}, { timestamps: true, versionKey: false });
export const SupportTicketCounter = mongoose.models.SupportTicketCounter || mongoose.model('SupportTicketCounter', counterSchema);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isOwnerSide = (req) => req.user.role !== 'staff';

export function parseAttachments(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length > MAX_FILES) throw Object.assign(new Error(`At most ${MAX_FILES} files per message`), { status: 400 });
  let totalBytes = 0;
  return arr.map(a => {
    const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(a?.data || ''));
    if (!m || !ALLOWED_TYPES.includes(m[1])) throw Object.assign(new Error('Only JPG, PNG, WEBP or PDF files are allowed'), { status: 400 });
    const size = m[2].replace(/=+$/, '').length * 3 / 4;
    if (size > MAX_ATTACHMENT) throw Object.assign(new Error('File is larger than 5 MB'), { status: 413, code: 'ATTACHMENT_TOO_LARGE' });
    totalBytes += size;
    if (totalBytes > MAX_SUPPORT_TOTAL) throw Object.assign(new Error('Support attachments must be 8 MB or less in total'), { status: 413, code: 'SUPPORT_TOTAL_TOO_LARGE' });
    return { name: String(a.name || 'file').replace(/[^\w .()-]/g, '_').slice(0, 120), type: m[1], size, data: a.data };
  });
}
const pubAttachment = (a) => ({ id: String(a._id), name: a.name, type: a.type, size: a.size });
const pubMsg = (m) => ({
  id: String(m._id), clientMessageId: m.clientMessageId || null, status: m.status || 'sent',
  authorEmail: m.authorEmail, authorRole: m.authorRole, fromSupport: !!m.fromSupport, body: m.body, at: m.at,
  attachments: (m.attachments || []).map(pubAttachment),
});

/**
 * Messages to show in the thread. Stored messages win. When an old ticket has none, a legacy
 * `description` / `reply` is presented as the first messages. Nothing is written back to the DB.
 */
export function presentMessages(t) {
  const stored = Array.isArray(t?.messages) ? t.messages : [];
  if (stored.length) return stored;
  const out = [];
  const description = typeof t?.description === 'string' ? t.description.trim() : '';
  const reply = typeof t?.reply === 'string' ? t.reply.trim() : '';
  if (description) {
    out.push({
      _id: 'legacy-description', authorEmail: t.createdByEmail || '', authorRole: t.createdByRole || 'client_admin',
      fromSupport: false, body: description, status: 'sent', attachments: [], at: t.createdAt || t.lastMessageAt || null,
    });
  }
  if (reply) {
    out.push({
      _id: 'legacy-reply', authorEmail: t.assignedTo || 'support', authorRole: 'super_admin',
      fromSupport: true, body: reply, status: 'sent', attachments: [],
      at: t.firstResponseAt || t.updatedAt || t.createdAt || null,
    });
  }
  return out;
}

/** Messages from the other side that arrived after this side's last read. No cursor ⇒ all of them. */
export function countUnread(t, side, messages = presentMessages(t)) {
  const readAt = side === 'admin' ? t?.adminLastReadAt : t?.ownerLastReadAt;
  const readMs = readAt ? new Date(readAt).getTime() : null;
  let n = 0;
  for (const m of messages) {
    const fromOther = side === 'admin' ? !m.fromSupport : !!m.fromSupport;
    if (!fromOther) continue;
    if (readMs == null || Number.isNaN(readMs)) { n += 1; continue; }
    const at = new Date(m.at || 0).getTime();
    if (at > readMs) n += 1;
  }
  return n;
}

/** Lightweight read cursor. Does not touch updatedAt, messages, or ticket numbers. */
export async function markTicketRead(t, side) {
  const field = side === 'admin' ? 'adminLastReadAt' : 'ownerLastReadAt';
  const now = new Date();
  const q = SupportTicket.updateOne({ _id: t._id, tenantId: t.tenantId }, { $set: { [field]: now } }, { timestamps: false });
  if (side === 'admin') q.setOptions({ skipTenantGuard: true });
  await q;
  if (typeof t.set === 'function') t.set(field, now);
  else t[field] = now;
  return now;
}
const pubInternalNote = (n) => ({ id: String(n._id), authorEmail: n.authorEmail, body: n.body, at: n.at });
export const ticketNumberLabel = (number) => `#${String(Math.max(0, Number(number) || 0)).padStart(6, '0')}`;

export const pubTicket = (t, { full = false, admin = false } = {}) => {
  const side = admin ? 'admin' : 'owner';
  const shown = presentMessages(t);
  return {
    id: String(t._id), tenantId: t.tenantId, number: t.number, numberLabel: ticketNumberLabel(t.number),
    subject: t.subject, category: t.category, priority: t.priority, status: t.status,
    createdByEmail: t.createdByEmail, assignedTo: t.assignedTo || null, createdAt: t.createdAt, updatedAt: t.updatedAt, lastMessageAt: t.lastMessageAt,
    firstResponseAt: t.firstResponseAt || null, resolvedAt: t.resolvedAt || null, closedAt: t.closedAt || null,
    messageCount: shown.length,
    unreadCount: countUnread(t, side, shown),
    ...(side === 'admin' ? { adminLastReadAt: t.adminLastReadAt || null } : { ownerLastReadAt: t.ownerLastReadAt || null }),
    legacyAliases: (t.legacyAliases || []).map(a => ({ tenantId: a.tenantId, number: a.number, label: a.label })),
    migrationVersion: t.migrationVersion || null,
    ...(full ? { messages: shown.map(pubMsg), statusHistory: (t.statusHistory || []).map(e => ({ status: e.status, byEmail: e.byEmail, at: e.at })) } : {}),
    // Internal notes are only ever included on the Super Admin router.
    ...(admin && full ? { internalNotes: (t.internalNotes || []).map(pubInternalNote) } : {}),
  };
};

const statusStamps = (status) => ({
  ...(status === 'resolved' ? { resolvedAt: new Date() } : {}),
  ...(status === 'closed' ? { closedAt: new Date() } : {}),
  ...(['open', 'in_progress', 'waiting_on_customer'].includes(status) ? { resolvedAt: null, closedAt: null } : {}),
});
const statusEvent = (req, status) => ({ status, byId: String(req.user.id), byEmail: req.user.email, at: new Date() });

/* ------------------------------------------------------------ global numbering */
const counterRetry = async (fn) => {
  let last;
  for (let i = 0; i < 6; i++) {
    try { return await fn(); } catch (e) {
      if (e?.code !== 11000) throw e;
      last = e;
      await new Promise(r => setTimeout(r, 5 * (i + 1)));
    }
  }
  throw last;
};

/** Highest ticket number currently stored, across every tenant. */
export async function maxSupportTicketNumber() {
  const [row] = await SupportTicket.aggregate([{ $group: { _id: null, max: { $max: '$number' } } }])
    .option({ skipTenantGuard: true });
  return Number(row?.max) || 0;
}

/** Move the atomic counter forward to at least the highest stored number (never backwards). */
export async function syncSupportTicketCounter() {
  const max = await maxSupportTicketNumber();
  await counterRetry(() => SupportTicketCounter.updateOne(
    { _id: SUPPORT_COUNTER_ID },
    { $max: { value: max }, $setOnInsert: { migrationVersion: SUPPORT_NUMBERING_VERSION } },
    { upsert: true }
  ));
  return max;
}

/** Allocate the next globally unique, chronological ticket number. */
export async function nextSupportTicketNumber() {
  await syncSupportTicketCounter();
  const counter = await counterRetry(() => SupportTicketCounter.findOneAndUpdate(
    { _id: SUPPORT_COUNTER_ID },
    { $inc: { value: 1 }, $setOnInsert: { migrationVersion: SUPPORT_NUMBERING_VERSION } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ));
  return Number(counter.value);
}

const globalIndexName = 'number_1';
async function ticketIndexes() {
  try { return await SupportTicket.collection.indexes(); } catch (e) {
    if (e.code === 26 || /ns does not exist/i.test(e.message)) return [];
    throw e;
  }
}

export async function detectSupportNumberDuplicates() {
  return SupportTicket.aggregate([
    { $group: { _id: '$number', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 50 },
  ]).option({ skipTenantGuard: true });
}

/**
 * Safe startup helper: create the global unique number index only when the data is already
 * duplicate-free. If duplicates exist, leave the database untouched and return a warning so the
 * migration script can run first. Never drops indexes here.
 */
export async function ensureSupportGlobalNumberIndex({ log = console.log } = {}) {
  const duplicates = await detectSupportNumberDuplicates();
  if (duplicates.length) {
    log(`[support] Global ticket-number index not created: ${duplicates.length} duplicate number group(s) need scripts/support-global-numbering.mjs`);
    return { created: false, duplicates };
  }
  const indexes = await ticketIndexes();
  const existing = indexes.find(ix => ix.name === globalIndexName || (Object.keys(ix.key || {}).length === 1 && ix.key.number === 1));
  if (existing?.unique) return { created: false, duplicates: [] };
  if (existing) await SupportTicket.collection.dropIndex(existing.name);
  await SupportTicket.collection.createIndex({ number: 1 }, { unique: true, name: globalIndexName });
  log('[support] Global ticket-number unique index created');
  return { created: true, duplicates: [] };
}

/* ------------------------------------------------------------ search helpers */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const parsedNumber = (raw) => {
  const m = /^#?\s*0*(\d{1,9})\s*$/.exec(String(raw || '').trim());
  return m ? Number(m[1]) : null;
};
/** Exact ticket number/alias, or a safely-escaped subject/library search. */
function searchClause(raw) {
  const term = String(raw || '').trim().slice(0, 160);
  if (!term) return null;
  const or = [{ subject: { $regex: escapeRegex(term), $options: 'i' } }];
  const n = parsedNumber(term);
  if (n !== null) {
    or.push({ number: n });
    or.push({ 'legacyAliases.number': n });
    or.push({ 'legacyAliases.label': `#${n}` });
  }
  or.push({ 'legacyAliases.label': term });
  const alias = /^([^#]+)#(\d+)$/.exec(term);
  if (alias) or.push({ legacyAliases: { $elemMatch: { tenantId: alias[1].trim(), number: Number(alias[2]) } } });
  return { $or: or };
}
const pagination = (req, def = 50) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || def, 1), 200);
  return { page, limit, skip: (page - 1) * limit };
};

const ticketQuery = (req, extra = {}) => ({ tenantId: req.tenantId, ...(isOwnerSide(req) ? {} : { createdById: String(req.user.id) }), ...extra });
async function findTicket(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return SupportTicket.findOne(ticketQuery(req, { _id: req.params.id }));
}
function sendAttachment(res, t, msgId, attId) {
  const m = (t.messages || []).find(x => String(x._id) === msgId);
  const a = m && (m.attachments || []).find(x => String(x._id) === attId);
  if (!a) return res.status(404).json({ error: 'Attachment not found' });
  res.json({ name: a.name, type: a.type, data: a.data });
}

const idempotentFilter = (clientMessageId, authorId) => (
  clientMessageId ? { messages: { $not: { $elemMatch: { clientMessageId, authorId } } } } : {}
);
const findIdempotentMessage = (req, ticketId, clientMessageId, authorId) => (
  SupportTicket.findOne(ticketQuery(req, { _id: ticketId, messages: { $elemMatch: { clientMessageId, authorId } } }))
);

/* ------------------------------------------------------------ exports */
const EXPORTS = {
  students: { module: 'students', cols: [['id', 'Student ID'], ['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['seatNo', 'Seat'], ['shift', 'Shift'], ['status', 'Status'], ['joiningDate', 'Joining date'], ['expiryDate', 'Expiry date'], ['branchId', 'Branch']] },
  payments: { module: 'payments', cols: [['receiptNo', 'Receipt'], ['date', 'Date'], ['studentId', 'Student ID'], ['studentName', 'Student'], ['netTotal', 'Net total'], ['amount', 'Amount paid'], ['mode', 'Mode'], ['status', 'Status'], ['branchId', 'Branch']] },
  expenses: { module: 'expenses', cols: [['id', 'ID'], ['date', 'Date'], ['category', 'Category'], ['description', 'Description'], ['amount', 'Amount'], ['mode', 'Mode'], ['branchId', 'Branch']] },
};
export async function canExport(req, kind) {
  const scope = await viewerScope(req);
  if (scope.owner) return true;
  // reuse the notification category → module mapping (students/payments/expenses are categories there)
  return scope.can(EXPORTS[kind].module);
}

/* ------------------------------------------------------------ tenant routes */
export function createSupportRouter() {
  const r = express.Router();

  r.get('/support/meta', (req, res) => res.json({
    categories: TICKET_CATEGORIES, statuses: TICKET_STATUSES, priorities: TICKET_PRIORITIES,
    maxFiles: MAX_FILES, maxBytes: MAX_ATTACHMENT, types: ALLOWED_TYPES,
  }));

  r.get('/support/tickets', wrap(async (req, res) => {
    const q = ticketQuery(req);
    if (req.query.status && TICKET_STATUSES.includes(req.query.status)) q.status = req.query.status;
    if (req.query.priority && TICKET_PRIORITIES.includes(req.query.priority)) q.priority = req.query.priority === 'normal' ? { $in: ['normal', 'medium'] } : req.query.priority === 'high' ? { $in: ['high', 'critical', 'urgent'] } : { $in: [req.query.priority] };
    const search = searchClause(req.query.search || req.query.q);
    if (search) Object.assign(q, search);
    const { page, limit, skip } = pagination(req);
    const [list, total] = await Promise.all([
      SupportTicket.find(q).select('-messages.attachments.data -internalNotes').sort({ number: -1 }).skip(skip).limit(limit).lean(),
      SupportTicket.countDocuments(q),
    ]);
    res.set('X-Page', String(page)).set('X-Limit', String(limit)).set('X-Total-Count', String(total));
    res.json(list.map(t => pubTicket(t)));
  }));

  r.post('/support/tickets', wrap(async (req, res) => {
    if (req.readOnly) return res.status(403).json({ error: 'Read-only access' });
    const { subject, category = 'general', priority = 'normal', message, attachments, clientRequestId } = req.body || {};
    if (!subject || String(subject).trim().length < 3) return res.status(400).json({ error: 'Subject is required' });
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'Describe the problem' });
    if (!TICKET_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });
    if (!TICKET_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Unknown priority' });
    const files = parseAttachments(attachments);
    const requestId = clientRequestId ? String(clientRequestId).slice(0, 120) : null;
    if (requestId) {
      const existing = await SupportTicket.findOne({ tenantId: req.tenantId, createdById: String(req.user.id), clientRequestId: requestId });
      if (existing) return res.status(200).json(pubTicket(existing.toObject(), { full: true }));
    }
    let t;
    for (let i = 0; i < 8 && !t; i++) {
      try {
        t = await SupportTicket.create({
          tenantId: req.tenantId, number: await nextSupportTicketNumber(),
          subject: String(subject).trim().slice(0, 160), category, priority,
          createdById: String(req.user.id), createdByEmail: req.user.email, createdByRole: req.user.role,
          clientRequestId: requestId || undefined,
          migrationVersion: SUPPORT_NUMBERING_VERSION,
          legacyAliases: [],
          statusHistory: [statusEvent(req, 'open')],
          messages: [{
            authorId: String(req.user.id), authorEmail: req.user.email, authorRole: req.user.role,
            fromSupport: false, body: String(message).slice(0, 5000), status: 'sent', attachments: files,
          }],
        });
      } catch (e) {
        if (e?.code !== 11000) throw e;
        if (requestId) {
          const existing = await SupportTicket.findOne({ tenantId: req.tenantId, createdById: String(req.user.id), clientRequestId: requestId });
          if (existing) return res.status(200).json(pubTicket(existing.toObject(), { full: true }));
        }
      }
    }
    if (!t) return res.status(409).json({ error: 'Could not allocate a ticket number. Please retry.', code: 'TICKET_NUMBER_CONFLICT' });
    await audit(req, 'support.ticket_create', { target: ticketNumberLabel(t.number), detail: { category, priority, files: files.length } });
    res.status(201).json(pubTicket(t.toObject(), { full: true }));
  }));

  r.get('/support/tickets/:id', wrap(async (req, res) => {
    const t = await findTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    await markTicketRead(t, 'owner');
    res.json(pubTicket(t.toObject(), { full: true }));
  }));

  r.post('/support/tickets/:id/read', wrap(async (req, res) => {
    const t = await findTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const at = await markTicketRead(t, 'owner');
    res.json({ ok: true, unreadCount: 0, ownerLastReadAt: at });
  }));

  r.get('/support/tickets/:id/messages/:mid/attachments/:aid', wrap(async (req, res) => {
    const t = await findTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    sendAttachment(res, t, req.params.mid, req.params.aid);
  }));

  r.post('/support/tickets/:id/messages', wrap(async (req, res) => {
    if (req.readOnly) return res.status(403).json({ error: 'Read-only access' });
    const t = await findTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const clientMessageId = req.body?.clientMessageId ? String(req.body.clientMessageId).slice(0, 120) : null;
    const authorId = String(req.user.id);
    // A retry with the same id must return the already-saved ticket, not append a second message.
    if (clientMessageId) {
      const already = await findIdempotentMessage(req, t._id, clientMessageId, authorId);
      if (already) return res.status(200).json(pubTicket(already.toObject(), { full: true }));
    }
    if (t.status === 'closed') return res.status(409).json({ error: 'This ticket is closed. Open a new one.' });
    const body = String(req.body?.message || '').trim();
    const files = parseAttachments(req.body?.attachments);
    if (!body && !files.length) return res.status(400).json({ error: 'Message is empty' });
    const now = new Date();
    const reopen = t.status === 'waiting_on_customer' || t.status === 'resolved';
    const update = {
      $push: {
        messages: {
          authorId, authorEmail: req.user.email, authorRole: req.user.role, fromSupport: false,
          body: body.slice(0, 5000), clientMessageId: clientMessageId || undefined,
          status: 'sent', attachments: files,
        },
        ...(reopen ? { statusHistory: statusEvent(req, 'open') } : {}),
      },
      $set: { lastMessageAt: now, ownerLastReadAt: now, ...(reopen ? { status: 'open', resolvedAt: null, closedAt: null } : {}) },
    };
    const u = await SupportTicket.findOneAndUpdate(
      ticketQuery(req, { _id: t._id, ...idempotentFilter(clientMessageId, authorId) }),
      update,
      { new: true }
    );
    if (!u && clientMessageId) {
      const already = await findIdempotentMessage(req, t._id, clientMessageId, authorId);
      if (already) return res.status(200).json(pubTicket(already.toObject(), { full: true }));
    }
    if (!u) return res.status(409).json({ error: 'Message could not be saved. Please retry.', code: 'MESSAGE_CONFLICT' });
    await audit(req, 'support.ticket_reply', { target: ticketNumberLabel(t.number), detail: { files: files.length } });
    res.json(pubTicket(u.toObject(), { full: true }));
  }));

  /** Customer side may close (or reopen a resolved) ticket. */
  r.patch('/support/tickets/:id', wrap(async (req, res) => {
    if (req.readOnly) return res.status(403).json({ error: 'Read-only access' });
    const t = await findTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const status = req.body?.status;
    if (!['closed', 'open'].includes(status)) return res.status(400).json({ error: 'You can only close or reopen a ticket' });
    const u = await SupportTicket.findOneAndUpdate(
      { tenantId: req.tenantId, _id: t._id },
      { $set: { status, ...statusStamps(status) }, $push: { statusHistory: statusEvent(req, status) } },
      { new: true }
    );
    await audit(req, 'support.ticket_status', { target: ticketNumberLabel(t.number), detail: { from: t.status, to: status } });
    res.json(pubTicket(u.toObject(), { full: true }));
  }));

  /* exports */
  r.get('/export/:kind.csv', wrap(async (req, res) => {
    const kind = req.params.kind;
    if (!EXPORTS[kind]) return res.status(404).json({ error: 'Unknown export' });
    if (!(await canExport(req, kind))) return res.status(403).json({ error: 'You do not have permission to export this data' });
    const q = { tenantId: req.tenantId };
    if (req.query.from || req.query.to) {
      q.date = {};
      if (req.query.from) q.date.$gte = String(req.query.from);
      if (req.query.to) q.date.$lte = String(req.query.to);
      if (kind === 'students') { delete q.date; }
    }
    const rows = await models[kind].find(q).lean();
    const csv = toCsv(rows, EXPORTS[kind].cols.map(([key, label]) => ({ key, label })));
    await audit(req, 'data.export', { target: kind, detail: { rows: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\ufeff' + csv);
  }));

  return r;
}

/* ------------------------------------------------------------ Super Admin (support desk) */
export function createSupportAdminRouter() {
  const r = express.Router();
  const findAny = async (id) => (mongoose.isValidObjectId(id) ? SupportTicket.findOne({ _id: id }).setOptions({ skipTenantGuard: true }) : null);

  r.get('/support/tickets', wrap(async (req, res) => {
    const q = {};
    if (req.query.status && TICKET_STATUSES.includes(req.query.status)) q.status = req.query.status;
    if (req.query.priority && TICKET_PRIORITIES.includes(req.query.priority)) q.priority = req.query.priority === 'normal' ? { $in: ['normal', 'medium'] } : req.query.priority === 'high' ? { $in: ['high', 'critical', 'urgent'] } : { $in: [req.query.priority] };
    if (req.query.libraryId) q.tenantId = String(req.query.libraryId);
    const term = String(req.query.search || req.query.q || '').trim().slice(0, 160);
    if (term) {
      const or = searchClause(term).$or;
      const safe = escapeRegex(term);
      const libs = await Library.find({ $or: [{ libraryId: { $regex: safe, $options: 'i' } }, { name: { $regex: safe, $options: 'i' } }] })
        .select('libraryId').lean();
      if (libs.length) or.push({ tenantId: { $in: libs.map(l => l.libraryId) } });
      q.$or = or;
    }
    const sortParam = String(req.query.sort || 'newest');
    const sort = sortParam === 'oldest' ? { number: 1 }
      : sortParam === 'activity' ? { lastMessageAt: -1 }
        : { number: -1 };
    const { page, limit, skip } = pagination(req, 50);
    const [list, total] = await Promise.all([
      SupportTicket.find(q).setOptions({ skipTenantGuard: true })
        .select('tenantId number subject category priority status createdByEmail createdByRole assignedTo createdAt updatedAt lastMessageAt firstResponseAt resolvedAt closedAt legacyAliases migrationVersion ownerLastReadAt adminLastReadAt description reply messages.fromSupport messages.at')
        .sort(sort).skip(skip).limit(limit).lean(),
      SupportTicket.countDocuments(q).setOptions({ skipTenantGuard: true }),
    ]);
    const libs = await Library.find({ libraryId: { $in: [...new Set(list.map(t => t.tenantId))] } }).select('name libraryId').lean();
    const names = Object.fromEntries(libs.map(l => [l.libraryId, l.name]));
    res.set('X-Page', String(page)).set('X-Limit', String(limit)).set('X-Total-Count', String(total));
    res.json(list.map(t => ({ ...pubTicket(t, { admin: true }), libraryName: names[t.tenantId] || t.tenantId })));
  }));

  r.get('/support/tickets/:id', wrap(async (req, res) => {
    const t = await findAny(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    await markTicketRead(t, 'admin');
    await audit(req, 'support.ticket_view', { tenantId: t.tenantId, target: ticketNumberLabel(t.number) });
    res.json(pubTicket(t.toObject(), { full: true, admin: true }));
  }));

  r.post('/support/tickets/:id/read', wrap(async (req, res) => {
    const t = await findAny(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const at = await markTicketRead(t, 'admin');
    res.json({ ok: true, unreadCount: 0, adminLastReadAt: at });
  }));

  r.get('/support/tickets/:id/messages/:mid/attachments/:aid', wrap(async (req, res) => {
    const t = await findAny(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    sendAttachment(res, t, req.params.mid, req.params.aid);
  }));

  r.post('/support/tickets/:id/messages', wrap(async (req, res) => {
    const t = await findAny(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const clientMessageId = req.body?.clientMessageId ? String(req.body.clientMessageId).slice(0, 120) : null;
    const authorId = String(req.user.id);
    if (clientMessageId) {
      const already = await SupportTicket.findOne({ tenantId: t.tenantId, _id: t._id, messages: { $elemMatch: { clientMessageId, authorId } } })
        .setOptions({ skipTenantGuard: true });
      if (already) return res.status(200).json(pubTicket(already.toObject(), { full: true, admin: true }));
    }
    const body = String(req.body?.message || '').trim();
    const files = parseAttachments(req.body?.attachments);
    if (!body && !files.length) return res.status(400).json({ error: 'Message is empty' });
    const status = TICKET_STATUSES.includes(req.body?.status) ? req.body.status : 'waiting_on_customer';
    const now = new Date();
    const u = await SupportTicket.findOneAndUpdate(
      { tenantId: t.tenantId, _id: t._id, ...idempotentFilter(clientMessageId, authorId) },
      {
        $push: {
          messages: {
            authorId, authorEmail: req.user.email, authorRole: req.user.role, fromSupport: true,
            body: body.slice(0, 5000), clientMessageId: clientMessageId || undefined,
            status: 'sent', attachments: files,
          },
          statusHistory: statusEvent(req, status),
        },
        $set: {
          lastMessageAt: now, adminLastReadAt: now, status, ...statusStamps(status),
          ...(t.firstResponseAt ? {} : { firstResponseAt: now }),
          ...(t.assignedTo ? {} : { assignedTo: req.user.email }),
        },
      },
      { new: true }
    ).setOptions({ skipTenantGuard: true });
    if (!u && clientMessageId) {
      const already = await SupportTicket.findOne({ tenantId: t.tenantId, _id: t._id, messages: { $elemMatch: { clientMessageId, authorId } } })
        .setOptions({ skipTenantGuard: true });
      if (already) return res.status(200).json(pubTicket(already.toObject(), { full: true, admin: true }));
    }
    if (!u) return res.status(409).json({ error: 'Message could not be saved. Please retry.', code: 'MESSAGE_CONFLICT' });
    await audit(req, 'support.ticket_reply', { tenantId: t.tenantId, target: ticketNumberLabel(t.number), detail: { status, files: files.length } });
    await notify(t.tenantId, {
      dedupeKey: `support:${t._id}`, category: 'support', severity: 'info', force: true,
      title: `Support replied to ticket ${ticketNumberLabel(t.number)}`, body: t.subject,
      link: { tab: 'support', params: { ticket: String(t._id) } },
    }).catch(() => {});
    res.json(pubTicket(u.toObject(), { full: true, admin: true }));
  }));

  /** Private internal notes: stored separately and never returned by tenant routes. */
  r.post('/support/tickets/:id/internal-notes', wrap(async (req, res) => {
    const t = await findAny(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const body = String(req.body?.body || req.body?.message || '').trim();
    if (!body) return res.status(400).json({ error: 'Note is empty' });
    const note = { authorId: String(req.user.id), authorEmail: req.user.email, body: body.slice(0, 5000), at: new Date() };
    const u = await SupportTicket.findOneAndUpdate(
      { tenantId: t.tenantId, _id: t._id },
      { $push: { internalNotes: note } },
      { new: true }
    ).setOptions({ skipTenantGuard: true });
    await audit(req, 'support.internal_note', { tenantId: t.tenantId, target: ticketNumberLabel(t.number) });
    res.status(201).json(pubTicket(u.toObject(), { full: true, admin: true }));
  }));

  r.patch('/support/tickets/:id', wrap(async (req, res) => {
    const t = await findAny(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const set = {};
    const push = {};
    if (req.body?.status !== undefined) {
      if (!TICKET_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status' });
      Object.assign(set, { status: req.body.status }, statusStamps(req.body.status));
      push.statusHistory = statusEvent(req, req.body.status);
    }
    if (req.body?.priority !== undefined) { if (!TICKET_PRIORITIES.includes(req.body.priority)) return res.status(400).json({ error: 'Unknown priority' }); set.priority = req.body.priority; }
    if (req.body?.category !== undefined) { if (!TICKET_CATEGORIES.includes(req.body.category)) return res.status(400).json({ error: 'Unknown category' }); set.category = req.body.category; }
    if (req.body?.assignedTo !== undefined) set.assignedTo = req.body.assignedTo ? String(req.body.assignedTo).slice(0, 160) : null;
    const update = { $set: set, ...(Object.keys(push).length ? { $push: push } : {}) };
    const u = await SupportTicket.findOneAndUpdate({ tenantId: t.tenantId, _id: t._id }, update, { new: true }).setOptions({ skipTenantGuard: true });
    await audit(req, 'support.ticket_update', { tenantId: t.tenantId, target: ticketNumberLabel(t.number), detail: { ...set } });
    res.json(pubTicket(u.toObject(), { full: true, admin: true }));
  }));
  return r;
}

registerSaasKpi('support', async () => {
  const open = await SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress', 'waiting_on_customer'] } }).setOptions({ skipTenantGuard: true });
  const unassigned = await SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress'] }, assignedTo: { $in: [null, ''] } }).setOptions({ skipTenantGuard: true });
  return { label: 'Open support tickets', value: open, sub: `${unassigned} unassigned`, openTickets: open, unassignedTickets: unassigned };
});

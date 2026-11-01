/**
 * Help & Support tickets and owner data exports (spec §10, OPS-01).
 * - Tickets are tenant-scoped (tenantGuard). Owners see all their library's tickets; staff see only
 *   tickets they raised. Super Admin replies, assigns and changes status from /admin/support.
 * - Attachments: JPG/PNG/WEBP/PDF, max 5 MB, at most 3 per message.
 * - Every ticket action and every export is written to the audit log.
 * - Exports (CSV) respect the viewer's module permission; they never cross tenants.
 */
import mongoose from 'mongoose';
import express from 'express';
import tenantGuard, { applyBulkWriteGuard } from './tenantGuard.js';
import { models, Library } from './models.js';
import { audit } from './audit.js';
import { viewerScope, ALLOWED_TYPES, MAX_ATTACHMENT, notify } from './notifications.js';
import { toCsv, registerSaasKpi } from './insights.js';

export const TICKET_CATEGORIES = ['general', 'billing', 'technical', 'whatsapp', 'account', 'data', 'feature_request'];
export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'];
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const MAX_FILES = 3;

const attachmentSchema = new mongoose.Schema({ name: String, type: { type: String }, size: Number, data: String }, { _id: true });
const messageSchema = new mongoose.Schema({
  authorId: String, authorEmail: String, authorRole: String, fromSupport: Boolean,
  body: String, attachments: [attachmentSchema], at: { type: Date, default: Date.now },
});
const ticketSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  number: { type: Number, required: true },
  subject: { type: String, required: true },
  category: { type: String, enum: TICKET_CATEGORIES, default: 'general' },
  priority: { type: String, enum: TICKET_PRIORITIES, default: 'normal' },
  status: { type: String, enum: TICKET_STATUSES, default: 'open' },
  createdById: String, createdByEmail: String, createdByRole: String,
  assignedTo: String, // support agent email (Super Admin side)
  messages: [messageSchema],
  lastMessageAt: { type: Date, default: Date.now },
  firstResponseAt: Date, resolvedAt: Date, closedAt: Date,
}, { timestamps: true });
ticketSchema.index({ tenantId: 1, number: 1 }, { unique: true });
ticketSchema.index({ tenantId: 1, status: 1, lastMessageAt: -1 });
ticketSchema.plugin(tenantGuard);
export const SupportTicket = applyBulkWriteGuard(mongoose.models.SupportTicket || mongoose.model('SupportTicket', ticketSchema));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isOwnerSide = (req) => req.user.role !== 'staff';

export function parseAttachments(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length > MAX_FILES) throw Object.assign(new Error(`At most ${MAX_FILES} files per message`), { status: 400 });
  return arr.map(a => {
    const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(a?.data || ''));
    if (!m || !ALLOWED_TYPES.includes(m[1])) throw Object.assign(new Error('Only JPG, PNG, WEBP or PDF files are allowed'), { status: 400 });
    const size = Math.floor(m[2].length * 3 / 4);
    if (size > MAX_ATTACHMENT) throw Object.assign(new Error('File is larger than 5 MB'), { status: 400 });
    return { name: String(a.name || 'file').replace(/[^\w .()-]/g, '_').slice(0, 120), type: m[1], size, data: a.data };
  });
}
const pubMsg = (m) => ({ id: String(m._id), authorEmail: m.authorEmail, authorRole: m.authorRole, fromSupport: !!m.fromSupport, body: m.body, at: m.at,
  attachments: (m.attachments || []).map(a => ({ id: String(a._id), name: a.name, type: a.type, size: a.size })) });
export const pubTicket = (t, { full = false } = {}) => ({ id: String(t._id), tenantId: t.tenantId, number: t.number, subject: t.subject, category: t.category, priority: t.priority, status: t.status,
  createdByEmail: t.createdByEmail, assignedTo: t.assignedTo || null, createdAt: t.createdAt, updatedAt: t.updatedAt, lastMessageAt: t.lastMessageAt,
  firstResponseAt: t.firstResponseAt || null, resolvedAt: t.resolvedAt || null, closedAt: t.closedAt || null, messageCount: (t.messages || []).length,
  ...(full ? { messages: (t.messages || []).map(pubMsg) } : {}) });

const statusStamps = (status) => ({ ...(status === 'resolved' ? { resolvedAt: new Date() } : {}), ...(status === 'closed' ? { closedAt: new Date() } : {}),
  ...(['open', 'in_progress', 'waiting_on_customer'].includes(status) ? { resolvedAt: null, closedAt: null } : {}) });

async function nextNumber(tenantId) {
  const last = await SupportTicket.findOne({ tenantId }).sort({ number: -1 }).select('number').lean();
  return (last?.number || 0) + 1;
}
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

  r.get('/support/meta', (req, res) => res.json({ categories: TICKET_CATEGORIES, statuses: TICKET_STATUSES, priorities: TICKET_PRIORITIES, maxFiles: MAX_FILES, maxBytes: MAX_ATTACHMENT, types: ALLOWED_TYPES }));

  r.get('/support/tickets', wrap(async (req, res) => {
    const q = ticketQuery(req);
    if (req.query.status && TICKET_STATUSES.includes(req.query.status)) q.status = req.query.status;
    const list = await SupportTicket.find(q).select('-messages.attachments.data').sort({ lastMessageAt: -1 }).limit(200).lean();
    res.json(list.map(t => pubTicket(t)));
  }));

  r.post('/support/tickets', wrap(async (req, res) => {
    if (req.readOnly) return res.status(403).json({ error: 'Read-only access' });
    const { subject, category = 'general', priority = 'normal', message, attachments } = req.body || {};
    if (!subject || String(subject).trim().length < 3) return res.status(400).json({ error: 'Subject is required' });
    if (!message || !String(message).trim()) return res.status(400).json({ error: 'Describe the problem' });
    if (!TICKET_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });
    if (!TICKET_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Unknown priority' });
    const files = parseAttachments(attachments);
    let t;
    for (let i = 0; i < 5 && !t; i++) {
      try {
        t = await SupportTicket.create({ tenantId: req.tenantId, number: await nextNumber(req.tenantId), subject: String(subject).trim().slice(0, 160), category, priority,
          createdById: String(req.user.id), createdByEmail: req.user.email, createdByRole: req.user.role,
          messages: [{ authorId: String(req.user.id), authorEmail: req.user.email, authorRole: req.user.role, fromSupport: false, body: String(message).slice(0, 5000), attachments: files }] });
      } catch (e) { if (e?.code !== 11000) throw e; }
    }
    await audit(req, 'support.ticket_create', { target: `#${t.number}`, detail: { category, priority, files: files.length } });
    res.status(201).json(pubTicket(t.toObject(), { full: true }));
  }));

  r.get('/support/tickets/:id', wrap(async (req, res) => {
    const t = await findTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    res.json(pubTicket(t.toObject(), { full: true }));
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
    if (t.status === 'closed') return res.status(409).json({ error: 'This ticket is closed. Open a new one.' });
    const body = String(req.body?.message || '').trim();
    const files = parseAttachments(req.body?.attachments);
    if (!body && !files.length) return res.status(400).json({ error: 'Message is empty' });
    const u = await SupportTicket.findOneAndUpdate({ tenantId: req.tenantId, _id: t._id }, {
      $push: { messages: { authorId: String(req.user.id), authorEmail: req.user.email, authorRole: req.user.role, fromSupport: false, body: body.slice(0, 5000), attachments: files } },
      $set: { lastMessageAt: new Date(), ...(t.status === 'waiting_on_customer' || t.status === 'resolved' ? { status: 'open', resolvedAt: null } : {}) } }, { new: true });
    await audit(req, 'support.ticket_reply', { target: `#${t.number}`, detail: { files: files.length } });
    res.json(pubTicket(u.toObject(), { full: true }));
  }));

  /** Customer side may close (or reopen a resolved) ticket. */
  r.patch('/support/tickets/:id', wrap(async (req, res) => {
    if (req.readOnly) return res.status(403).json({ error: 'Read-only access' });
    const t = await findTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const status = req.body?.status;
    if (!['closed', 'open'].includes(status)) return res.status(400).json({ error: 'You can only close or reopen a ticket' });
    const u = await SupportTicket.findOneAndUpdate({ tenantId: req.tenantId, _id: t._id }, { $set: { status, ...statusStamps(status) } }, { new: true });
    await audit(req, 'support.ticket_status', { target: `#${t.number}`, detail: { from: t.status, to: status } });
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
    if (req.query.libraryId) q.tenantId = String(req.query.libraryId);
    const list = await SupportTicket.find(q).setOptions({ skipTenantGuard: true }).select('-messages').sort({ lastMessageAt: -1 }).limit(300).lean();
    const libs = await Library.find({ libraryId: { $in: [...new Set(list.map(t => t.tenantId))] } }).select('name libraryId').lean();
    const names = Object.fromEntries(libs.map(l => [l.libraryId, l.name]));
    res.json(list.map(t => ({ ...pubTicket(t), libraryName: names[t.tenantId] || t.tenantId })));
  }));

  r.get('/support/tickets/:id', wrap(async (req, res) => {
    const t = await findAny(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    await audit(req, 'support.ticket_view', { tenantId: t.tenantId, target: `#${t.number}` });
    res.json(pubTicket(t.toObject(), { full: true }));
  }));

  r.get('/support/tickets/:id/messages/:mid/attachments/:aid', wrap(async (req, res) => {
    const t = await findAny(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    sendAttachment(res, t, req.params.mid, req.params.aid);
  }));

  r.post('/support/tickets/:id/messages', wrap(async (req, res) => {
    const t = await findAny(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const body = String(req.body?.message || '').trim();
    const files = parseAttachments(req.body?.attachments);
    if (!body && !files.length) return res.status(400).json({ error: 'Message is empty' });
    const status = TICKET_STATUSES.includes(req.body?.status) ? req.body.status : 'waiting_on_customer';
    const u = await SupportTicket.findOneAndUpdate({ tenantId: t.tenantId, _id: t._id }, {
      $push: { messages: { authorId: String(req.user.id), authorEmail: req.user.email, authorRole: req.user.role, fromSupport: true, body: body.slice(0, 5000), attachments: files } },
      $set: { lastMessageAt: new Date(), status, ...statusStamps(status), ...(t.firstResponseAt ? {} : { firstResponseAt: new Date() }), ...(t.assignedTo ? {} : { assignedTo: req.user.email }) } }, { new: true });
    await audit(req, 'support.ticket_reply', { tenantId: t.tenantId, target: `#${t.number}`, detail: { status, files: files.length } });
    await notify(t.tenantId, { dedupeKey: `support:${t._id}`, category: 'support', severity: 'info', force: true,
      title: `Support replied to ticket #${t.number}`, body: t.subject, link: { tab: 'support', params: { ticket: String(t._id) } } }).catch(() => {});
    res.json(pubTicket(u.toObject(), { full: true }));
  }));

  r.patch('/support/tickets/:id', wrap(async (req, res) => {
    const t = await findAny(req.params.id);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const set = {};
    if (req.body?.status !== undefined) { if (!TICKET_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Unknown status' }); Object.assign(set, { status: req.body.status }, statusStamps(req.body.status)); }
    if (req.body?.priority !== undefined) { if (!TICKET_PRIORITIES.includes(req.body.priority)) return res.status(400).json({ error: 'Unknown priority' }); set.priority = req.body.priority; }
    if (req.body?.category !== undefined) { if (!TICKET_CATEGORIES.includes(req.body.category)) return res.status(400).json({ error: 'Unknown category' }); set.category = req.body.category; }
    if (req.body?.assignedTo !== undefined) set.assignedTo = req.body.assignedTo ? String(req.body.assignedTo).slice(0, 160) : null;
    const u = await SupportTicket.findOneAndUpdate({ tenantId: t.tenantId, _id: t._id }, { $set: set }, { new: true });
    await audit(req, 'support.ticket_update', { tenantId: t.tenantId, target: `#${t.number}`, detail: { ...set } });
    res.json(pubTicket(u.toObject(), { full: true }));
  }));
  return r;
}

registerSaasKpi('support', async () => {
  const open = await SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress', 'waiting_on_customer'] } }).setOptions({ skipTenantGuard: true });
  const unassigned = await SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress'] }, assignedTo: { $in: [null, ''] } }).setOptions({ skipTenantGuard: true });
  return { label: 'Open support tickets', value: open, sub: `${unassigned} unassigned`, openTickets: open, unassignedTickets: unassigned };
});

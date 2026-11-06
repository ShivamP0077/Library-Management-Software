/**
 * In-app notifications and Action Required (spec §7, NOT-01).
 * - One document per (tenantId, dedupeKey): repeats bump notifyCount instead of duplicating.
 * - Important alerts escalate to Action Required after 2 notifications; critical go there at once.
 * - System alerts auto-resolve when the underlying issue is fixed (e.g. a bill paid, a student renewed).
 * - Every read is filtered by tenantId AND by the viewer's module permission (server-side).
 */
import mongoose from 'mongoose';
import express from 'express';
import tenantGuard, { applyBulkWriteGuard } from './tenantGuard.js';
import { models, Library } from './models.js';
import { audit } from './audit.js';
import { todayIn, dueReminders, ExpenseInstance, instanceStatus } from './finance.js';
import { studentStatus } from './students.js';

export const CATEGORIES = ['summary', 'students', 'seats', 'payments', 'expenses', 'notices', 'whatsapp', 'support', 'security', 'system'];
// Which staff module permission is needed to see a category (owner/superadmin see everything).
const CATEGORY_MODULE = { summary: 'reports', students: 'students', seats: 'seats', payments: 'payments', expenses: 'expenses', notices: null, whatsapp: 'settings', support: null, security: '__owner__', system: '__owner__' };

const attachmentSchema = new mongoose.Schema({ name: String, type: { type: String }, size: Number, data: String }, { _id: true });
const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  dedupeKey: { type: String, required: true },
  category: { type: String, enum: CATEGORIES, required: true },
  severity: { type: String, enum: ['info', 'important', 'critical'], default: 'info' },
  title: { type: String, required: true },
  body: String,
  link: { tab: String, params: mongoose.Schema.Types.Mixed }, // deep link: tab + record id
  source: { type: String, enum: ['system', 'manual'], default: 'system' },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  actionRequired: { type: Boolean, default: false },
  notifyCount: { type: Number, default: 1 },
  lastNotifiedAt: { type: Date, default: Date.now },
  readBy: { type: [String], default: [] },
  resolvedAt: Date, resolvedBy: String, resolution: String,
  // `attachment` is the legacy single-file field; `attachments` is the Issue #22 multi-file shape.
  attachment: { name: String, type: { type: String }, size: Number, data: String },
  attachments: { type: [attachmentSchema], default: [] },
  clientRequestId: String,
  createdBy: String,
}, { timestamps: true });
schema.index({ tenantId: 1, dedupeKey: 1 }, { unique: true });
schema.index({ tenantId: 1, status: 1, lastNotifiedAt: -1 });
schema.plugin(tenantGuard);
export const Notification = applyBulkWriteGuard(mongoose.models.Notification || mongoose.model('Notification', schema));

const ESCALATE_AFTER = 2;

/** Create or re-notify (deduped). Re-opens a resolved alert if the issue comes back. */
export async function notify(tenantId, n) {
  const now = new Date();
  const existing = await Notification.findOne({ tenantId, dedupeKey: n.dedupeKey }).lean();
  if (!existing) {
    try {
      return await Notification.create({ ...n, tenantId, actionRequired: n.severity === 'critical', lastNotifiedAt: now });
    } catch (e) { if (e?.code !== 11000) throw e; return notify(tenantId, n); }
  }
  // The scheduler may run hourly: count at most one notification per day so escalation is day-based.
  const sameDay = existing.status === 'open' && todayIn(undefined, new Date(existing.lastNotifiedAt)) === todayIn(undefined, now) && !n.force;
  const count = existing.status === 'resolved' ? 1 : existing.notifyCount + (sameDay ? 0 : 1);
  const severity = n.severity || existing.severity;
  return Notification.findOneAndUpdate({ tenantId, _id: existing._id }, {
    $set: { title: n.title, body: n.body, link: n.link, severity, status: 'open', notifyCount: count, lastNotifiedAt: sameDay ? existing.lastNotifiedAt : now, readBy: sameDay ? existing.readBy : [],
      actionRequired: severity === 'critical' || (severity === 'important' && count >= ESCALATE_AFTER), resolvedAt: null, resolvedBy: null },
  }, { new: true, lean: true });
}

/** Resolve open system alerts with this key prefix that are no longer active. */
export async function autoResolve(tenantId, prefix, activeKeys) {
  const open = await Notification.find({ tenantId, source: 'system', status: 'open', dedupeKey: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } }).lean();
  const stale = open.filter(o => !activeKeys.has(o.dedupeKey)).map(o => o._id);
  if (stale.length) await Notification.updateMany({ tenantId, _id: { $in: stale } }, { $set: { status: 'resolved', resolvedAt: new Date(), resolvedBy: 'system', resolution: 'Auto-resolved: issue fixed', actionRequired: false } });
  return stale.length;
}

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/** Recompute system alerts for a tenant. Idempotent: safe to run many times a day. */
export async function refreshTenantAlerts(tenantId, { today = todayIn(), dailySummary = false } = {}) {
  // Recurring bills: before / on / after due until paid (owner-configurable intervals live on the template).
  const reminders = await dueReminders(tenantId, today);
  const billKeys = new Set();
  for (const { instance: i, kind, daysFromDue } of reminders) {
    const key = `expense:${i._id}`; billKeys.add(key);
    await notify(tenantId, { dedupeKey: key, category: 'expenses', severity: kind === 'overdue' ? 'important' : 'info',
      title: kind === 'overdue' ? `${i.category} bill overdue by ${-daysFromDue} day(s)` : kind === 'due' ? `${i.category} bill due today` : `${i.category} bill due in ${daysFromDue} day(s)`,
      body: `${rupees(i.amount - (i.paidAmount || 0))} pending (due ${i.dueDate})`, link: { tab: 'expenses', params: { 'expense-instance': String(i._id) } } });
  }
  // keep unpaid-but-not-reminded-today bills open; resolve only paid ones
  const unpaid = (await ExpenseInstance.find({ tenantId }).lean()).filter(i => instanceStatus(i, today) !== 'paid').map(i => `expense:${i._id}`);
  unpaid.forEach(k => billKeys.add(k));
  await autoResolve(tenantId, 'expense:', billKeys);

  // Students: expiring soon / expired, and outstanding dues.
  const students = await models.students.find({ tenantId }).lean();
  const expKeys = new Set(), dueKeys = new Set();
  for (const s of students) {
    const st = studentStatus(s, today);
    if (st === 'Expiring Soon' || st === 'Expired') {
      const key = `student-expiry:${s._key}`; expKeys.add(key);
      const existing = await Notification.findOne({ tenantId, dedupeKey: key }).lean();
      // one alert per student per renewal period (keyed by the current expiry date)
      if (!existing || existing.status === 'resolved' || existing.body !== `Plan ends ${s.expiryDate}`) {
        await notify(tenantId, { dedupeKey: key, category: 'students', severity: st === 'Expired' ? 'important' : 'info',
          title: st === 'Expired' ? `${s.name || 'Student'}'s plan has expired` : `${s.name || 'Student'}'s plan expires soon`, body: `Plan ends ${s.expiryDate}`, link: { tab: 'students', params: { student: s._key } } });
      }
    }
    const due = Number(s.dueAmount ?? s.balanceDue ?? 0);
    if (due > 0) {
      const key = `student-due:${s._key}`; dueKeys.add(key);
      if (!(await Notification.exists({ tenantId, dedupeKey: key, status: 'open' }))) {
        await notify(tenantId, { dedupeKey: key, category: 'payments', severity: 'info', title: `${s.name || 'Student'} has ${rupees(due)} due`, body: 'Collect the pending fee', link: { tab: 'students', params: { student: s._key } } });
      }
    }
  }
  await autoResolve(tenantId, 'student-expiry:', expKeys);
  await autoResolve(tenantId, 'student-due:', dueKeys);

  if (dailySummary) {
    const pays = await models.payments.find({ tenantId, date: today }).lean();
    const collected = pays.reduce((a, p) => a + Math.max(0, Number(p.netTotal ?? 0)), 0);
    const pending = students.reduce((a, s) => a + Math.max(0, Number(s.dueAmount ?? s.balanceDue ?? 0)), 0);
    const renewals = students.filter(s => studentStatus(s, today) === 'Expiring Soon').length;
    await notify(tenantId, { dedupeKey: `summary:${today}`, category: 'summary', severity: 'info', title: `Daily summary for ${today}`,
      body: `Fees collected ${rupees(collected)} (${pays.length} payments) • Pending dues ${rupees(pending)} • ${renewals} renewal(s) coming up`, link: { tab: 'reports', params: {} } });
  }
}

export async function runDailyNotificationJob(Library_) {
  for (const l of await (Library_ || Library).find({ status: 'Active' }).lean()) {
    try { await refreshTenantAlerts(l.libraryId, { dailySummary: true }); } catch (e) { console.error('[notify] failed for', l.libraryId, e.message); }
  }
}

/* ---------------------------------------------------------------- permissions */
export async function viewerScope(req) {
  if (req.user.role !== 'staff') return { owner: true, can: () => true };
  const staff = req.user.staffId ? await models.staffMembers.findOne({ tenantId: req.tenantId, _key: String(req.user.staffId) }).lean() : null;
  const perms = staff?.permissions || {};
  const legacy = { reports: perms.canViewFinancials, payments: perms.canProcessPayments || perms.canViewFinancials, expenses: perms.canManageExpenses, seats: true, students: true, settings: perms.canManageSettings };
  const canModule = (m) => {
    if (staff?.status === 'Inactive') return false;
    const mod = perms[m];
    if (mod && typeof mod === 'object') return Boolean(mod.manage || mod.view);
    return Boolean(legacy[m]);
  };
  return { owner: false, can: (cat) => { const m = CATEGORY_MODULE[cat]; return m === null ? true : m === '__owner__' ? false : canModule(m); } };
}
const visibleCats = (scope) => CATEGORIES.filter(c => scope.can(c));

const pubAttachment = (a) => ({ id: a._id ? String(a._id) : 'legacy', name: a.name, type: a.type, size: a.size });
const pub = (n, uid) => {
  const files = Array.isArray(n.attachments) && n.attachments.length ? n.attachments : (n.attachment ? [n.attachment] : []);
  const attachments = files.map(pubAttachment);
  return { id: String(n._id), category: n.category, severity: n.severity, title: n.title, body: n.body, link: n.link, status: n.status, actionRequired: n.actionRequired, notifyCount: n.notifyCount, at: n.lastNotifiedAt, createdAt: n.createdAt, read: (n.readBy || []).includes(uid), source: n.source, createdBy: n.createdBy, resolvedAt: n.resolvedAt, resolvedBy: n.resolvedBy, resolution: n.resolution,
    attachments,
    // Keep the legacy field so older clients/tests continue to work.
    attachment: attachments[0],
  };
};

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_ATTACHMENT = 5 * 1024 * 1024;
export const MAX_NOTICE_ATTACHMENTS = 8;
export const MAX_NOTICE_TOTAL = 10 * 1024 * 1024;
export const MAX_SUPPORT_TOTAL = 8 * 1024 * 1024;

/** Validate the legacy single attachment and/or the new attachments array together. */
export function parseNoticeAttachments({ attachment, attachments } = {}) {
  const raw = [
    ...(Array.isArray(attachments) ? attachments : []),
    ...(attachment ? [attachment] : []),
  ];
  if (raw.length > MAX_NOTICE_ATTACHMENTS) throw Object.assign(new Error(`At most ${MAX_NOTICE_ATTACHMENTS} files per notice`), { status: 400 });
  let totalBytes = 0;
  return raw.map((a) => {
    const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(a?.data || ''));
    if (!m || !ALLOWED_TYPES.includes(m[1])) throw Object.assign(new Error('Only JPG, PNG, WEBP or PDF files are allowed'), { status: 400 });
    const size = Math.ceil(m[2].replace(/=+$/, '').length * 3 / 4);
    if (size > MAX_ATTACHMENT) throw Object.assign(new Error('File is larger than 5 MB'), { status: 413, code: 'ATTACHMENT_TOO_LARGE' });
    totalBytes += size;
    if (totalBytes > MAX_NOTICE_TOTAL) throw Object.assign(new Error('Notice attachments must be 10 MB or less in total'), { status: 413, code: 'NOTICE_TOTAL_TOO_LARGE' });
    return { name: String(a.name || 'notice').replace(/[^\w .()-]/g, '_').slice(0, 120), type: m[1], size, data: a.data };
  });
}
// In-process guard so a retry cannot start a second save while the first request is still writing.
const noticeInflight = new Set();

export function createNotificationRouter() {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const findVisible = async (req) => {
    const scope = await viewerScope(req);
    if (!mongoose.isValidObjectId(req.params.id)) return null;
    const n = await Notification.findOne({ tenantId: req.tenantId, _id: req.params.id }).lean();
    return n && scope.can(n.category) ? n : null;
  };

  r.get('/notifications', wrap(async (req, res) => {
    const scope = await viewerScope(req);
    const q = { tenantId: req.tenantId, category: { $in: visibleCats(scope) } };
    if (req.query.category && scope.can(String(req.query.category))) q.category = String(req.query.category);
    if (req.query.status) q.status = String(req.query.status);
    if (req.query.actionRequired === 'true') { q.actionRequired = true; q.status = 'open'; }
    const limit = Math.min(Number(req.query.limit || 50), 200);
    let list = (await Notification.find(q).sort({ lastNotifiedAt: -1 }).limit(limit).lean()).map(n => pub(n, req.user.id));
    if (req.query.unread === 'true') list = list.filter(n => !n.read);
    res.json(list);
  }));

  r.get('/notifications/unread-count', wrap(async (req, res) => {
    const scope = await viewerScope(req);
    const base = { tenantId: req.tenantId, category: { $in: visibleCats(scope) }, status: 'open' };
    const [unread, actionRequired] = await Promise.all([
      Notification.countDocuments({ ...base, readBy: { $ne: req.user.id } }),
      Notification.countDocuments({ ...base, actionRequired: true }),
    ]);
    res.json({ unread, actionRequired });
  }));

  r.post('/notifications/read-all', wrap(async (req, res) => {
    const scope = await viewerScope(req);
    const r2 = await Notification.updateMany({ tenantId: req.tenantId, category: { $in: visibleCats(scope) } }, { $addToSet: { readBy: req.user.id } });
    res.json({ ok: true, updated: r2.modifiedCount });
  }));

  r.post('/notifications/:id/read', wrap(async (req, res) => {
    const n = await findVisible(req); if (!n) return res.status(404).json({ error: 'Not found' });
    const op = req.body?.unread ? { $pull: { readBy: req.user.id } } : { $addToSet: { readBy: req.user.id } };
    res.json(pub(await Notification.findOneAndUpdate({ tenantId: req.tenantId, _id: n._id }, op, { new: true, lean: true }), req.user.id));
  }));

  r.post('/notifications/:id/resolve', wrap(async (req, res) => {
    const n = await findVisible(req); if (!n) return res.status(404).json({ error: 'Not found' });
    if (n.severity === 'critical' && ['security', 'system'].includes(n.category) && req.user.role === 'staff') return res.status(403).json({ error: 'Only the owner can resolve this alert' });
    const u = await Notification.findOneAndUpdate({ tenantId: req.tenantId, _id: n._id }, { $set: { status: 'resolved', resolvedAt: new Date(), resolvedBy: req.user.email, resolution: String(req.body?.resolution || 'Resolved'), actionRequired: false } }, { new: true, lean: true });
    await audit(req, 'notification.resolved', { target: String(n._id), detail: { title: n.title } });
    res.json(pub(u, req.user.id));
  }));

  r.get('/notifications/:id/attachment', wrap(async (req, res) => {
    const n = await findVisible(req); if (!n?._id) return res.status(404).json({ error: 'Not found' });
    const full = await Notification.findOne({ tenantId: req.tenantId, _id: n._id }).lean();
    const files = Array.isArray(full?.attachments) && full.attachments.length ? full.attachments : (full?.attachment ? [full.attachment] : []);
    const a = files[0];
    if (!a?.data) return res.status(404).json({ error: 'No attachment' });
    res.json({ name: a.name, type: a.type, data: a.data });
  }));

  r.get('/notifications/:id/attachments/:aid', wrap(async (req, res) => {
    const n = await findVisible(req); if (!n?._id) return res.status(404).json({ error: 'Not found' });
    const full = await Notification.findOne({ tenantId: req.tenantId, _id: n._id }).lean();
    const files = Array.isArray(full?.attachments) && full.attachments.length ? full.attachments : (full?.attachment ? [full.attachment] : []);
    const a = files.find(x => String(x._id) === req.params.aid) || (req.params.aid === 'legacy' ? full?.attachment : null) || (/^\d+$/.test(req.params.aid) ? files[Number(req.params.aid)] : null); // numeric index kept for older clients
    if (!a?.data) return res.status(404).json({ error: 'Attachment not found' });
    res.json({ name: a.name, type: a.type, data: a.data });
  }));

  /** Staff upload an official notice (e.g. fire-safety letter); owner gets it as Action Required. */
  r.post('/notices', wrap(async (req, res) => {
    const { title, summary, clientRequestId } = req.body || {};
    if (!title || String(title).trim().length < 3) return res.status(400).json({ error: 'Title is required' });
    const files = parseNoticeAttachments(req.body || {});
    const requestId = clientRequestId ? String(clientRequestId).slice(0, 120) : null;
    const inflightKey = requestId ? `${req.tenantId}:${requestId}` : null;
    const dedupeKey = requestId ? `notice:client:${requestId}` : `notice:${Date.now()}:${req.user.id}`;
    if (requestId) {
      const existing = await Notification.findOne({ tenantId: req.tenantId, dedupeKey }).lean();
      if (existing) return res.status(200).json({ ...pub(existing, req.user.id), deduplicated: true });
      if (noticeInflight.has(inflightKey)) return res.status(409).json({ error: 'Notice is still saving. Please retry in a moment.', code: 'NOTICE_IN_FLIGHT' });
      noticeInflight.add(inflightKey);
    }
    try {
      const n = await Notification.create({ tenantId: req.tenantId, dedupeKey, category: 'notices', severity: 'important', actionRequired: true, source: 'manual',
        title: String(title).trim().slice(0, 140), body: summary ? String(summary).slice(0, 2000) : '', attachment: files[0], attachments: files,
        clientRequestId: requestId || undefined, createdBy: req.user.email, readBy: [req.user.id], link: { tab: 'notifications', params: {} } });
      await audit(req, 'notice.uploaded', { target: String(n._id), detail: { title: n.title, attachments: files.length } });
      res.status(201).json(pub(n.toObject(), req.user.id));
    } catch (e) {
      if (e?.code === 11000 && requestId) {
        const existing = await Notification.findOne({ tenantId: req.tenantId, dedupeKey }).lean();
        if (existing) return res.status(200).json({ ...pub(existing, req.user.id), deduplicated: true });
      }
      throw e;
    } finally {
      if (inflightKey) noticeInflight.delete(inflightKey);
    }
  }));

  r.post('/notifications/refresh', wrap(async (req, res) => {
    await refreshTenantAlerts(req.tenantId);
    res.json({ ok: true });
  }));
  return r;
}

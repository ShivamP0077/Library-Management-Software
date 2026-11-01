/**
 * Spec §9 — partners, agents (sellers), commission rules, frozen commission records, assignment.
 * Payouts are NOT executed here: records carry a payoutStatus for tracking only.
 *
 * - Partner / agent: platform-level account (User role 'partner' | 'agent', no tenant).
 *   Partners manage only assigned libraries; agents see only their referrals/sales by default.
 * - CommissionRule: per seller, separately for 'initial' and 'renewal'; fixed ₹ or percent.
 *   Editing a rule creates a new version; old commission records keep their frozen basis.
 * - LibraryAssignment (tenantId): current managing partner + original seller (sale attribution)
 *   + full assignment history. Direct signups have no original seller.
 * - CommissionRecord (tenantId): one per (sale ref, kind, seller); never rewritten by rule edits;
 *   reversal/cancellation is a status change with reason.
 * Every library-linked collection carries tenantId and every query filters on it.
 */
import mongoose from 'mongoose';
import express from 'express';
import { Library, User } from './models.js';
import { createUser } from './services.js';
import { audit } from './audit.js';
import { requireRole } from './auth.js';
import { todayIn } from './finance.js';
import { registerSaasKpi, registerLibraryListFields } from './insights.js';

const ObjectId = mongoose.Schema.Types.ObjectId;
const PERMS = ['accessLibrary', 'viewClients', 'viewCommissions'];
const DEFAULT_PERMS = { partner: { accessLibrary: true, viewClients: true, viewCommissions: true }, agent: { accessLibrary: false, viewClients: true, viewCommissions: true } };

export const Partner = mongoose.models.Partner || mongoose.model('Partner', new mongoose.Schema({
  kind: { type: String, enum: ['partner', 'agent'], required: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  phone: String,
  status: { type: String, enum: ['Active', 'Disabled'], default: 'Active' },
  userId: ObjectId,
  permissions: { accessLibrary: Boolean, viewClients: Boolean, viewCommissions: Boolean },
  createdBy: String,
}, { timestamps: true }));

const ruleSchema = new mongoose.Schema({
  sellerId: { type: ObjectId, required: true, index: true },
  appliesTo: { type: String, enum: ['initial', 'renewal'], required: true },
  mode: { type: String, enum: ['fixed', 'percent'], required: true },
  value: { type: Number, required: true, min: 0 },
  active: { type: Boolean, default: true },
  version: { type: Number, default: 1 },
  createdBy: String,
}, { timestamps: true });
ruleSchema.index({ sellerId: 1, appliesTo: 1, active: 1 });
export const CommissionRule = mongoose.models.CommissionRule || mongoose.model('CommissionRule', ruleSchema);

const assignSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, unique: true },
  partnerId: { type: ObjectId, default: null },        // current managing partner
  originalSellerId: { type: ObjectId, default: null }, // who made the initial sale (null = direct signup)
  source: { type: String, enum: ['direct', 'seller'], default: 'direct' },
  history: [{ _id: false, from: ObjectId, to: ObjectId, at: Date, by: String, reason: String }],
}, { timestamps: true });
export const LibraryAssignment = mongoose.models.LibraryAssignment || mongoose.model('LibraryAssignment', assignSchema);

const recSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  sellerId: { type: ObjectId, required: true, index: true },
  kind: { type: String, enum: ['initial', 'renewal'], required: true },
  saleRef: { type: String, required: true },     // invoice/subscription payment id
  saleDate: String,
  saleAmount: { type: Number, required: true },
  basis: { ruleId: ObjectId, version: Number, mode: String, value: Number }, // frozen at transaction time
  amount: { type: Number, required: true },
  status: { type: String, enum: ['earned', 'reversed', 'cancelled'], default: 'earned' },
  statusReason: String,
  payoutStatus: { type: String, enum: ['unpaid', 'paid', 'void'], default: 'unpaid' }, // tracking only, no payouts executed
  history: [{ _id: false, at: Date, by: String, action: String, reason: String }],
}, { timestamps: true });
recSchema.index({ tenantId: 1, saleRef: 1, kind: 1, sellerId: 1 }, { unique: true });
export const CommissionRecord = mongoose.models.CommissionRecord || mongoose.model('CommissionRecord', recSchema);

const err = (status, message, code) => Object.assign(new Error(message), { status, code });
const round2 = (n) => Math.round(n * 100) / 100;
const pubPartner = (p) => ({ id: String(p._id), kind: p.kind, name: p.name, email: p.email, phone: p.phone || null, status: p.status, permissions: { ...DEFAULT_PERMS[p.kind], ...(p.permissions || {}) }, createdAt: p.createdAt });
const pubRec = (r) => ({ id: String(r._id), tenantId: r.tenantId, sellerId: String(r.sellerId), kind: r.kind, saleRef: r.saleRef, saleDate: r.saleDate, saleAmount: r.saleAmount, basis: r.basis, amount: r.amount, status: r.status, statusReason: r.statusReason, payoutStatus: r.payoutStatus, createdAt: r.createdAt });

export async function partnerForUser(user) {
  const p = await Partner.findOne({ userId: user.id }).lean();
  return p && p.status === 'Active' ? p : null;
}
const permsOf = (p) => ({ ...DEFAULT_PERMS[p.kind], ...(p.permissions || {}) });
/** Libraries a partner/agent may see: partners → assigned; agents → their own sales (referrals). */
export async function visibleTenantIds(p) {
  const q = p.kind === 'partner' ? { $or: [{ partnerId: p._id }, { originalSellerId: p._id }] } : { originalSellerId: p._id };
  return (await LibraryAssignment.find(q).select('tenantId').lean()).map(a => a.tenantId);
}
export async function partnerCanAccess(user, tenantId) {
  const p = await partnerForUser(user);
  if (!p || !permsOf(p).accessLibrary) return false;
  return !!(await LibraryAssignment.exists({ tenantId: String(tenantId), partnerId: p._id }));
}

/**
 * Record commission(s) for a SaaS sale. Called by billing (§5) once it exists; until then by the
 * Super Admin "record sale" endpoint. Idempotent per (tenant, saleRef, kind, seller).
 * initial → only the original seller; never for direct signups.
 * renewal → current managing partner (or original seller if no partner), only if a renewal rule exists.
 */
export async function recordSaleCommission({ tenantId, kind, saleRef, saleAmount, saleDate = todayIn(), actor = 'system' }) {
  if (!['initial', 'renewal'].includes(kind)) throw err(400, 'kind must be initial or renewal');
  if (!saleRef) throw err(400, 'saleRef is required');
  const amount = Number(saleAmount);
  if (!(amount > 0)) throw err(400, 'saleAmount must be greater than 0');
  const a = await LibraryAssignment.findOne({ tenantId }).lean();
  const sellerId = kind === 'initial' ? a?.originalSellerId : (a?.partnerId || a?.originalSellerId);
  if (!sellerId) return { created: false, reason: kind === 'initial' ? 'direct_signup' : 'no_seller' };
  const seller = await Partner.findById(sellerId).lean();
  if (!seller) return { created: false, reason: 'no_seller' };
  const rule = await CommissionRule.findOne({ sellerId, appliesTo: kind, active: true }).lean();
  if (!rule) return { created: false, reason: 'no_rule' };
  const commission = round2(rule.mode === 'percent' ? (amount * rule.value) / 100 : rule.value);
  try {
    const r = await CommissionRecord.create({ tenantId, sellerId, kind, saleRef: String(saleRef), saleDate, saleAmount: amount,
      basis: { ruleId: rule._id, version: rule.version, mode: rule.mode, value: rule.value }, amount: commission,
      history: [{ at: new Date(), by: actor, action: 'earned' }] });
    return { created: true, record: pubRec(r.toObject()) };
  } catch (e) {
    if (e?.code === 11000) return { created: false, reason: 'duplicate', record: pubRec(await CommissionRecord.findOne({ tenantId, saleRef: String(saleRef), kind, sellerId }).lean()) };
    throw e;
  }
}

registerLibraryListFields(async (ids) => {
  const asg = await LibraryAssignment.find({ tenantId: { $in: ids } }).lean();
  const ps = await Partner.find({ _id: { $in: asg.flatMap(a => [a.partnerId, a.originalSellerId]).filter(Boolean) } }).lean();
  const name = (id) => { const p = ps.find(x => String(x._id) === String(id)); return p ? { id: String(p._id), name: p.name, kind: p.kind } : null; };
  return Object.fromEntries(asg.map(a => [a.tenantId, { partner: name(a.partnerId), soldBy: name(a.originalSellerId), source: a.source }]));
});

registerSaasKpi('commissions', async ({ libraryIds }) => {
  const rows = await CommissionRecord.aggregate([{ $match: { tenantId: { $in: libraryIds }, status: 'earned' } }, { $group: { _id: '$payoutStatus', total: { $sum: '$amount' }, n: { $sum: 1 } } }]);
  const unpaid = rows.find(r => r._id === 'unpaid');
  const partners = await Partner.countDocuments({ status: 'Active' });
  return { label: 'Commissions earned (unpaid)', value: `₹${Math.round(unpaid?.total || 0).toLocaleString('en-IN')}`, sub: `${unpaid?.n || 0} records • ${partners} active partners/agents` };
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const oid = (v) => { if (!mongoose.isValidObjectId(v)) throw err(400, 'Invalid id'); return new mongoose.Types.ObjectId(String(v)); };

/** Super Admin routes, mounted under /admin. */
export function createPartnerAdminRouter() {
  const r = express.Router();
  r.get('/partners', wrap(async (_req, res) => {
    const list = await Partner.find().sort({ createdAt: 1 }).lean();
    const rules = await CommissionRule.find({ active: true }).lean();
    const counts = await LibraryAssignment.aggregate([{ $match: { partnerId: { $ne: null } } }, { $group: { _id: '$partnerId', n: { $sum: 1 } } }]);
    res.json(list.map(p => ({ ...pubPartner(p), libraries: counts.find(c => String(c._id) === String(p._id))?.n || 0,
      rules: Object.fromEntries(rules.filter(x => String(x.sellerId) === String(p._id)).map(x => [x.appliesTo, { mode: x.mode, value: x.value, version: x.version }])) })));
  }));
  r.post('/partners', wrap(async (req, res) => {
    const { kind, name, email, phone, password } = req.body || {};
    if (!['partner', 'agent'].includes(kind)) throw err(400, 'kind must be partner or agent');
    if (!name || !email) throw err(400, 'Name and email are required');
    const { user, generatedPassword } = await createUser({ email: String(email).toLowerCase().trim(), name, role: kind, password, generatePassword: !password });
    const p = await Partner.create({ kind, name, email: user.email, phone, userId: user._id, permissions: DEFAULT_PERMS[kind], createdBy: req.user.email });
    await audit(req, 'partner.create', { tenantId: null, target: user.email, detail: { kind } });
    res.status(201).json({ partner: pubPartner(p.toObject()), generatedPassword: generatedPassword || undefined });
  }));
  r.patch('/partners/:id', wrap(async (req, res) => {
    const p = await Partner.findById(oid(req.params.id));
    if (!p) throw err(404, 'Partner not found');
    const b = req.body || {};
    if (b.name) p.name = String(b.name).trim();
    if (b.phone !== undefined) p.phone = b.phone;
    if (b.status) { if (!['Active', 'Disabled'].includes(b.status)) throw err(400, 'Invalid status'); p.status = b.status; await User.updateOne({ _id: p.userId }, { $set: { status: b.status } }); }
    if (b.permissions) for (const k of PERMS) if (typeof b.permissions[k] === 'boolean') p.permissions = { ...permsOf(p), [k]: b.permissions[k] };
    await p.save();
    await audit(req, 'partner.update', { tenantId: null, target: p.email, detail: { status: b.status, permissions: b.permissions } });
    res.json(pubPartner(p.toObject()));
  }));
  /** Set a seller's rule: creates a new version, deactivates the old one. Never touches records. */
  r.put('/partners/:id/rules/:appliesTo', wrap(async (req, res) => {
    const sellerId = oid(req.params.id);
    const { appliesTo } = req.params;
    if (!['initial', 'renewal'].includes(appliesTo)) throw err(400, 'appliesTo must be initial or renewal');
    if (!(await Partner.exists({ _id: sellerId }))) throw err(404, 'Partner not found');
    const { mode, value, disabled } = req.body || {};
    const prev = await CommissionRule.findOneAndUpdate({ sellerId, appliesTo, active: true }, { $set: { active: false } }, { new: false }).lean();
    if (disabled) { await audit(req, 'commission_rule.disable', { tenantId: null, target: String(sellerId), detail: { appliesTo } }); return res.json({ ok: true, rule: null }); }
    if (!['fixed', 'percent'].includes(mode)) throw err(400, 'mode must be fixed or percent');
    const v = Number(value);
    if (!(v >= 0) || (mode === 'percent' && v > 100)) throw err(400, 'Invalid commission value');
    const rule = await CommissionRule.create({ sellerId, appliesTo, mode, value: v, version: (prev?.version || 0) + 1, createdBy: req.user.email });
    await audit(req, 'commission_rule.set', { tenantId: null, target: String(sellerId), detail: { appliesTo, mode, value: v, version: rule.version } });
    res.json({ ok: true, rule: { mode, value: v, version: rule.version } });
  }));
  r.get('/assignments', wrap(async (_req, res) => {
    const libs = await Library.find().select('libraryId').lean();
    const list = await LibraryAssignment.find({ tenantId: { $in: libs.map(l => l.libraryId) } }).lean();
    res.json(list.map(a => ({ tenantId: a.tenantId, partnerId: a.partnerId ? String(a.partnerId) : null, originalSellerId: a.originalSellerId ? String(a.originalSellerId) : null, source: a.source, history: a.history })));
  }));
  /** Assign / transfer a library's managing partner. Sale attribution is separate and set once. */
  r.post('/libraries/:libraryId/assign', wrap(async (req, res) => {
    const tenantId = req.params.libraryId;
    if (!(await Library.exists({ libraryId: tenantId }))) throw err(404, 'Library not found');
    const { partnerId, originalSellerId, reason } = req.body || {};
    const to = partnerId ? oid(partnerId) : null;
    if (to) { const p = await Partner.findById(to).lean(); if (!p || p.status !== 'Active' || p.kind !== 'partner') throw err(400, 'Pick an active partner'); }
    const cur = (await LibraryAssignment.findOne({ tenantId }).lean()) || {};
    const set = { partnerId: to };
    if (originalSellerId !== undefined) {
      if (cur.originalSellerId && String(cur.originalSellerId) !== String(originalSellerId)) throw err(409, 'Original sale attribution is already set and cannot be changed', 'attribution_locked');
      if (originalSellerId && await CommissionRecord.exists({ tenantId, kind: 'initial' })) throw err(409, 'Initial sale already recorded', 'attribution_locked');
      if (originalSellerId) { const s = await Partner.findById(oid(originalSellerId)).lean(); if (!s) throw err(400, 'Seller not found'); set.originalSellerId = s._id; set.source = 'seller'; }
    }
    const a = await LibraryAssignment.findOneAndUpdate({ tenantId }, { $set: set, $push: { history: { from: cur.partnerId || null, to, at: new Date(), by: req.user.email, reason: reason ? String(reason).slice(0, 300) : undefined } } }, { upsert: true, new: true, lean: true });
    await audit(req, cur.partnerId ? 'library.transfer' : 'library.assign', { tenantId, target: tenantId, reason, detail: { from: cur.partnerId ? String(cur.partnerId) : null, to: to ? String(to) : null, originalSellerId: set.originalSellerId ? String(set.originalSellerId) : undefined } });
    res.json({ tenantId, partnerId: a.partnerId ? String(a.partnerId) : null, originalSellerId: a.originalSellerId ? String(a.originalSellerId) : null, source: a.source });
  }));
  r.post('/sales', wrap(async (req, res) => {
    const { libraryId, kind, saleRef, saleAmount, saleDate } = req.body || {};
    if (!(await Library.exists({ libraryId }))) throw err(404, 'Library not found');
    const out = await recordSaleCommission({ tenantId: libraryId, kind, saleRef, saleAmount, saleDate, actor: req.user.email });
    await audit(req, 'sale.record', { tenantId: libraryId, target: String(saleRef), detail: { kind, saleAmount, created: out.created, reason: out.reason } });
    res.status(out.created ? 201 : 200).json(out);
  }));
  r.get('/commissions', wrap(async (req, res) => {
    const libs = (await Library.find().select('libraryId').lean()).map(l => l.libraryId);
    const q = { tenantId: { $in: req.query.libraryId ? [String(req.query.libraryId)].filter(x => libs.includes(x)) : libs } };
    if (req.query.sellerId) q.sellerId = oid(req.query.sellerId);
    if (req.query.status) q.status = String(req.query.status);
    res.json((await CommissionRecord.find(q).sort({ createdAt: -1 }).limit(500).lean()).map(pubRec));
  }));
  r.post('/commissions/:id/reverse', wrap(async (req, res) => {
    const { status = 'reversed', reason } = req.body || {};
    if (!['reversed', 'cancelled'].includes(status)) throw err(400, 'status must be reversed or cancelled');
    if (!reason) throw err(400, 'A reason is required (refund, cancellation, …)');
    const rec = await CommissionRecord.findById(oid(req.params.id)).lean();
    if (!rec) throw err(404, 'Commission not found');
    const r2 = await CommissionRecord.findOneAndUpdate({ tenantId: rec.tenantId, _id: rec._id, status: 'earned' },
      { $set: { status, statusReason: String(reason).slice(0, 300), payoutStatus: rec.payoutStatus === 'paid' ? 'paid' : 'void' }, $push: { history: { at: new Date(), by: req.user.email, action: status, reason } } }, { new: true, lean: true });
    if (!r2) throw err(409, 'Commission is already reversed or cancelled');
    await audit(req, `commission.${status}`, { tenantId: rec.tenantId, target: String(rec._id), reason });
    res.json(pubRec(r2));
  }));
  return r;
}

/** Partner / agent self-service, mounted at /partner. */
export function createPartnerPortalRouter() {
  const r = express.Router();
  r.use(requireRole('partner', 'agent'));
  r.use(wrap(async (req, res, next) => { req.partner = await partnerForUser(req.user); return req.partner ? next() : res.status(403).json({ error: 'Partner account is disabled' }); }));
  r.get('/me', (req, res) => res.json(pubPartner(req.partner)));
  r.get('/libraries', wrap(async (req, res) => {
    if (!permsOf(req.partner).viewClients) return res.json([]);
    const ids = await visibleTenantIds(req.partner);
    const [libs, asg] = await Promise.all([Library.find({ libraryId: { $in: ids } }).lean(), LibraryAssignment.find({ tenantId: { $in: ids } }).lean()]);
    const owners = await User.find({ role: 'client_admin', tenantId: { $in: ids } }).select('tenantId email name').lean();
    res.json(libs.map(l => {
      const a = asg.find(x => x.tenantId === l.libraryId);
      const o = owners.find(x => x.tenantId === l.libraryId);
      return { libraryId: l.libraryId, name: l.name, city: l.city || null, status: l.status, owner: o ? { name: o.name, email: o.email } : null,
        managedByMe: String(a?.partnerId) === String(req.partner._id), soldByMe: String(a?.originalSellerId) === String(req.partner._id),
        canAccess: permsOf(req.partner).accessLibrary && String(a?.partnerId) === String(req.partner._id) };
    }));
  }));
  r.get('/commissions', wrap(async (req, res) => {
    if (!permsOf(req.partner).viewCommissions) return res.json([]);
    const ids = (await Library.find().select('libraryId').lean()).map(l => l.libraryId);
    res.json((await CommissionRecord.find({ tenantId: { $in: ids }, sellerId: req.partner._id }).sort({ createdAt: -1 }).limit(500).lean()).map(pubRec));
  }));
  return r;
}

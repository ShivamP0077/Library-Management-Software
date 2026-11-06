// Issue #14: software plans (what a library pays Library OS for) and their limits.
import express from 'express';
import mongoose from 'mongoose';
import { Library, User } from './models.js';
import { audit } from './audit.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const limitField = { type: Number, default: null }; // null = unlimited

export const SoftwarePlan = mongoose.models.SoftwarePlan || mongoose.model('SoftwarePlan', new mongoose.Schema({
  planId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  priceMonthly: { type: Number, default: 0 }, // INR
  priceYearly: { type: Number, default: null },
  studentLimit: limitField,
  staffLimit: limitField,
  branchLimit: limitField,
  features: { type: [String], default: [] },
  trialDays: { type: Number, default: 0 },
  active: { type: Boolean, default: true }, // archived plans stay on existing libraries
  public: { type: Boolean, default: true }, // offered at owner signup
  sortOrder: { type: Number, default: 0 },
  updatedBy: String,
}, { timestamps: true }));

export const pubPlan = (p) => p && ({
  planId: p.planId, name: p.name, description: p.description, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly,
  studentLimit: p.studentLimit, staffLimit: p.staffLimit, branchLimit: p.branchLimit, features: p.features || [],
  trialDays: p.trialDays || 0, active: p.active, public: p.public, sortOrder: p.sortOrder || 0,
});

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const optLimit = (v, name) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw bad(`Invalid ${name}`);
  return n || null;
};
const money = (v, name, allowNull) => {
  if (v === undefined) return undefined;
  if (allowNull && (v === null || v === '')) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad(`Invalid ${name}`);
  return Math.round(n * 100) / 100;
};

/** Validates admin input into a $set object (only provided fields). */
export function planInput(body = {}, { creating } = {}) {
  const set = {};
  if (creating || body.name !== undefined) { const n = String(body.name || '').trim(); if (!n) throw bad('Plan name is required'); set.name = n.slice(0, 80); }
  if (body.description !== undefined) set.description = String(body.description || '').slice(0, 500);
  for (const [k, allowNull] of [['priceMonthly', false], ['priceYearly', true]]) { const v = money(body[k], k, allowNull); if (v !== undefined) set[k] = v; }
  for (const k of ['studentLimit', 'staffLimit', 'branchLimit']) { const v = optLimit(body[k], k); if (v !== undefined) set[k] = v; }
  if (body.trialDays !== undefined) { const t = Number(body.trialDays) || 0; if (!(t >= 0 && t <= 365)) throw bad('Invalid trialDays'); set.trialDays = Math.round(t); }
  if (body.features !== undefined) {
    const list = Array.isArray(body.features) ? body.features : String(body.features).split('\n');
    set.features = list.map(f => String(f).trim()).filter(Boolean).slice(0, 30).map(f => f.slice(0, 120));
  }
  for (const k of ['active', 'public']) if (body[k] !== undefined) set[k] = !!body[k];
  if (body.sortOrder !== undefined) set.sortOrder = Number(body.sortOrder) || 0;
  return set;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plan';

/** Effective limits: a per-library override (existing studentLimit) wins over the plan. */
export async function libraryLimits(tenantId) {
  const lib = await Library.findOne({ libraryId: tenantId }).lean();
  const plan = lib?.planId ? await SoftwarePlan.findOne({ planId: lib.planId }).lean() : null;
  const pick = (own, fromPlan) => (own > 0 ? own : fromPlan > 0 ? fromPlan : null);
  return {
    plan: plan ? { planId: plan.planId, name: plan.name } : null,
    studentLimit: pick(lib?.studentLimit, plan?.studentLimit),
    staffLimit: pick(null, plan?.staffLimit),
    branchLimit: pick(null, plan?.branchLimit),
  };
}

export class LimitError extends Error {
  constructor(kind, limit) { super(`Your plan allows up to ${limit} ${kind}. Upgrade the plan to add more.`); this.status = 409; this.code = `${kind}_limit`; this.limit = limit; }
}

/** Staff logins + pending invites count against staffLimit. */
export async function checkStaffLimit(tenantId, { Invite, excludeEmail } = {}) {
  const { staffLimit } = await libraryLimits(tenantId);
  if (!staffLimit) return;
  const users = await User.countDocuments({ tenantId, role: 'staff' });
  const pending = Invite ? await Invite.countDocuments({ tenantId, role: 'staff', usedAt: null, revokedAt: null, expiresAt: { $gt: new Date() }, ...(excludeEmail ? { email: { $ne: excludeEmail } } : {}) }) : 0;
  if (users + pending + 1 > staffLimit) throw new LimitError('staff', staffLimit);
}

/** Only grows are blocked, like the student cap (existing data is never locked). */
export async function checkBranchLimit(tenantId, nextCount, prevCount) {
  const { branchLimit } = await libraryLimits(tenantId);
  if (branchLimit && nextCount > branchLimit && nextCount > prevCount) throw new LimitError('branches', branchLimit);
}

export function createPlanAdminRouter() {
  const r = express.Router();
  r.get('/plans', wrap(async (_req, res) => {
    const plans = await SoftwarePlan.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
    const used = await Library.aggregate([{ $match: { planId: { $ne: null } } }, { $group: { _id: '$planId', n: { $sum: 1 } } }]);
    const by = Object.fromEntries(used.map(u => [u._id, u.n]));
    res.json(plans.map(p => ({ ...pubPlan(p), libraries: by[p.planId] || 0 })));
  }));
  r.post('/plans', wrap(async (req, res) => {
    const set = planInput(req.body, { creating: true });
    let planId = req.body?.planId ? slug(req.body.planId) : slug(set.name);
    if (await SoftwarePlan.exists({ planId })) {
      if (req.body?.planId) return res.status(409).json({ error: 'planId already exists' });
      planId = `${planId}-${Date.now().toString(36)}`;
    }
    const p = await SoftwarePlan.create({ ...set, planId, updatedBy: req.user.email });
    await audit(req, 'plan.created', { target: planId, detail: set });
    res.status(201).json(pubPlan(p));
  }));
  r.patch('/plans/:planId', wrap(async (req, res) => {
    const set = planInput(req.body);
    const p = await SoftwarePlan.findOneAndUpdate({ planId: req.params.planId }, { $set: { ...set, updatedBy: req.user.email } }, { new: true, lean: true });
    if (!p) return res.status(404).json({ error: 'Plan not found' });
    await audit(req, 'plan.updated', { target: p.planId, detail: set });
    res.json(pubPlan(p));
  }));
  return r;
}

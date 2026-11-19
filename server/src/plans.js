// Issue #14: software plans (what a library pays Library OS for) and their limits.
import express from 'express';
import mongoose from 'mongoose';
import { Library, User } from './models.js';
import { audit } from './audit.js';
import { INTERVALS, assertDurationDiscounts, priceQuote } from './billing.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const limitField = { type: Number, default: null }; // null = unlimited

export const SoftwarePlan = mongoose.models.SoftwarePlan || mongoose.model('SoftwarePlan', new mongoose.Schema({
  planId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  priceMonthly: { type: Number, default: 0 }, // INR
  priceYearly: { type: Number, default: null },
  studentLimit: limitField, // Maximum Active Students (Active + Grace). Not renamed.
  staffLimit: limitField,
  branchLimit: limitField,
  deskLimit: limitField, // Maximum Physical Desks. null = unlimited.
  features: { type: [String], default: [] },
  trialDays: { type: Number, default: 0 },
  /** Per-duration discount. Missing means infer from priceMonthly / priceYearly on read. */
  durationPricing: { type: mongoose.Schema.Types.Mixed },
  recommended: { type: Boolean, default: false },
  active: { type: Boolean, default: true }, // archived plans stay on existing libraries
  public: { type: Boolean, default: true }, // offered at owner signup
  sortOrder: { type: Number, default: 0 },
  updatedBy: String,
}, { timestamps: true }));

const limitText = (n, one, many) => (n > 0 ? `${Number(n).toLocaleString('en-IN')} ${Number(n) === 1 ? one : many}` : `Unlimited ${many}`);

/** Feature order: desks (when the field is present), branches, staff, optional student cap, WhatsApp, then the rest. */
export function planHighlights(p) {
  if (!p) return [];
  const lines = [];
  if (Object.prototype.hasOwnProperty.call(p, 'deskLimit') && p.deskLimit !== undefined) {
    lines.push(limitText(p.deskLimit, 'desk', 'desks'));
  }
  lines.push(limitText(p.branchLimit, 'branch', 'branches'));
  lines.push(limitText(p.staffLimit, 'staff member', 'staff'));
  if (p.studentLimit > 0) lines.push(limitText(p.studentLimit, 'student', 'students'));
  const rest = [];
  let whatsapp = null;
  for (const feature of p.features || []) {
    const text = String(feature || '').trim();
    if (!text) continue;
    if (!whatsapp && /whatsapp/i.test(text)) whatsapp = text;
    else rest.push(text);
  }
  if (whatsapp) lines.push(whatsapp);
  lines.push(...rest);
  return lines;
}

export const pubPlan = (p) => {
  if (!p) return p;
  const intervals = INTERVALS.map(interval => priceQuote(p, interval)).filter(Boolean);
  const shaped = { ...p, deskLimit: p.deskLimit ?? null };
  return {
    planId: p.planId, name: p.name, description: p.description, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly,
    studentLimit: p.studentLimit, staffLimit: p.staffLimit, branchLimit: p.branchLimit,
    deskLimit: p.deskLimit ?? null,
    features: p.features || [],
    highlights: planHighlights(shaped),
    trialDays: p.trialDays || 0,
    recommended: !!p.recommended,
    durationPricing: p.durationPricing || null,
    intervals,
    active: p.active, public: p.public, sortOrder: p.sortOrder || 0,
  };
};

/** Public catalogue shape: prices and plan copy only. */
export function publicCataloguePlan(p) {
  const pub = pubPlan(p);
  if (!pub) return pub;
  return {
    planId: pub.planId,
    name: pub.name,
    description: pub.description || '',
    priceMonthly: pub.priceMonthly,
    priceYearly: pub.priceYearly,
    studentLimit: pub.studentLimit,
    staffLimit: pub.staffLimit,
    branchLimit: pub.branchLimit,
    deskLimit: pub.deskLimit ?? null,
    features: pub.features,
    highlights: pub.highlights,
    trialDays: pub.trialDays,
    recommended: pub.recommended,
    intervals: (pub.intervals || []).filter(row => row.available),
    active: true,
    public: true,
  };
}

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
  for (const k of ['studentLimit', 'staffLimit', 'branchLimit', 'deskLimit']) { const v = optLimit(body[k], k); if (v !== undefined) set[k] = v; }
  if (body.trialDays !== undefined) { const t = Number(body.trialDays) || 0; if (!(t >= 0 && t <= 365)) throw bad('Invalid trialDays'); set.trialDays = Math.round(t); }
  if (body.features !== undefined) {
    const list = Array.isArray(body.features) ? body.features : String(body.features).split('\n');
    set.features = list.map(f => String(f).trim()).filter(Boolean).slice(0, 30).map(f => f.slice(0, 120));
  }
  for (const k of ['active', 'public']) if (body[k] !== undefined) set[k] = !!body[k];
  if (body.recommended !== undefined) set.recommended = !!body.recommended;
  if (body.sortOrder !== undefined) set.sortOrder = Number(body.sortOrder) || 0;
  if (body.durationPricing !== undefined) set.durationPricing = normaliseDurationPricing(body.durationPricing);
  return set;
}

function normaliseDurationPricing(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object') throw bad('Invalid durationPricing');
  const out = {};
  for (const interval of INTERVALS) {
    const row = raw[interval];
    if (row == null) continue;
    if (typeof row !== 'object') throw bad(`Invalid durationPricing.${interval}`);
    const discountType = row.discountType || 'none';
    if (!['none', 'percent', 'fixed'].includes(discountType)) throw bad(`Invalid discount type for ${interval}`);
    const discountValue = row.discountValue == null || row.discountValue === '' ? 0 : Number(row.discountValue);
    if (!Number.isFinite(discountValue) || discountValue < 0) throw bad(`Discount for ${interval} cannot be negative`);
    if (discountType === 'percent' && discountValue > 100) throw bad(`Discount for ${interval} cannot exceed 100%`);
    out[interval] = {
      offered: interval === 'month' ? true : row.offered !== false,
      discountType,
      discountValue: discountType === 'none' ? 0 : Math.round(discountValue * 100) / 100,
    };
  }
  return out;
}

/** Legacy priceYearly follows the 12-month final when the editor sends duration pricing. */
function legacyYearlyFrom(set) {
  if (!set.durationPricing || set.priceMonthly === undefined) return undefined;
  const quote = priceQuote({ priceMonthly: set.priceMonthly, durationPricing: set.durationPricing }, 'year');
  if (!quote?.available || quote.finalMinor == null) return null;
  return quote.finalMinor / 100;
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
    deskLimit: pick(null, plan?.deskLimit),
  };
}

export class LimitError extends Error {
  constructor(kind, limit) {
    const noun = kind === 'desks' ? 'physical desks' : kind;
    const lead = kind === 'desks' ? 'Plan Limit Exceeded. ' : '';
    super(`${lead}Your plan allows up to ${limit} ${noun}. Upgrade the plan to add more.`);
    this.status = 409; this.code = `${kind}_limit`; this.limit = limit;
  }
}

/** Only growth past Maximum Physical Desks is blocked. Existing desks are never removed. */
export async function checkDeskLimit(tenantId, nextCount, prevCount) {
  const { deskLimit } = await libraryLimits(tenantId);
  if (deskLimit && nextCount > deskLimit && nextCount > prevCount) throw new LimitError('desks', deskLimit);
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
    const yearly = legacyYearlyFrom(set);
    if (yearly !== undefined) set.priceYearly = yearly;
    assertDurationDiscounts(set);
    let planId = req.body?.planId ? slug(req.body.planId) : slug(set.name);
    if (await SoftwarePlan.exists({ planId })) {
      if (req.body?.planId) return res.status(409).json({ error: 'planId already exists' });
      planId = `${planId}-${Date.now().toString(36)}`;
    }
    if (set.recommended && set.active !== false && set.public !== false) {
      await SoftwarePlan.updateMany({ active: true, public: true, recommended: true }, { $set: { recommended: false } });
    }
    const p = await SoftwarePlan.create({ ...set, planId, updatedBy: req.user.email });
    await audit(req, 'plan.created', { target: planId, detail: set });
    res.status(201).json(pubPlan(p));
  }));
  r.patch('/plans/:planId', wrap(async (req, res) => {
    const existing = await SoftwarePlan.findOne({ planId: req.params.planId }).lean();
    if (!existing) return res.status(404).json({ error: 'Plan not found' });
    const set = planInput(req.body);
    if (set.active === false) {
      const libraries = await Library.countDocuments({ planId: existing.planId });
      if (libraries > 0 && !req.body?.confirmArchive) {
        return res.status(409).json({
          error: `This plan is still used by ${libraries} ${libraries === 1 ? 'library' : 'libraries'}. Confirm before archiving.`,
          code: 'plan_in_use',
          libraries,
        });
      }
    }
    const merged = { ...existing, ...set };
    if (merged.durationPricing && (set.durationPricing !== undefined || set.priceMonthly !== undefined)) {
      const yearly = legacyYearlyFrom({ priceMonthly: merged.priceMonthly, durationPricing: merged.durationPricing });
      if (yearly !== undefined) set.priceYearly = yearly;
    }
    assertDurationDiscounts(merged);
    const willRecommend = merged.recommended && merged.active !== false && merged.public !== false;
    if (willRecommend) {
      await SoftwarePlan.updateMany({ planId: { $ne: existing.planId }, active: true, public: true, recommended: true }, { $set: { recommended: false } });
    }
    const p = await SoftwarePlan.findOneAndUpdate({ planId: existing.planId }, { $set: { ...set, updatedBy: req.user.email } }, { new: true, lean: true });
    await audit(req, 'plan.updated', { target: p.planId, detail: set });
    res.json(pubPlan(p));
  }));
  r.delete('/plans/:planId', wrap(async (req, res) => {
    const existing = await SoftwarePlan.findOne({ planId: req.params.planId }).lean();
    if (!existing) return res.status(404).json({ error: 'Plan not found' });
    const libraries = await Library.countDocuments({ planId: existing.planId });
    if (libraries > 0) {
      const noun = libraries === 1 ? 'library uses' : 'libraries use';
      return res.status(409).json({
        error: `${libraries} ${noun} this plan. Archive it instead of deleting.`,
        code: 'plan_in_use',
        libraries,
      });
    }
    await SoftwarePlan.deleteOne({ planId: existing.planId });
    await audit(req, 'plan.deleted', { target: existing.planId });
    res.json({ ok: true, planId: existing.planId });
  }));
  return r;
}

export function createPublicPlanRouter() {
  const r = express.Router();
  r.get('/public/software-plans', wrap(async (_req, res) => {
    const plans = await SoftwarePlan.find({ active: true, public: true }).sort({ sortOrder: 1, priceMonthly: 1 }).lean();
    res.json({ plans: plans.map(publicCataloguePlan) });
  }));
  return r;
}

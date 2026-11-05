// Issue #19: the owner's "My Subscription" — provider-independent.
// Nothing here charges money or deletes data. Paid steps answer "payments not set up yet"
// until a payment provider is registered with setPaymentProvider().
import express from 'express';
import { Library, User, models } from './models.js';
import { requireRole } from './auth.js';
import { audit } from './audit.js';
import { SoftwarePlan, pubPlan, libraryLimits } from './plans.js';
import { paymentProvider, planPrice, INTERVALS, initialSubscription } from './billing.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const NOT_SET_UP = { error: 'Online payments are not set up yet. Please contact support to change to a paid plan.', code: 'payments_not_configured' };

async function usageOf(tenantId) {
  const [students, staff, branches] = await Promise.all([
    models.students.countDocuments({ tenantId }),
    User.countDocuments({ tenantId, role: 'staff' }),
    models.branches ? models.branches.countDocuments({ tenantId }) : 0,
  ]);
  return { students, staff, branches };
}

/** Which limits the usage would break on `plan` (empty = fits). */
export function overLimits(plan, usage) {
  const out = [];
  for (const [k, lim] of [['students', plan.studentLimit], ['staff', plan.staffLimit], ['branches', plan.branchLimit]])
    if (lim > 0 && usage[k] > lim) out.push({ kind: k, limit: lim, used: usage[k] });
  return out;
}

async function view(tenantId) {
  const lib = await Library.findOne({ libraryId: tenantId }).lean();
  const plan = lib?.planId ? await SoftwarePlan.findOne({ planId: lib.planId }).lean() : null;
  const plans = await SoftwarePlan.find({ active: true, public: true }).sort({ sortOrder: 1, priceMonthly: 1 }).lean();
  return {
    plan: pubPlan(plan),
    subscription: lib?.subscription || null,
    limits: await libraryLimits(tenantId),
    usage: await usageOf(tenantId),
    plans: plans.map(pubPlan),
    invoices: [], // filled by the payment provider once one exists
    paymentsEnabled: Boolean(paymentProvider()),
    deletionRequest: lib?.deletionRequest || null,
  };
}

export function createSubscriptionRouter() {
  const r = express.Router();
  r.use('/subscription', requireRole('client_admin', 'superadmin'));

  r.get('/subscription', wrap(async (req, res) => res.json(await view(req.tenantId))));

  // Change plan. Moving to a paid price needs a payment provider; moving down keeps the
  // current plan until the period ends (pendingPlanId) so nothing already paid for is lost.
  r.post('/subscription/change', wrap(async (req, res) => {
    const { planId } = req.body || {};
    const interval = INTERVALS.includes(req.body?.interval) ? req.body.interval : 'month';
    const target = await SoftwarePlan.findOne({ planId, active: true }).lean();
    if (!target) return res.status(400).json({ error: 'Unknown plan' });
    const newPrice = planPrice(target, interval);
    if (newPrice == null) return res.status(400).json({ error: 'This plan has no yearly price' });
    const lib = await Library.findOne({ libraryId: req.tenantId }).lean();
    const sub = lib.subscription || {};
    if (lib.planId === planId && (sub.interval || 'month') === interval) return res.status(400).json({ error: 'You are already on this plan' });
    const over = overLimits(target, await usageOf(req.tenantId));
    if (over.length) return res.status(409).json({ error: `Your library uses more than this plan allows (${over.map(o => `${o.used} ${o.kind}, limit ${o.limit}`).join('; ')}).`, code: 'over_limit', over });
    const curPrice = Number(sub.price ?? 0);
    const now = new Date();
    let next;
    if (Number(newPrice) > 0 && Number(newPrice) > curPrice) {
      if (!paymentProvider()) return res.status(402).json(NOT_SET_UP);
      return res.status(501).json({ error: 'Checkout is not implemented for this provider yet' });
    }
    if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > now && sub.status === 'active' && Number(newPrice) < curPrice) {
      next = { ...sub, pendingPlanId: planId, pendingInterval: interval };
    } else {
      next = { ...initialSubscription({ ...target, trialDays: 0 }, interval, now), status: Number(newPrice) > 0 ? 'pending_payment' : 'active' };
    }
    const set = { subscription: next };
    if (!next.pendingPlanId) set.planId = planId;
    await Library.updateOne({ libraryId: req.tenantId }, { $set: set });
    await audit(req, 'subscription.changed', { tenantId: req.tenantId, detail: { from: lib.planId || null, to: planId, interval, scheduled: Boolean(next.pendingPlanId) } });
    res.json(await view(req.tenantId));
  }));

  r.post('/subscription/cancel', wrap(async (req, res) => {
    const lib = await Library.findOne({ libraryId: req.tenantId }).lean();
    if (!lib.subscription) return res.status(400).json({ error: 'No subscription to cancel' });
    const resume = req.body?.resume === true;
    await Library.updateOne({ libraryId: req.tenantId }, { $set: { 'subscription.cancelAtPeriodEnd': !resume, 'subscription.pendingPlanId': null } });
    if (paymentProvider() && !resume) await paymentProvider().cancel({ library: lib });
    await audit(req, resume ? 'subscription.resumed' : 'subscription.cancel_scheduled', { tenantId: req.tenantId });
    res.json(await view(req.tenantId));
  }));

  // A request only: a Super Admin reviews it and deletes through the existing confirmed flow (#16).
  r.post('/subscription/deletion-request', requireRole('client_admin'), wrap(async (req, res) => {
    const lib = await Library.findOne({ libraryId: req.tenantId }).lean();
    if (String(req.body?.confirmName || '').trim() !== lib.name) return res.status(400).json({ error: 'Type the library name exactly to confirm' });
    const deletionRequest = { at: new Date(), by: req.user.email, reason: String(req.body?.reason || '').slice(0, 1000) };
    await Library.updateOne({ libraryId: req.tenantId }, { $set: { deletionRequest } });
    await audit(req, 'library.deletion_requested', { tenantId: req.tenantId, detail: { reason: deletionRequest.reason } });
    res.json(await view(req.tenantId));
  }));
  r.delete('/subscription/deletion-request', requireRole('client_admin'), wrap(async (req, res) => {
    await Library.updateOne({ libraryId: req.tenantId }, { $set: { deletionRequest: null } });
    await audit(req, 'library.deletion_request_withdrawn', { tenantId: req.tenantId });
    res.json(await view(req.tenantId));
  }));
  return r;
}

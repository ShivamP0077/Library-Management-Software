// Issue #19: the owner's "My Subscription" — provider-independent.
// Nothing here charges money or deletes data. Paid steps answer "payments not set up yet"
// until a payment provider is registered with setPaymentProvider().
import express from 'express';
import { Library, User, models } from './models.js';
import { requireRole } from './auth.js';
import { audit } from './audit.js';
import { SoftwarePlan, pubPlan, libraryLimits } from './plans.js';
import { paymentProvider, planPrice, INTERVALS, initialSubscription } from './billing.js';
import { refreshPaymentProvider } from './paymentConfig.js';
import { SoftwareInvoice, listInvoices, newInvoiceId } from './payments/invoices.js';
import { getBillingConfig, publicBillingConfig, taxFor } from './billingConfig.js';
import { notifySuperAdminsOfDeletionRequest } from './paymentsAdmin.js';

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
    invoices: await listInvoices(tenantId),
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
      const configured = paymentProvider();
      if (!configured || typeof configured.createCheckout !== 'function') return res.status(402).json(NOT_SET_UP);
      const config = publicBillingConfig(await getBillingConfig());
      if (!config.configured) return res.status(409).json({ error: 'Super Admin must explicitly choose currency and GST treatment before paid activation.', code: 'billing_not_configured' });
      const baseMinor = Math.round(Number(newPrice) * 100);
      const tax = taxFor(baseMinor, config);
      const existingPending = await SoftwareInvoice.findOne({ tenantId: req.tenantId, status: 'open', kind: 'upgrade', planId, interval, baseMinor, provider: configured.name, currency: config.currency, gatewayMinor: tax.totalMinor }).sort({ createdAt: -1 });
      if (existingPending?.providerRef) return res.json({ ...await view(req.tenantId), checkout: { invoiceId: existingPending.invoiceId, reference: existingPending.providerRef, amountMinor: existingPending.gatewayMinor, pendingPlanId: planId } });
      const invoice = await SoftwareInvoice.create({
        invoiceId: newInvoiceId(), tenantId: req.tenantId, kind: 'upgrade', changeType: 'upgrade', planId, interval,
        amount: tax.totalMinor / 100, totalMinor: tax.totalMinor, baseMinor, discountMinor: 0, taxableMinor: tax.taxableMinor,
        taxMinor: tax.taxMinor, taxIncluded: tax.mode === 'included', taxRate: tax.ratePct || null, walletMinor: 0,
        gatewayMinor: tax.totalMinor, currency: config.currency, status: 'open', provider: configured.name, dueAt: now,
      });
      const result = await configured.createCheckout({ library: lib, plan: target, interval, amount: tax.totalMinor / 100, invoiceId: invoice.invoiceId, returnUrl: `${process.env.FRONTEND_URL || ''}/#software_plan` });
      await SoftwareInvoice.updateOne({ invoiceId: invoice.invoiceId, tenantId: req.tenantId }, { $set: { providerRef: result.reference, 'raw.checkout': result } });
      await audit(req, 'subscription.checkout_created', { tenantId: req.tenantId, target: invoice.invoiceId, detail: { planId, interval, amountMinor: tax.totalMinor, provider: configured.name } });
      return res.status(201).json({ ...await view(req.tenantId), checkout: { ...result, invoiceId: invoice.invoiceId, amountMinor: tax.totalMinor, pendingPlanId: planId } });
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

  // Issue #15/#19 payment hook — creates a provider checkout when configured.
  r.post('/subscription/checkout', wrap(async (req, res) => {
    const lib = await Library.findOne({ libraryId: req.tenantId });
    if (!lib) return res.status(404).json({ error: 'Library not found' });
    const sub = lib.subscription;
    if (!sub || sub.status !== 'pending_payment') {
      return res.status(400).json({ error: 'No payment is due right now.', code: 'no_payment_due' });
    }
    await refreshPaymentProvider();
    const provider = paymentProvider();
    if (!provider) return res.status(402).json(NOT_SET_UP);
    if (typeof provider.createCheckout !== 'function') {
      return res.status(501).json({ error: 'Checkout is not implemented for this provider yet', code: 'checkout_not_implemented' });
    }
    const plan = lib.planId ? await SoftwarePlan.findOne({ planId: lib.planId }).lean() : null;
    const amountMinor = Math.round((Number(sub.price) || planPrice(plan, sub.interval) || 0) * 100);
    if (!(amountMinor > 0)) return res.status(400).json({ error: 'No payment amount is due', code: 'amount_missing' });
    let invoice = await SoftwareInvoice.findOne({
      tenantId: req.tenantId, status: 'open', kind: 'subscription', provider: provider.name,
      planId: lib.planId || null,
    }).sort({ createdAt: -1 });
    if (!invoice) {
      const config = publicBillingConfig(await getBillingConfig());
      const tax = taxFor(amountMinor, config);
      invoice = await SoftwareInvoice.create({
        invoiceId: newInvoiceId(), tenantId: req.tenantId, kind: 'subscription', planId: lib.planId || null,
        interval: sub.interval || 'month', amount: tax.totalMinor / 100, totalMinor: tax.totalMinor,
        baseMinor: amountMinor, discountMinor: 0, taxableMinor: tax.taxableMinor, taxMinor: tax.taxMinor,
        taxIncluded: tax.mode === 'included', taxRate: tax.ratePct || null, walletMinor: 0,
        gatewayMinor: tax.totalMinor, currency: config.currency, status: 'open', provider: provider.name, dueAt: new Date(),
      });
    }
    await SoftwareInvoice.updateOne({ invoiceId: invoice.invoiceId, tenantId: req.tenantId, providerRef: { $in: [null, ''] } }, { $set: { amount: invoice.amount, gatewayMinor: invoice.gatewayMinor, provider: provider.name } });
    const result = await provider.createCheckout({
      library: lib, plan, interval: sub.interval, amount: Number(invoice.gatewayMinor) / 100,
      invoiceId: invoice.invoiceId, returnUrl: req.body?.returnUrl || undefined,
    });
    await SoftwareInvoice.updateOne({ invoiceId: invoice.invoiceId, tenantId: req.tenantId, providerRef: { $in: [null, ''] } }, { $set: { providerRef: result.reference, 'raw.checkout': result } });
    return res.json({ ok: true, ...result, invoiceId: invoice.invoiceId, amountMinor: invoice.gatewayMinor });
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
    await notifySuperAdminsOfDeletionRequest(lib, deletionRequest);
    res.json(await view(req.tenantId));
  }));
  r.delete('/subscription/deletion-request', requireRole('client_admin'), wrap(async (req, res) => {
    await Library.updateOne({ libraryId: req.tenantId }, { $set: { deletionRequest: null } });
    await audit(req, 'library.deletion_request_withdrawn', { tenantId: req.tenantId });
    res.json(await view(req.tenantId));
  }));
  return r;
}

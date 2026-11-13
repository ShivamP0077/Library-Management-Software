// Issue #19: My Software Plan — quotes, wallet/mixed checkout, top-ups, offers and referrals.
import crypto from 'crypto';
import express from 'express';
import { Library } from './models.js';
import { SoftwarePlan, pubPlan } from './plans.js';
import { addInterval, INTERVALS, paymentProvider, planPrice } from './billing.js';
import { getBillingConfig, publicBillingConfig, taxFor } from './billingConfig.js';
import { SoftwareInvoice, newInvoiceId } from './payments/invoices.js';
import { settleInvoice, failInvoice, deliverSoftwareReceipt, softwareReceiptText, invoiceFinancials } from './payments/settlement.js';
import { reserveOffer, offerCapacityLeft } from './payments/offers.js';
import { textToPdf } from './pdf.js';
import { WalletTopup, WalletHold, Offer, OfferRedemption, ReferralCampaign, Referral } from './commerce.js';
import { walletSnapshot, walletHistory, holdWallet, releaseWalletHold } from './wallet.js';
import { audit } from './audit.js';
import { requireRole } from './auth.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const rid = (p) => `${p}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
const minor = (major) => Math.round(Number(major || 0) * 100);

async function getLibrary(tenantId) {
  return Library.findOne({ libraryId: tenantId });
}

async function applyOffer({ code, baseMinor, planId, tenantId }) {
  if (Array.isArray(code)) {
    const codes = [...new Set(code.map(c => String(c || '').trim().toUpperCase()).filter(Boolean))];
    if (codes.length > 1) throw Object.assign(new Error('Offers cannot be combined: one offer code per checkout'), { status: 400, code: 'offer_not_stackable' });
    code = codes[0];
  }
  if (!code) return { offer: null, discountMinor: 0 };
  const offer = await Offer.findOne({ code: String(code).trim().toUpperCase() });
  const fail = (msg) => Object.assign(new Error(msg), { status: 400, code: 'offer_invalid' });
  if (!offer || !offer.active || offer.archived) throw fail('Offer code is not valid');
  const now = new Date();
  if (offer.startsAt && offer.startsAt > now) throw fail('Offer has not started');
  if (offer.endsAt && offer.endsAt < now) throw fail('Offer has expired');
  if (offer.planIds?.length && !offer.planIds.includes(planId)) throw fail('Offer does not apply to this plan');
  if (baseMinor < Number(offer.minAmountMinor || 0)) throw fail('Order is below the offer minimum');
  // Read-only check: paid uses + live reservations. Capacity is only taken at checkout.
  if (offerCapacityLeft(offer) <= 0) throw fail('Offer usage limit reached');
  if (offer.perTenantLimit != null) {
    const used = await OfferRedemption.countDocuments({ offerId: offer.offerId, tenantId, status: { $in: ['pending', 'applied'] } });
    if (used >= Number(offer.perTenantLimit)) throw fail('You have already used this offer');
  }
  const discount = offer.discountType === 'fixed'
    ? Math.round(Number(offer.discountValue || 0))
    : Math.round(baseMinor * Number(offer.discountValue || 0) / 100);
  return { offer, discountMinor: Math.max(0, Math.min(baseMinor, discount)) };
}

export async function quotePlanChange({ tenantId, planId, interval, offerCode, walletMinor: requestedWalletMinor, useWallet = true }) {
  const cfg = await getBillingConfig();
  const config = publicBillingConfig(cfg);
  const lib = await getLibrary(tenantId);
  if (!lib) throw Object.assign(new Error('Library not found'), { status: 404 });
  const plans = (await SoftwarePlan.find({ active: true }).sort({ sortOrder: 1, priceMonthly: 1 }).lean()).map(pubPlan);
  const plan = planId ? plans.find(p => p.planId === planId) : (lib.planId ? plans.find(p => p.planId === lib.planId) : null);
  if (!plan) throw Object.assign(new Error('Choose a plan'), { status: 400, code: 'plan_required' });
  const iv = INTERVALS.includes(interval) ? interval : (lib.subscription?.interval || 'month');
  if (iv === 'year' && plan.priceYearly == null) throw Object.assign(new Error('This plan has no yearly price'), { status: 400 });
  const targetPriceMinor = minor(planPrice(plan, iv));
  const existing = lib.subscription?.toObject?.() || lib.subscription || null;
  const currentPlan = existing?.planId ? plans.find(p => p.planId === existing.planId) : null;
  const currentPriceMinor = existing ? minor(existing.price ?? planPrice(currentPlan || { priceMonthly: 0, priceYearly: 0 }, existing.interval || 'month')) : 0;
  const now = new Date();
  let changeType = 'new';
  let baseMinor = targetPriceMinor;
  let effectiveAt = null;

  // Upgrade rule: while the current period is still open, a more expensive plan is
  // prorated for the remaining days and the period end stays put (existing rule).
  // A cheaper plan is scheduled at period end. When the period has lapsed (expired,
  // cancelled, awaiting payment, or the end date is already past), renewing the same
  // plan or moving to another plan charges a full period that starts at payment time.
  // Early renewal of an open period continues from the current expiry (not the day after).
  const periodEndDate = existing?.currentPeriodEnd ? new Date(existing.currentPeriodEnd) : null;
  const trialEndDate = existing?.trialEndsAt ? new Date(existing.trialEndsAt) : null;
  const openUntil = existing?.status === 'trialing' ? (trialEndDate || periodEndDate) : periodEndDate;
  const periodOpen = Boolean(existing && ['active', 'trialing', 'past_due'].includes(existing.status) && (!openUntil || openUntil > now));

  if (periodOpen) {
    if (existing.planId === plan.planId && (existing.interval || 'month') === iv) {
      changeType = 'renewal';
      baseMinor = targetPriceMinor;
    } else {
      const periodsPerYear = (p) => (p === 'year' ? 12 : 1);
      const targetMonthly = targetPriceMinor / periodsPerYear(iv);
      const currentMonthly = currentPriceMinor / periodsPerYear(existing.interval || 'month');
      if (targetMonthly <= currentMonthly) {
        changeType = 'downgrade';
        baseMinor = 0;
        effectiveAt = existing.currentPeriodEnd || addInterval(now, existing.interval || 'month');
      } else {
        changeType = 'upgrade';
        const periodEnd = new Date(existing.currentPeriodEnd || addInterval(now, existing.interval || 'month'));
        const periodStart = new Date(existing.startedAt || existing.currentPeriodStart || now);
        const totalDays = Math.max(1, Math.ceil((periodEnd - periodStart) / 864e5));
        const remainingDays = Math.max(0, Math.min(totalDays, Math.ceil((periodEnd - now) / 864e5)));
        // Unused value of the current plan for the remaining days.
        const currentUnusedCredit = Math.round(currentPriceMinor * remainingDays / totalDays);
        // Target-plan value for those same remaining days. When intervals differ, use a daily rate.
        const targetRemaining = (existing.interval || 'month') === iv
          ? Math.round(targetPriceMinor * remainingDays / totalDays)
          : Math.round((targetPriceMinor / (iv === 'year' ? 365 : 30)) * remainingDays);
        // Charge only the uplift for the unused portion, never create a refund here.
        baseMinor = Math.max(0, targetRemaining - currentUnusedCredit);
        effectiveAt = now;
      }
    }
  } else if (existing?.planId) {
    const same = existing.planId === plan.planId && (existing.interval || 'month') === iv;
    changeType = same ? 'renewal' : 'new';
    baseMinor = targetPriceMinor;
    effectiveAt = now;
  }

  const historyType = changeType === 'upgrade' ? 'upgrade'
    : changeType === 'downgrade' ? 'downgrade'
    : changeType === 'renewal'
      ? (openUntil && openUntil > now ? 'early_renew' : 'renew')
      : (existing?.planId && existing.planId !== plan.planId ? 'upgrade' : 'new');

  const offerResult = changeType === 'downgrade' || changeType === 'none'
    ? { offer: null, discountMinor: 0 }
    : await applyOffer({ code: offerCode, baseMinor, planId: plan.planId, tenantId });
  const taxable = Math.max(0, baseMinor - offerResult.discountMinor);
  const tax = taxFor(taxable, config);
  const totalMinor = tax.totalMinor;
  const wallet = await walletSnapshot(tenantId, config.currency);
  const cap = Math.floor(totalMinor * Number(config.walletMaxSpendPercent ?? 100) / 100);
  const walletAppliedMinor = !useWallet ? 0
    : Math.min(wallet.availableMinor, cap, requestedWalletMinor != null ? Math.max(0, Math.round(Number(requestedWalletMinor))) : cap);
  const gatewayDueMinor = Math.max(0, totalMinor - walletAppliedMinor);

  return {
    plan: pubPlan(plan),
    plans,
    interval: iv,
    changeType,
    historyType,
    currentPlanId: existing?.planId || null,
    currentInterval: existing?.interval || null,
    currentPeriodEnd: existing?.currentPeriodEnd || null,
    effectiveAt,
    baseMinor,
    discountMinor: offerResult.discountMinor,
    offer: offerResult.offer ? { offerId: offerResult.offer.offerId, code: offerResult.offer.code, name: offerResult.offer.name } : null,
    taxableMinor: tax.taxableMinor,
    taxMinor: tax.taxMinor,
    taxMode: tax.mode,
    taxRatePct: tax.ratePct,
    taxIncluded: tax.mode === 'included',
    totalMinor,
    walletAppliedMinor,
    gatewayDueMinor,
    wallet,
    billingConfig: config,
    ready: Boolean(config.configured) || totalMinor === 0,
    currency: config.currency,
  };
}

/** One shared view for owner and super-admin billing history so both show identical values. */
export function invoiceView(inv, lib, apiBase) {
  const fin = invoiceFinancials(inv);
  const { raw, paidEvidence, ...rest } = inv;
  const paid = inv.status === 'paid';
  const receiptUrl = paid ? `${apiBase}/invoices/${inv.invoiceId}/receipt` : null;
  return {
    ...rest,
    libraryName: lib?.name || null,
    legacy: fin.legacy,
    totalMinor: fin.totalMinor,
    walletMinor: fin.walletMinor,
    gatewayMinor: fin.gatewayMinor,
    taxMinor: Number(inv.taxMinor || 0),
    total: fin.totalMinor / 100,
    walletAmount: fin.walletMinor / 100,
    gatewayAmount: fin.gatewayMinor / 100,
    taxAmount: Number(inv.taxMinor || 0) / 100,
    providerOrderRef: inv.providerOrderRef || null,
    providerPaymentRef: inv.providerPaymentRef || null,
    metadata: { changeType: inv.changeType || null, offerId: inv.offerId || null, holdId: inv.holdId || null, topupId: inv.topupId || null, failureReason: inv.failureReason || null },
    delivery: inv.receiptDelivery || null,
    receiptUrl,
    receiptPdfUrl: receiptUrl ? `${receiptUrl}?format=pdf` : null,
    isPaymentReceipt: paid && fin.totalMinor > 0,
  };
}

async function createProviderCheckout({ provider, library, plan, interval, amountMinor, invoiceId, returnUrl, cancelUrl }) {
  return provider.createCheckout({
    library, plan, interval, amount: amountMinor / 100, invoiceId,
    returnUrl: returnUrl || `${process.env.FRONTEND_URL || ''}/#software_plan`,
    cancelUrl: cancelUrl || `${process.env.FRONTEND_URL || ''}/#software_plan`,
  });
}

export async function checkoutSoftwarePlan(req, res) {
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header is required', code: 'idempotency_key_required' });
  const existing = await SoftwareInvoice.findOne({ tenantId: req.tenantId, idempotencyKey });
  if (existing) return res.json({ ok: true, invoice: existing, checkout: existing.raw?.checkout || null, replay: true });

  const quote = await quotePlanChange({ tenantId: req.tenantId, ...req.body });
  const lib = await getLibrary(req.tenantId);
  if (quote.changeType === 'none') return res.json({ ok: true, changeType: 'none', quote, invoice: null });
  if (quote.changeType === 'downgrade') {
    await Library.updateOne({ libraryId: req.tenantId }, { $set: {
      'subscription.pendingPlanId': quote.plan.planId,
      'subscription.pendingInterval': quote.interval,
      'subscription.pendingEffectiveAt': quote.effectiveAt,
    } });
    await audit(req, 'software_plan.downgrade_scheduled', { detail: { planId: quote.plan.planId, effectiveAt: quote.effectiveAt } });
    return res.json({ ok: true, changeType: 'downgrade', quote, invoice: null, effectiveAt: quote.effectiveAt });
  }
  if (!quote.ready) return res.status(409).json({ error: 'Billing tax and currency must be configured by the Super Admin first', code: 'billing_not_configured' });

  let hold = null;
  if (quote.walletAppliedMinor > 0) {
    try {
      hold = await holdWallet({ tenantId: req.tenantId, amountMinor: quote.walletAppliedMinor, purpose: `software plan ${quote.plan.planId}` });
    } catch (e) {
      return res.status(e.status || 409).json({ error: e.message, code: e.code || 'wallet_hold_failed' });
    }
  }
  const invoiceId = newInvoiceId();
  let invoice;
  try {
    invoice = await SoftwareInvoice.create({
      invoiceId, tenantId: req.tenantId, kind: quote.changeType === 'upgrade' ? 'upgrade' : 'subscription',
      changeType: quote.changeType, historyType: quote.historyType, planId: quote.plan.planId, interval: quote.interval,
      amount: quote.totalMinor / 100, totalMinor: quote.totalMinor, baseMinor: quote.baseMinor,
      discountMinor: quote.discountMinor, taxableMinor: quote.taxableMinor, taxMinor: quote.taxMinor,
      taxIncluded: quote.taxIncluded, taxRate: quote.taxRatePct, walletMinor: quote.walletAppliedMinor,
      gatewayMinor: quote.gatewayDueMinor, currency: quote.currency, status: 'open', dueAt: new Date(),
      holdId: hold?.holdId, offerId: quote.offer?.offerId, idempotencyKey,
    });
  } catch (e) {
    if (hold) await releaseWalletHold(hold.holdId, { reason: 'Duplicate checkout' });
    if (e?.code === 11000) {
      const dup = await SoftwareInvoice.findOne({ tenantId: req.tenantId, idempotencyKey });
      return res.json({ ok: true, invoice: dup, checkout: dup?.raw?.checkout || null, replay: true });
    }
    throw e;
  }
  if (hold) await WalletHold.updateOne({ holdId: hold.holdId }, { $set: { invoiceId } });
  if (quote.offer?.offerId) {
    try {
      await reserveOffer({ offerId: quote.offer.offerId, tenantId: req.tenantId, invoiceId, discountMinor: quote.discountMinor });
    } catch (e) {
      await failInvoice(invoiceId, { reason: e.message });
      await SoftwareInvoice.updateOne({ invoiceId, status: 'open' }, { $set: { status: 'void' } });
      return res.status(e.status || 409).json({ error: e.message, code: e.code || 'offer_invalid', invoiceId });
    }
  }

  if (quote.gatewayDueMinor === 0) {
    const settled = await settleInvoice(invoiceId, { providerRef: `wallet:${hold?.holdId || invoiceId}`, gatewayMinor: 0, source: 'wallet' });
    await audit(req, 'software_plan.wallet_payment', { detail: { invoiceId, totalMinor: quote.totalMinor, walletMinor: quote.walletAppliedMinor } });
    return res.status(201).json({ ok: true, invoice: settled.invoice, checkout: null, walletOnly: true, quote });
  }

  const provider = paymentProvider();
  if (!provider) {
    await failInvoice(invoiceId, { reason: 'Payment provider not configured' });
    return res.status(503).json({ error: 'Payments are not set up yet. Ask the Super Admin to configure Razorpay or PayPal.', code: 'payments_not_configured', invoiceId });
  }
  try {
    const checkout = await createProviderCheckout({
      provider, library: lib, plan: quote.plan, interval: quote.interval,
      amountMinor: quote.gatewayDueMinor, invoiceId,
      returnUrl: req.body?.returnUrl, cancelUrl: req.body?.cancelUrl,
    });
    await SoftwareInvoice.updateOne({ invoiceId }, { $set: { provider: provider.name, providerRef: checkout.reference, providerOrderRef: checkout.reference, 'raw.checkout': checkout } });
    invoice = await SoftwareInvoice.findOne({ invoiceId });
    await audit(req, 'software_plan.checkout_started', { detail: { invoiceId, provider: provider.name, gatewayMinor: quote.gatewayDueMinor, walletMinor: quote.walletAppliedMinor } });
    res.status(201).json({ ok: true, invoice, checkout: { ...checkout, amountMinor: quote.gatewayDueMinor }, quote });
  } catch (e) {
    await failInvoice(invoiceId, { reason: e.message });
    throw e;
  }
}

export function createSoftwarePlanRouter() {
  const r = express.Router();
  // Financial history and purchases belong to library owners, not staff or partner views.
  r.use('/', requireRole('client_admin', 'superadmin'));

  r.get('/', wrap(async (req, res) => {
    const lib = await getLibrary(req.tenantId);
    if (lib && !lib.referralCode) {
      const code = `LIB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      await Library.updateOne({ libraryId: req.tenantId }, { $set: { referralCode: code } });
      lib.referralCode = code;
    }
    const plans = (await SoftwarePlan.find({ active: true, public: true }).sort({ sortOrder: 1, priceMonthly: 1 }).lean()).map(pubPlan);
    const wallet = await walletSnapshot(req.tenantId);
    const referredBy = await Referral.findOne({ referredTenantId: req.tenantId }).lean();
    res.json({
      libraryId: req.tenantId,
      planId: lib?.planId || null,
      subscription: lib?.subscription || null,
      plans,
      wallet,
      billingConfig: publicBillingConfig(await getBillingConfig()),
      // Refer & Earn uses the library's own shareable code (lib.referralCode), not referral.code from a referred-by row.
      referralCode: lib?.referralCode || null,
      referral: {
        code: lib?.referralCode || null,
        status: referredBy?.status || null,
        rewardMinor: referredBy?.rewardMinor || null,
        qualifiedAt: referredBy?.qualifiedAt || null,
        referredBy: referredBy ? { status: referredBy.status, code: referredBy.code, rewardMinor: referredBy.rewardMinor } : null,
      },
      providersConfigured: Boolean(paymentProvider()),
    });
  }));

  r.post('/quote', wrap(async (req, res) => {
    const q = await quotePlanChange({ tenantId: req.tenantId, ...req.body });
    res.json(q);
  }));

  r.get('/offers', wrap(async (req, res) => {
    const lib = await getLibrary(req.tenantId);
    const now = new Date();
    const rows = await Offer.find({ active: true, archived: false }).sort({ createdAt: -1 }).limit(50).lean();
    const used = await OfferRedemption.find({ tenantId: req.tenantId, status: { $in: ['pending', 'applied'] } }).lean();
    const usedBy = new Set(used.map(x => x.offerId));
    res.json(rows.filter(o => (!o.startsAt || o.startsAt <= now) && (!o.endsAt || o.endsAt >= now)
      && (!o.planIds?.length || (lib?.planId && o.planIds.includes(lib.planId)))).map(o => ({
      offerId: o.offerId, code: o.code, name: o.name, discountType: o.discountType,
      discountValue: o.discountValue, minAmountMinor: o.minAmountMinor || 0,
      eligible: !usedBy.has(o.offerId), used: usedBy.has(o.offerId),
    })));
  }));

  r.get('/invoices', wrap(async (req, res) => {
    const rows = await SoftwareInvoice.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 50), 200)).lean();
    const lib = await Library.findOne({ libraryId: req.tenantId }).select('name').lean();
    res.json(rows.map(inv => invoiceView(inv, lib, '/api/software-plan')));
  }));

  r.get('/invoices/:invoiceId/receipt', wrap(async (req, res) => {
    const inv = await SoftwareInvoice.findOne({ invoiceId: req.params.invoiceId, tenantId: req.tenantId }).lean();
    if (!inv || inv.status !== 'paid') return res.status(404).json({ error: 'Paid invoice not found' });
    const lib = await Library.findOne({ libraryId: req.tenantId }).lean();
    const body = softwareReceiptText(inv, lib);
    const format = String(req.query?.format || 'txt').toLowerCase();
    if (format === 'pdf') {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="receipt-${inv.receiptNo}.pdf"`);
      return res.send(textToPdf(body));
    }
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="receipt-${inv.receiptNo}.txt"`);
    res.send(body);
  }));

  r.post('/invoices/:invoiceId/receipt/deliver', wrap(async (req, res) => {
    const inv = await SoftwareInvoice.findOne({ invoiceId: req.params.invoiceId, tenantId: req.tenantId }).lean();
    if (!inv || inv.status !== 'paid') return res.status(404).json({ error: 'Paid invoice not found' });
    const result = await deliverSoftwareReceipt(inv.invoiceId, { force: true, trigger: 'owner_resend', actor: req.user?.email, tenantId: req.tenantId });
    await audit(req, 'software_plan.receipt_resent', { target: inv.invoiceId, detail: { status: result.status, attemptId: result.attemptId } });
    res.status(result.ok ? 200 : 502).json(result);
  }));

  r.post('/checkout', wrap(checkoutSoftwarePlan));

  r.get('/wallet', wrap(async (req, res) => res.json(await walletSnapshot(req.tenantId))));
  r.get('/wallet/history', wrap(async (req, res) => res.json(await walletHistory(req.tenantId, req.query.limit))));

  r.post('/wallet/topups', wrap(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
    if (!key) return res.status(400).json({ error: 'Idempotency-Key header is required', code: 'idempotency_key_required' });
    const amountMinor = Math.round(Number(req.body?.amountMinor ?? minor(req.body?.amount)));
    if (!(amountMinor > 0)) return res.status(400).json({ error: 'Top-up amount must be positive' });
    const existing = await WalletTopup.findOne({ tenantId: req.tenantId, 'raw.idempotencyKey': key }).lean();
    if (existing) return res.json({ ok: true, topup: existing, replay: true });
    const config = publicBillingConfig(await getBillingConfig());
    if (!config.configured) return res.status(409).json({ error: 'Billing configuration is required before top-ups', code: 'billing_not_configured' });
    const provider = paymentProvider();
    if (!provider) return res.status(503).json({ error: 'Payments are not set up yet', code: 'payments_not_configured' });
    const lib = await getLibrary(req.tenantId);
    const topupId = rid('tu');
    const invoiceId = newInvoiceId();
    const topup = await WalletTopup.create({
      topupId, tenantId: req.tenantId, amountMinor, currency: config.currency, status: 'pending', provider: provider.name, invoiceId,
    });
    // Stash idempotency on the top-up too (not schema-unique, but tenant-scoped check above).
    await WalletTopup.updateOne({ topupId }, { $set: { 'raw.idempotencyKey': key } });
    await SoftwareInvoice.create({
      invoiceId, tenantId: req.tenantId, kind: 'topup', planId: null, interval: null,
      amount: amountMinor / 100, totalMinor: amountMinor, baseMinor: amountMinor, gatewayMinor: amountMinor,
      walletMinor: 0, discountMinor: 0, taxMinor: 0, currency: config.currency, status: 'open',
      provider: provider.name, topupId, idempotencyKey: `topup:${key}`,
    });
    try {
      const checkout = await createProviderCheckout({
        provider, library: lib, plan: null, interval: null, amountMinor, invoiceId,
        returnUrl: req.body?.returnUrl, cancelUrl: req.body?.cancelUrl,
      });
      await SoftwareInvoice.updateOne({ invoiceId }, { $set: { provider: provider.name, providerRef: checkout.reference, providerOrderRef: checkout.reference, 'raw.checkout': checkout } });
      res.status(201).json({ ok: true, topup, invoiceId, checkout: { ...checkout, amountMinor } });
    } catch (e) {
      await failInvoice(invoiceId, { reason: e.message });
      await WalletTopup.updateOne({ topupId }, { $set: { status: 'failed' } });
      throw e;
    }
  }));

  r.get('/referrals', wrap(async (req, res) => {
    const lib = await getLibrary(req.tenantId);
    if (lib && !lib.referralCode) {
      const code = `LIB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      await Library.updateOne({ libraryId: req.tenantId }, { $set: { referralCode: code } });
      lib.referralCode = code;
    }
    const [campaign, referred, earned] = await Promise.all([
      ReferralCampaign.findOne({ active: true }).sort({ createdAt: -1 }).lean(),
      Referral.find({ referrerTenantId: req.tenantId }).sort({ createdAt: -1 }).limit(100).lean(),
      Referral.find({ referrerTenantId: req.tenantId, status: 'credited' }).lean(),
    ]);
    const y = await Referral.findOne({ referredTenantId: req.tenantId }).lean();
    res.json({
      code: lib?.referralCode || null,
      campaign: campaign ? { campaignId: campaign.campaignId, name: campaign.name, rewardMinor: campaign.rewardMinor, rewardBucket: campaign.rewardBucket, qualifyingEvent: campaign.qualifyingEvent } : null,
      referrals: referred.map(x => ({ referralId: x.referralId, status: x.status, rewardMinor: x.rewardMinor, qualifiedAt: x.qualifiedAt, createdAt: x.createdAt, reason: x.reason })),
      earnedMinor: earned.reduce((s, x) => s + Number(x.rewardMinor || 0), 0),
      referredBy: y ? { status: y.status, rewardMinor: y.rewardMinor } : null,
    });
  }));

  // Owner explicitly resumes a late-verified gateway payment after the original wallet hold was released.
  // No activation happens until the original wallet share is held again with sufficient funds.
  r.post('/invoices/:invoiceId/recover', wrap(async (req, res) => {
    const inv = await SoftwareInvoice.findOne({ invoiceId: req.params.invoiceId, tenantId: req.tenantId });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status !== 'requires_recovery') return res.status(409).json({ error: 'This invoice is not waiting for recovery', code: 'not_recoverable' });
    const evidence = inv.paidEvidence;
    if (!evidence || Number(evidence.gatewayMinor) !== Number(inv.gatewayMinor || 0)) {
      return res.status(409).json({ error: 'Verified gateway evidence is missing', code: 'evidence_missing' });
    }
    // Claim recovery atomically so two owner requests cannot both take a wallet hold.
    const claimed = await SoftwareInvoice.findOneAndUpdate(
      { invoiceId: inv.invoiceId, tenantId: req.tenantId, status: 'requires_recovery' },
      { $set: { status: 'open', recoveredAt: new Date() } },
      { new: true },
    );
    if (!claimed) return res.status(409).json({ error: 'Recovery is already in progress', code: 'not_recoverable' });
    let hold = null;
    if (Number(inv.walletMinor || 0) > 0) {
      try {
        hold = await holdWallet({ tenantId: req.tenantId, amountMinor: Number(inv.walletMinor), purpose: `recover ${inv.invoiceId}`, invoiceId: inv.invoiceId });
      } catch (e) {
        await SoftwareInvoice.updateOne({ invoiceId: inv.invoiceId, status: 'open' }, { $set: { status: 'requires_recovery' } });
        return res.status(e.status || 409).json({ error: e.message, code: e.code || 'wallet_hold_failed' });
      }
    }
    await SoftwareInvoice.updateOne({ invoiceId: inv.invoiceId, status: 'open' }, {
      $set: { holdId: hold?.holdId || null },
    });
    const settled = await settleInvoice(inv.invoiceId, {
      providerRef: evidence.providerRef, gatewayMinor: evidence.gatewayMinor,
      currency: evidence.currency, provider: evidence.provider, source: evidence.source,
      raw: evidence.raw || { recovery: true }, recovery: true,
    });
    await audit(req, 'software_plan.payment_recovered', { detail: { invoiceId: inv.invoiceId, walletMinor: inv.walletMinor, gatewayMinor: inv.gatewayMinor } });
    res.status(settled.ok ? 200 : 409).json(settled);
  }));

  // Test-only settlement helper mirrors a verified provider webhook without calling a real provider.
  r.post('/invoices/:invoiceId/test-settle', wrap(async (req, res) => {
    if (process.env.NODE_ENV !== 'test') return res.status(404).json({ error: 'Not found' });
    const inv = await SoftwareInvoice.findOne({ invoiceId: req.params.invoiceId, tenantId: req.tenantId });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const r2 = await settleInvoice(req.params.invoiceId, { providerRef: 'test_ref', gatewayMinor: req.body?.gatewayMinor, raw: { test: true }, source: 'test' });
    res.json(r2);
  }));
  r.post('/invoices/:invoiceId/test-fail', wrap(async (req, res) => {
    if (process.env.NODE_ENV !== 'test') return res.status(404).json({ error: 'Not found' });
    const inv = await SoftwareInvoice.findOne({ invoiceId: req.params.invoiceId, tenantId: req.tenantId });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(await failInvoice(req.params.invoiceId, { reason: req.body?.reason || 'Test failure' }));
  }));


  return r;
}

export function createSoftwarePlanAdminRouter() {
  // Mounted at /api/admin: invoices live under /software-plan/*, while offers and
  // referral campaigns keep the /admin/offers and /admin/referral-campaigns contract used by the UI.
  const r = express.Router();
  // Super-admin billing history: plain JSON array, same view as the owner list.
  r.get('/software-plan/invoices', wrap(async (req, res) => {
    const q = {};
    if (req.query.tenantId) q.tenantId = String(req.query.tenantId);
    if (req.query.status) q.status = String(req.query.status);
    const rows = await SoftwareInvoice.find(q).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 100), 500)).lean();
    const libs = await Library.find({ libraryId: { $in: [...new Set(rows.map(x => x.tenantId))] } }).select('libraryId name').lean();
    const byId = Object.fromEntries(libs.map(l => [l.libraryId, l]));
    res.json(rows.map(inv => invoiceView(inv, byId[inv.tenantId], '/api/admin/software-plan')));
  }));
  r.get('/software-plan/invoices/:invoiceId/receipt', wrap(async (req, res) => {
    const inv = await SoftwareInvoice.findOne({ invoiceId: req.params.invoiceId, status: 'paid' }).lean();
    if (!inv) return res.status(404).json({ error: 'Paid invoice not found' });
    const lib = await Library.findOne({ libraryId: inv.tenantId }).lean();
    const body = softwareReceiptText(inv, lib);
    if (String(req.query?.format || 'txt').toLowerCase() === 'pdf') {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="receipt-${inv.receiptNo}.pdf"`);
      return res.send(textToPdf(body));
    }
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="receipt-${inv.receiptNo}.txt"`);
    res.send(body);
  }));
  r.post('/software-plan/invoices/:invoiceId/receipt/deliver', wrap(async (req, res) => {
    const inv = await SoftwareInvoice.findOne({ invoiceId: req.params.invoiceId, status: 'paid' }).lean();
    if (!inv) return res.status(404).json({ error: 'Paid invoice not found' });
    // Delivery is bound to the invoice's own tenant, never to the admin's context.
    const result = await deliverSoftwareReceipt(inv.invoiceId, { force: true, trigger: 'admin_resend', actor: req.user?.email, tenantId: inv.tenantId });
    await audit(req, 'software_plan.receipt_resent', { tenantId: inv.tenantId, target: inv.invoiceId, detail: { status: result.status, attemptId: result.attemptId, by: 'superadmin' } });
    res.status(result.ok ? 200 : 502).json(result);
  }));
  r.get('/offers', wrap(async (_req, res) => res.json(await Offer.find().sort({ createdAt: -1 }).lean())));
  r.post('/offers', wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.code) return res.status(400).json({ error: 'name and code are required' });
    const type = b.discountType === 'fixed' ? 'fixed' : 'percentage';
    const value = Number(b.discountValue || 0);
    if (value < 0 || (type === 'percentage' && value > 100)) return res.status(400).json({ error: 'Invalid discount value' });
    const offer = await Offer.create({
      offerId: rid('off'), name: String(b.name).slice(0, 100), code: String(b.code).toUpperCase().trim(),
      discountType: type, discountValue: type === 'fixed' ? Math.round(value) : value,
      startsAt: b.startsAt || null, endsAt: b.endsAt || null,
      usageLimit: b.usageLimit ?? null, perTenantLimit: b.perTenantLimit ?? 1,
      planIds: Array.isArray(b.planIds) ? b.planIds : [], minAmountMinor: Math.round(Number(b.minAmountMinor || 0)),
      active: b.active !== false, updatedBy: req.user.email,
    });
    await audit(req, 'offer.created', { detail: { offerId: offer.offerId, code: offer.code } });
    res.status(201).json(offer);
  }));
  r.put('/offers/:offerId', wrap(async (req, res) => {
    const patch = { ...req.body, updatedBy: req.user.email };
    delete patch._id; delete patch.offerId; delete patch.usedCount;
    const offer = await Offer.findOneAndUpdate({ offerId: req.params.offerId }, { $set: patch }, { new: true });
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    res.json(offer);
  }));

  r.get('/referral-campaigns', wrap(async (_req, res) => res.json(await ReferralCampaign.find().sort({ createdAt: -1 }).lean())));
  r.post('/referral-campaigns', wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name is required' });
    const c = await ReferralCampaign.create({
      campaignId: rid('rc'), name: String(b.name).slice(0, 100), rewardMinor: Math.max(0, Math.round(Number(b.rewardMinor || 0))),
      rewardBucket: b.rewardBucket === 'cash' ? 'cash' : 'bonus', qualifyingEvent: 'first_paid_subscription',
      startsAt: b.startsAt || null, endsAt: b.endsAt || null, active: b.active !== false,
      maxRewards: b.maxRewards ?? null, planIds: Array.isArray(b.planIds) ? b.planIds : [],
      allowTrials: !!b.allowTrials, allow100PercentPromo: !!b.allow100PercentPromo, updatedBy: req.user.email,
    });
    await audit(req, 'referral.campaign_created', { detail: { campaignId: c.campaignId } });
    res.status(201).json(c);
  }));
  r.put('/referral-campaigns/:campaignId', wrap(async (req, res) => {
    const patch = { ...req.body, updatedBy: req.user.email };
    delete patch._id; delete patch.campaignId;
    const c = await ReferralCampaign.findOneAndUpdate({ campaignId: req.params.campaignId }, { $set: patch }, { new: true });
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    res.json(c);
  }));
  return r;
}

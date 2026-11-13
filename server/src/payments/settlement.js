// Issue #19: one idempotent settlement path for full-wallet, split and gateway payments.
import crypto from 'crypto';
import { Library, User } from '../models.js';
import { SoftwareInvoice, newReceiptNo } from './invoices.js';
import { WalletTopup, WalletHold, ReferralCampaign, Referral, Offer, OfferRedemption } from '../commerce.js';
import { captureWalletHold, releaseWalletHold, creditWallet } from '../wallet.js';
import { addInterval } from '../billing.js';
import { SoftwarePlan } from '../plans.js';
import { sendMail } from '../mailer.js';
import { sendMobileMessage, smsConfigured } from '../messaging.js';
import { textToPdf } from '../pdf.js';
import { applyOfferOnSettlement, releaseOfferReservation } from './offers.js';

const rid = (p) => `${p}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
const asMoney = (v) => Math.round(Number(v));

// Process crash can leave status=settling forever. After this age a verified retry may reclaim.
// Capture/credit/entitlement steps remain idempotent so reclaim is safe.
const STALE_SETTLING_MS = Number(process.env.SETTLEMENT_STALE_MS || 60_000);
export function settlementStaleAfterMs() { return STALE_SETTLING_MS; }

async function qualifyReferral({ invoice, now }) {
  if (!invoice || invoice.kind === 'topup') return null;
  if (!(invoice.totalMinor > 0)) return null;
  const ref = await Referral.findOne({ referredTenantId: invoice.tenantId, status: 'pending' });
  if (!ref) return null;
  if (ref.referrerTenantId === invoice.tenantId) {
    ref.status = 'rejected'; ref.reason = 'Self-referral is not allowed'; await ref.save();
    return ref;
  }
  const campaign = ref.campaignId
    ? await ReferralCampaign.findOne({ campaignId: ref.campaignId, active: true })
    : await ReferralCampaign.findOne({ active: true }).sort({ createdAt: -1 });
  if (campaign) {
    if (campaign.endsAt && campaign.endsAt < now) return null;
    if (campaign.startsAt && campaign.startsAt > now) return null;
    if (invoice.changeType === 'trial' && !campaign.allowTrials) return null;
    const fullyDiscounted = Number(invoice.gatewayMinor || 0) === 0 && Number(invoice.walletMinor || 0) === 0;
    if (fullyDiscounted && Number(invoice.discountMinor || 0) >= Number(invoice.baseMinor || 0) && !campaign.allow100PercentPromo) {
      ref.status = 'rejected'; ref.reason = '100% promo does not qualify by default'; await ref.save();
      return ref;
    }
    if (Array.isArray(campaign.planIds) && campaign.planIds.length && !campaign.planIds.includes(invoice.planId)) {
      ref.status = 'rejected'; ref.reason = 'Plan not eligible for this campaign'; await ref.save();
      return ref;
    }
    if (campaign.maxRewards) {
      const credited = await Referral.countDocuments({ campaignId: campaign.campaignId, status: 'credited' });
      if (credited >= campaign.maxRewards) return null;
    }
    ref.campaignId = campaign.campaignId;
    ref.rewardMinor = Number(campaign.rewardMinor || 0);
    if (campaign.rewardMinor > 0) {
      await creditWallet({
        tenantId: ref.referrerTenantId, amountMinor: campaign.rewardMinor, bucket: campaign.rewardBucket || 'bonus',
        reason: `Referral reward (${invoice.tenantId})`, source: 'referral', campaignId: campaign.campaignId,
        invoiceId: invoice.invoiceId, idempotencyKey: `referral:${ref.referralId}`,
      });
      ref.status = 'credited'; ref.creditedAt = now;
    } else {
      ref.status = 'qualified';
    }
  } else {
    ref.status = 'qualified';
  }
  ref.qualifiedAt = now;
  ref.invoiceId = invoice.invoiceId;
  ref.reason = ref.reason || 'First genuine paid subscription';
  await ref.save();
  return ref;
}

/** Legacy provider invoices only stored `amount`; all new invoices use integer minor fields. */
export function invoiceFinancials(invoice) {
  const legacy = !(Number(invoice.totalMinor || 0) > 0 || Number(invoice.walletMinor || 0) > 0
    || Number(invoice.gatewayMinor || 0) > 0 || Boolean(invoice.holdId) || invoice.kind === 'topup');
  const totalMinor = legacy ? asMoney(Number(invoice.amount) * 100) : asMoney(invoice.totalMinor);
  const walletMinor = legacy ? 0 : asMoney(invoice.walletMinor || 0);
  const gatewayMinor = legacy ? totalMinor : asMoney(invoice.gatewayMinor || 0);
  return { legacy, totalMinor, walletMinor, gatewayMinor };
}

/** Separate payment/capture id from order id; never invent either. */
function refFields(invoice, { providerRef, providerOrderRef, source }) {
  if (source === 'wallet') return { providerPaymentRef: null, providerOrderRef: invoice.providerOrderRef || null };
  const order = providerOrderRef || invoice.providerOrderRef || (invoice.providerRef && invoice.providerRef !== providerRef ? invoice.providerRef : null);
  return { providerPaymentRef: providerRef || null, providerOrderRef: order || null };
}

function mismatch(invoice, reason, evidence = {}) {
  invoice.status = 'past_due';
  invoice.failureReason = reason;
  if (!Array.isArray(invoice.failureHistory)) invoice.failureHistory = [];
  invoice.failureHistory.push({ at: new Date(), reason, ...evidence });
  return invoice.save().then(() => ({ ok: false, error: 'amount_or_provider_mismatch', invoice }));
}

function validateFinancials(invoice, { gatewayMinor, currency, provider, source, providerRef, providerOrderRef }) {
  const expected = invoiceFinancials(invoice);
  if (!(expected.totalMinor > 0)) return { error: 'amount_unverified', expected };
  if (invoice.currency && currency && String(invoice.currency).toUpperCase() !== String(currency).toUpperCase()) {
    return { error: 'currency_mismatch', expected };
  }
  if (source !== 'test' && source !== 'wallet') {
    if (!invoice.provider) return { error: 'provider_missing', expected };
    if (!provider || String(provider).toLowerCase() !== String(invoice.provider).toLowerCase()) {
      return { error: 'provider_mismatch', expected };
    }
    if (expected.gatewayMinor > 0) {
      if (!currency) return { error: 'currency_missing', expected };
      if (gatewayMinor === undefined || gatewayMinor === null || !Number.isFinite(Number(gatewayMinor))) {
        return { error: 'amount_missing', expected };
      }
    }
    // Provider ref guard must NOT skip when the event's refs are null/undefined.
    // If the invoice already has a stored order/payment ref, the event must match it.
    if (invoice.providerRef) {
      const matchesRef = providerRef != null && providerRef !== ''
        && String(invoice.providerRef) === String(providerRef);
      const matchesOrder = providerOrderRef != null && providerOrderRef !== ''
        && String(invoice.providerRef) === String(providerOrderRef);
      if (!matchesRef && !matchesOrder) {
        return { error: 'provider_reference_mismatch', expected };
      }
    }
  }
  if (gatewayMinor !== undefined && gatewayMinor !== null && asMoney(gatewayMinor) !== expected.gatewayMinor) {
    return { error: 'amount_mismatch', expected };
  }
  if (source === 'wallet' && expected.gatewayMinor !== 0) return { error: 'gateway_due', expected };
  if (expected.gatewayMinor > 0 && (gatewayMinor === undefined || gatewayMinor === null || !Number.isFinite(Number(gatewayMinor)))) {
    return { error: 'amount_missing', expected };
  }
  return { expected };
}

async function markRequiresRecovery(invoice, { providerRef, gatewayMinor, currency, provider, source, raw }) {
  const evidence = {
    providerRef: providerRef || null,
    gatewayMinor: asMoney(gatewayMinor),
    currency: currency || invoice.currency,
    provider: provider || invoice.provider,
    source,
    raw,
    verifiedAt: new Date(),
  };
  invoice.status = 'requires_recovery';
  invoice.paidEvidence = evidence;
  invoice.failureReason = 'Gateway payment verified after the wallet hold was released';
  if (!Array.isArray(invoice.failureHistory)) invoice.failureHistory = [];
  invoice.failureHistory.push({ at: new Date(), reason: invoice.failureReason, providerRef, gatewayMinor: evidence.gatewayMinor, currency: evidence.currency, source });
  await invoice.save();
  return { ok: false, error: 'wallet_hold_released', requiresRecovery: true, invoice };
}

/** Build plain-text plan receipt body (PLAN-08). Legacy invoices fall back to invoiceFinancials. */
export function softwareReceiptText(inv, lib) {
  const fin = invoiceFinancials(inv);
  const m = (v) => `${(Number(v || 0) / 100).toFixed(2)} ${inv.currency || 'INR'}`;
  const baseMinor = fin.legacy ? fin.totalMinor : Number(inv.baseMinor || 0);
  const discountMinor = fin.legacy ? 0 : Number(inv.discountMinor || 0);
  const taxable = fin.legacy ? fin.totalMinor : Number(inv.taxableMinor || Math.max(0, baseMinor - discountMinor));
  const taxMinor = fin.legacy ? Number(inv.taxMinor || 0) : Number(inv.taxMinor || 0);
  const paymentId = inv.providerPaymentRef || (inv.gatewayMinor > 0 || fin.legacy ? inv.providerRef : null);
  const orderId = inv.providerOrderRef || null;
  return [
    'MY LIBRARY OS — SOFTWARE PLAN PAYMENT RECEIPT',
    `Receipt: ${inv.receiptNo}`,
    `Invoice: ${inv.invoiceId}`,
    `Library: ${lib?.name || inv.tenantId} (${inv.tenantId})`,
    `Status: paid · Paid: ${new Date(inv.paidAt || inv.updatedAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    `Plan: ${inv.planId || (inv.kind === 'topup' ? 'Wallet top-up' : 'Subscription')}${inv.interval ? ` (${inv.interval})` : ''}`,
    inv.periodStart || inv.periodEnd ? `Subscription period: ${inv.periodStart ? new Date(inv.periodStart).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'} to ${inv.periodEnd ? new Date(inv.periodEnd).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}` : null,
    `Plan price: ${m(baseMinor)}`,
    `Discount: ${m(discountMinor)}`,
    `Taxable value: ${m(taxable)}`,
    fin.legacy && !inv.taxMinor ? 'GST: not itemised on this legacy invoice' : `GST${inv.taxIncluded ? ' (included in plan price)' : ' (added)'}: ${m(taxMinor)}`,
    `Total: ${m(fin.totalMinor)}`,
    `Wallet used: ${m(fin.walletMinor)}`,
    `External gateway paid: ${m(fin.gatewayMinor)}`,
    `Payment method: ${fin.walletMinor > 0 && fin.gatewayMinor > 0 ? `Wallet + ${inv.provider || 'gateway'}` : fin.gatewayMinor > 0 ? (inv.provider || 'gateway') : 'Wallet'}`,
    paymentId ? `Payment/capture ID: ${paymentId}` : null,
    orderId ? `Order ID: ${orderId}` : null,
    !paymentId && !orderId ? `Transaction reference: ${inv.providerRef || `wallet:${inv.invoiceId}`}` : null,
    '',
    'Gateway fees are absorbed by My Library OS; they are not added to this receipt.',
    'This is a My Library OS subscription receipt, not a student fee receipt.',
  ].filter(v => v !== null).join('\n');
}

export function softwareReceiptPdf(inv, lib) {
  return textToPdf(softwareReceiptText(inv, lib));
}

const SENDING_STALE_MS = Number(process.env.RECEIPT_SENDING_STALE_MS || 120_000);
const maskTarget = (t) => (t ? String(t).replace(/^(.{2}).*(@.*)$/, '$1***$2').replace(/^(\d{2}).*(\d{4})$/, '$1****$2') : null);

/**
 * Deliver one software payment receipt through a verified owner channel.
 * Automatic (force=false): at most one attempt ever wins the atomic claim; sent/logged/sending are not repeated.
 * Manual resend (force=true): always a real new attempt, recorded atomically BEFORE sending, then finalised.
 * Status is truthful: sent = accepted by a configured transport; logged = synthetic capture (no transport);
 * failed = transport error. The PDF receipt download never depends on delivery.
 */
export async function deliverSoftwareReceipt(invoiceId, { force = false, trigger, actor, tenantId } = {}) {
  const base = { invoiceId, status: 'paid', ...(tenantId ? { tenantId } : {}) };
  const current = await SoftwareInvoice.findOne(base).lean();
  if (!current) return { ok: false, error: 'paid_invoice_required' };
  if (current.receiptDelivery === null) await SoftwareInvoice.updateOne({ invoiceId, receiptDelivery: null }, { $unset: { receiptDelivery: 1 } });
  const prior = current.receiptDelivery?.status;
  if (!force && ['sent', 'logged'].includes(prior)) return { ok: true, already: true, delivery: current.receiptDelivery };

  const owner = await User.findOne({ tenantId: current.tenantId, role: 'client_admin' }).lean();
  const lib = await Library.findOne({ libraryId: current.tenantId }).lean();
  const email = owner?.email || lib?.contactEmail || null;
  const mobile = owner?.mobileVerified && owner?.mobile ? owner.mobile : null;
  const channel = email ? 'email' : (mobile && smsConfigured() ? 'mobile' : 'none');
  const target = channel === 'email' ? email : channel === 'mobile' ? mobile : null;
  const now = new Date();
  const attemptId = rid('rda');
  const attempt = {
    attemptId, at: now, channel, target: maskTarget(target), status: 'sending', reason: null,
    trigger: trigger || (force ? 'manual_resend' : 'automatic'), actor: actor || null, attachment: channel === 'email',
  };
  const filter = { ...base };
  if (!force) {
    filter.$or = [
      { receiptDelivery: null },
      { receiptDelivery: { $exists: false } },
      { 'receiptDelivery.status': { $in: ['pending', 'failed', 'skipped', null] } },
      { 'receiptDelivery.status': 'sending', 'receiptDelivery.lastAttemptAt': { $lte: new Date(now.getTime() - SENDING_STALE_MS) } },
    ];
  }
  // Stage 1: record the attempt atomically before any send.
  const claimed = await SoftwareInvoice.findOneAndUpdate(
    filter,
    {
      $set: { 'receiptDelivery.status': 'sending', 'receiptDelivery.lastAttemptAt': now, 'receiptDelivery.channel': channel, 'receiptDelivery.reason': null },
      $inc: { 'receiptDelivery.attempts': 1 },
      $push: { 'receiptDelivery.history': attempt },
    },
    { new: true },
  );
  if (!claimed) {
    const fresh = await SoftwareInvoice.findOne(base).lean();
    return { ok: true, already: true, delivery: fresh?.receiptDelivery };
  }

  let result;
  try {
    if (channel === 'email') {
      const text = softwareReceiptText(claimed, lib);
      const accepted = await sendMail({
        to: email,
        subject: `My Library OS payment receipt ${claimed.receiptNo}`,
        text,
        attachments: [{ filename: `receipt-${claimed.receiptNo}.pdf`, content: textToPdf(text), contentType: 'application/pdf' }],
      });
      result = accepted ? { status: 'sent' } : { status: 'logged', reason: 'email_transport_not_configured' };
    } else if (channel === 'mobile') {
      const r = await sendMobileMessage({ to: mobile, text: softwareReceiptText(claimed, lib).slice(0, 600) });
      result = r.sent ? { status: 'sent' } : (r.reason === 'sms_not_configured' ? { status: 'logged', reason: r.reason } : { status: 'failed', reason: r.reason || 'sms_failed' });
    } else {
      result = { status: 'logged', reason: mobile ? 'mobile_transport_not_configured' : 'no_verified_channel' };
    }
  } catch (e) {
    result = { status: 'failed', reason: String(e?.message || 'transport_error').slice(0, 200) };
  }
  // Stage 2: finalise this exact attempt.
  const done = new Date();
  const finalSet = {
    'receiptDelivery.status': result.status,
    'receiptDelivery.reason': result.reason || null,
    'receiptDelivery.history.$[a].status': result.status,
    'receiptDelivery.history.$[a].reason': result.reason || null,
    'receiptDelivery.history.$[a].finishedAt': done,
  };
  if (result.status === 'sent') finalSet['receiptDelivery.sentAt'] = done;
  const updated = await SoftwareInvoice.findOneAndUpdate(
    { invoiceId },
    { $set: finalSet },
    { new: true, arrayFilters: [{ 'a.attemptId': attemptId }] },
  ).lean();
  return { ok: result.status !== 'failed', attemptId, status: result.status, delivery: updated?.receiptDelivery };
}

function isStaleSettling(invoice, now = new Date()) {
  const started = invoice?.settlementStartedAt ? new Date(invoice.settlementStartedAt).getTime() : 0;
  if (!started) return true; // missing timestamp => treat as abandoned so retry can reclaim
  return (now.getTime() - started) >= STALE_SETTLING_MS;
}

/**
 * Claim open/past_due → settling. Fresh concurrent settling returns NOT ok (inProgress).
 * Stale settling (crash/interrupt) may be reclaimed; wallet capture + ledger keys stay idempotent.
 */
async function claimSettlement(invoiceId) {
  const now = new Date();
  const claimed = await SoftwareInvoice.findOneAndUpdate(
    { invoiceId, status: { $in: ['open', 'past_due'] } },
    { $set: { status: 'settling', settlementStartedAt: now, failureReason: null } },
    { new: true },
  );
  if (claimed) return { invoice: claimed, claimed: true };
  const fresh = await SoftwareInvoice.findOne({ invoiceId });
  if (!fresh) return { invoice: null, claimed: false, error: 'invoice_not_found' };
  if (fresh.status === 'paid') return { invoice: fresh, claimed: false, already: true };
  if (fresh.status === 'settling') {
    if (!isStaleSettling(fresh, now)) {
      // Live owner still working — must NOT look like success to webhooks/callers.
      return { invoice: fresh, claimed: false, error: 'settlement_in_progress', inProgress: true, retryable: true };
    }
    const cutoff = new Date(now.getTime() - STALE_SETTLING_MS);
    const reclaimed = await SoftwareInvoice.findOneAndUpdate(
      {
        invoiceId,
        status: 'settling',
        $or: [
          { settlementStartedAt: { $lte: cutoff } },
          { settlementStartedAt: null },
          { settlementStartedAt: { $exists: false } },
        ],
      },
      {
        $set: { settlementStartedAt: now, failureReason: 'Reclaimed stale settling claim for idempotent retry' },
        $push: { failureHistory: { at: now, reason: 'stale_settling_reclaimed', source: 'settlement_reclaim' } },
      },
      { new: true },
    );
    if (reclaimed) return { invoice: reclaimed, claimed: true, reclaimed: true };
    // Lost reclaim race — another retry took it, or it flipped to paid.
    const again = await SoftwareInvoice.findOne({ invoiceId });
    if (again?.status === 'paid') return { invoice: again, claimed: false, already: true };
    return { invoice: again, claimed: false, error: 'settlement_in_progress', inProgress: true, retryable: true };
  }
  return { invoice: fresh, claimed: false, error: 'invoice_not_claimable' };
}

async function rollbackSettlement(invoiceId, { reason, fallbackStatus = 'open' } = {}) {
  await SoftwareInvoice.updateOne(
    { invoiceId, status: 'settling' },
    {
      $set: {
        status: fallbackStatus,
        failureReason: reason ? String(reason).slice(0, 300) : null,
      },
      $push: reason ? { failureHistory: { at: new Date(), reason: String(reason).slice(0, 300), source: 'settlement_rollback' } } : {},
    },
  );
}

/**
 * Settles a verified provider payment or a full-wallet payment.
 * Durable two-stage claim (open → settling → paid) so a duplicate event that
 * arrives between wallet ledger capture and markPaid cannot double-spend,
 * double-credit a referral, or double-apply entitlement.
 */
export async function settleInvoice(invoiceId, { providerRef, providerOrderRef, gatewayMinor, currency, provider, raw, source = 'gateway', recovery = false } = {}) {
  let invoice = await SoftwareInvoice.findOne({ invoiceId });
  if (!invoice) return { ok: false, error: 'invoice_not_found' };
  if (invoice.status === 'paid') return { ok: true, already: true, invoice, status: 'paid' };
  // Fresh settling is handled inside claimSettlement (inProgress, ok:false) or reclaimed if stale.

  const check = validateFinancials(invoice, { gatewayMinor, currency, provider, source, providerRef, providerOrderRef });
  if (check.error) {
    return mismatch(invoice, `Settlement rejected: ${check.error} (expected ${check.expected?.gatewayMinor} minor, got ${gatewayMinor})`, {
      providerRef, gatewayMinor, currency, source,
    });
  }
  const { expected } = check;
  const now = new Date();

  const claim = await claimSettlement(invoiceId);
  if (!claim.claimed) {
    if (claim.already) return { ok: true, already: true, invoice: claim.invoice, status: claim.invoice?.status };
    return {
      ok: false,
      error: claim.error || 'invoice_not_claimable',
      inProgress: Boolean(claim.inProgress),
      retryable: Boolean(claim.retryable || claim.inProgress),
      invoice: claim.invoice,
      status: claim.invoice?.status,
    };
  }
  invoice = claim.invoice;

  try {
    if (invoice.kind === 'topup') {
      const top = await WalletTopup.findOne({ topupId: invoice.topupId });
      if (!top) {
        await rollbackSettlement(invoiceId, { reason: 'topup_not_found' });
        return { ok: false, error: 'topup_not_found' };
      }
      if (top.status === 'paid') {
        const paid = await SoftwareInvoice.findOneAndUpdate(
          { invoiceId, status: 'settling' },
          { $set: { status: 'paid', paidAt: top.paidAt || now, providerRef: providerRef || top.providerRef, receiptNo: invoice.receiptNo || newReceiptNo(), raw } },
          { new: true },
        );
        return { ok: true, already: true, invoice: paid || invoice, status: 'paid', topup: top };
      }
      await creditWallet({
        tenantId: invoice.tenantId, amountMinor: expected.totalMinor, bucket: 'cash',
        reason: 'Wallet top-up', source: 'topup', topupId: top.topupId, invoiceId,
        idempotencyKey: `topup:${top.topupId}`,
      });
      top.status = 'paid'; top.providerRef = providerRef; top.paidAt = now; top.raw = raw;
      await top.save();
      const paidTop = await SoftwareInvoice.findOneAndUpdate(
        { invoiceId, status: 'settling' },
        {
          $set: {
            status: 'paid', paidAt: now, providerRef,
            ...refFields(invoice, { providerRef, providerOrderRef, source }),
            receiptNo: invoice.receiptNo || newReceiptNo(), raw, failureReason: null, paidEvidence: null,
          },
        },
        { new: true },
      );
      if (!paidTop) {
        const fresh = await SoftwareInvoice.findOne({ invoiceId });
        if (fresh?.status === 'paid') return { ok: true, already: true, invoice: fresh, status: 'paid', topup: top };
        return {
          ok: false,
          error: fresh?.status === 'settling' ? 'settlement_in_progress' : 'invoice_not_claimable',
          inProgress: fresh?.status === 'settling',
          retryable: true,
          invoice: fresh,
          status: fresh?.status,
          topup: top,
        };
      }
      // Delivery is idempotent (sent/logged short-circuit); only invoked after THIS handler marks paid.
      try { await deliverSoftwareReceipt(invoiceId); } catch (e) { console.error('[receipt]', e.message); }
      return { ok: true, invoice: paidTop, status: 'paid', topup: top };
    }

    // The wallet share must still be held. A late success may not silently consume new money.
    if (expected.walletMinor > 0) {
      if (!invoice.holdId) {
        // Fall back: durable recovery path — gateway verified but hold gone.
        invoice.status = 'requires_recovery';
        await markRequiresRecovery(invoice, { providerRef, gatewayMinor: expected.gatewayMinor, currency, provider, source, raw });
        return { ok: false, error: 'wallet_hold_released', requiresRecovery: true, invoice };
      }
      const hold = await WalletHold.findOne({ holdId: invoice.holdId }).lean();
      if (!hold || hold.status === 'released' || hold.status === 'expired' || hold.status === 'releasing' || hold.status === 'reconciliation_required') {
        invoice.status = 'requires_recovery';
        await markRequiresRecovery(invoice, { providerRef, gatewayMinor: expected.gatewayMinor, currency, provider, source, raw });
        return { ok: false, error: 'wallet_hold_released', requiresRecovery: true, invoice };
      }
      const cap = await captureWalletHold(invoice.holdId, { reason: `Software plan ${invoice.planId}`, invoiceId, source });
      if (cap.captured === false && cap.hold?.status !== 'captured') {
        invoice.status = 'requires_recovery';
        await markRequiresRecovery(invoice, { providerRef, gatewayMinor: expected.gatewayMinor, currency, provider, source, raw });
        return { ok: false, error: 'wallet_hold_released', requiresRecovery: true, invoice };
      }
    }

    const lib = await Library.findOne({ libraryId: invoice.tenantId });
    if (!lib) {
      await rollbackSettlement(invoiceId, { reason: 'library_not_found' });
      return { ok: false, error: 'library_not_found', invoice };
    }
    const plan = invoice.planId ? await SoftwarePlan.findOne({ planId: invoice.planId }).lean() : null;
    const existing = lib.subscription?.toObject?.() || lib.subscription || {};
    const iv = invoice.interval || existing.interval || 'month';
    const isUpgrade = invoice.kind === 'upgrade' || invoice.changeType === 'upgrade';
    const isRenewal = invoice.changeType === 'renewal';
    const oldEnd = existing.currentPeriodEnd ? new Date(existing.currentPeriodEnd) : null;
    // Renewal extends from the old period end (no lost days when paid early); a lapsed period restarts now.
    const renewFrom = isRenewal && oldEnd && oldEnd > now && existing.planId === invoice.planId ? oldEnd : null;
    const periodStart = isUpgrade ? new Date(existing.currentPeriodStart || existing.startedAt || now) : (renewFrom || now);
    const periodEnd = isUpgrade && oldEnd
      ? oldEnd
      : addInterval(periodStart, iv);

    // Stage 2: durable markPaid. Only the settling claim holder can finish.
    const claimed = await SoftwareInvoice.findOneAndUpdate(
      { invoiceId, status: 'settling' },
      {
        $set: {
          status: 'paid', paidAt: now, providerRef, receiptNo: invoice.receiptNo || newReceiptNo(),
          ...refFields(invoice, { providerRef, providerOrderRef, source }),
          raw, failureReason: null, paidEvidence: null, periodStart, periodEnd,
        },
      },
      { new: true },
    );
    if (!claimed) {
      const fresh = await SoftwareInvoice.findOne({ invoiceId });
      if (fresh?.status === 'paid') return { ok: true, already: true, invoice: fresh, status: 'paid' };
      return {
        ok: false,
        error: fresh?.status === 'settling' ? 'settlement_in_progress' : 'invoice_not_claimable',
        inProgress: fresh?.status === 'settling',
        retryable: fresh?.status === 'settling',
        invoice: fresh,
        status: fresh?.status,
      };
    }
    invoice = claimed;

    const next = {
      ...existing,
      planId: invoice.planId || existing.planId,
      interval: iv,
      status: 'active',
      price: plan ? Number(iv === 'year' ? plan.priceYearly : plan.priceMonthly) : invoice.totalMinor / 100,
      cancelAtPeriodEnd: false,
      pendingPlanId: null,
      pendingInterval: null,
      pendingEffectiveAt: null,
      trialEndsAt: null,
      lastPaymentAt: now,
      lastPaymentRef: providerRef || `wallet:${invoice.invoiceId}`,
      provider: invoice.provider || existing.provider || (invoice.gatewayMinor ? 'gateway' : 'wallet'),
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      ...(isUpgrade || renewFrom ? { startedAt: existing.startedAt || periodStart } : { startedAt: now }),
    };
    const set = { subscription: next };
    if (invoice.planId) { set.planId = invoice.planId; set.plan = plan?.name || invoice.planId; }
    await Library.updateOne({ libraryId: invoice.tenantId }, { $set: set });

    if (invoice.offerId) {
      // Only the single settlement that wins the paid transition reaches here; the redemption flip is conditional too.
      await applyOfferOnSettlement({ invoiceId, tenantId: invoice.tenantId, offerId: invoice.offerId });
    }
    await qualifyReferral({ invoice, now });
    try { await deliverSoftwareReceipt(invoiceId); } catch (e) { console.error('[receipt]', e.message); }
    return { ok: true, invoice, status: 'paid', recovered: Boolean(recovery) };
  } catch (e) {
    // Correct fallback: release the settling claim so a later verified event can retry.
    await rollbackSettlement(invoiceId, { reason: e.message || 'settlement_failed', fallbackStatus: 'open' });
    throw e;
  }
}

/** A failed or abandoned provider payment must release the wallet hold and never activate. */
export async function failInvoice(invoiceId, { providerRef, reason = 'Payment failed', raw } = {}) {
  const invoice = await SoftwareInvoice.findOne({ invoiceId });
  if (!invoice) return { ok: false, error: 'invoice_not_found' };
  if (invoice.status === 'paid') return { ok: true, alreadyPaid: true, invoice }; // late failure is ignored
  if (invoice.status === 'settling') {
    // Do not release holds under a live/stale settle claim; caller should retry settleInvoice.
    return { ok: false, error: 'settlement_in_progress', inProgress: true, retryable: true, invoice, status: 'settling' };
  }
  if (invoice.holdId) {
    try { await releaseWalletHold(invoice.holdId, { reason }); }
    catch (e) { invoice.failureReason = `Wallet release needs reconciliation: ${e.message}`; await invoice.save(); return { ok: false, error: e.code || 'wallet_reconciliation_required', invoice }; }
  }
  await releaseOfferReservation(invoiceId, reason);
  invoice.status = 'open';
  invoice.failureReason = String(reason).slice(0, 300);
  invoice.providerRef = providerRef || invoice.providerRef;
  invoice.raw = raw || invoice.raw;
  if (!Array.isArray(invoice.failureHistory)) invoice.failureHistory = [];
  invoice.failureHistory.push({ at: new Date(), reason: invoice.failureReason, providerRef, source: 'failure' });
  await invoice.save();
  return { ok: true, invoice, status: 'open' };
}

export async function voidInvoice(invoiceId, { reason = 'Voided' } = {}) {
  const invoice = await SoftwareInvoice.findOne({ invoiceId });
  if (!invoice) return null;
  if (invoice.status === 'paid' || invoice.status === 'settling') return invoice;
  if (invoice.holdId) await releaseWalletHold(invoice.holdId, { reason });
  await releaseOfferReservation(invoiceId, reason);
  invoice.status = 'void';
  invoice.failureReason = reason;
  if (!Array.isArray(invoice.failureHistory)) invoice.failureHistory = [];
  invoice.failureHistory.push({ at: new Date(), reason, source: 'void' });
  await invoice.save();
  return invoice;
}

export { qualifyReferral };

// Issue #19: tenant-bound wallet ledger with holds, cash/bonus buckets and expiry.
// All amounts are integer minor units. Operations on one tenant are serialized in-process;
// database conditional updates are the final guard across processes/instances.
import crypto from 'crypto';
import { Wallet, WalletLedger, WalletHold } from './commerce.js';
import { getBillingConfig } from './billingConfig.js';

const rid = (prefix) => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
export const newWalletId = () => rid('wlt');
export const toMinor = (major) => Math.round(Number(major || 0) * 100);
export const toMajor = (minor) => Number(minor || 0) / 100;

const lockQueues = new Map();
async function withTenantLock(tenantId, fn) {
  const key = String(tenantId || '');
  const previous = lockQueues.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.catch(() => {});
  lockQueues.set(key, tail);
  try {
    return await run;
  } finally {
    if (lockQueues.get(key) === tail) lockQueues.delete(key);
  }
}

const fail = (message, status = 409, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

export async function ensureWallet(tenantId, currency = 'INR') {
  try {
    return await Wallet.findOneAndUpdate(
      { tenantId },
      { $setOnInsert: { tenantId, currency, cashMinor: 0, bonusMinor: 0, heldCashMinor: 0, heldBonusMinor: 0 } },
      { upsert: true, new: true, lean: true },
    );
  } catch (e) {
    if (e?.code === 11000) return Wallet.findOne({ tenantId }).lean();
    throw e;
  }
}

export function availableMinor(w) {
  return Number(w?.cashMinor || 0) + Number(w?.bonusMinor || 0)
    - Number(w?.heldCashMinor || 0) - Number(w?.heldBonusMinor || 0);
}

/** Internal: caller must hold the tenant lock. Consumes free (non-held) expired bonus credits. */
async function _expireBonusCredits(tenantId, now = new Date()) {
  const expired = await WalletLedger.find({
    tenantId, kind: 'credit', bucket: 'bonus', remainingMinor: { $gt: 0 },
    expiresAt: { $ne: null, $lte: now },
  }).lean();
  let total = 0;
  for (const e of expired) {
    const claimed = await WalletLedger.findOneAndUpdate(
      { _id: e._id, remainingMinor: { $gt: 0 } },
      { $set: { remainingMinor: 0, expiredAt: now } },
      { new: true },
    );
    if (!claimed) continue;
    const amount = Number(e.remainingMinor || 0);
    // Never let expiry drive the bucket negative (e.g. a corrupt/partial held state).
    const w = await Wallet.findOneAndUpdate(
      { tenantId, bonusMinor: { $gte: amount } },
      { $inc: { bonusMinor: -amount } },
      { new: true, lean: true },
    );
    if (!w) {
      await WalletLedger.updateOne({ _id: e._id }, { $inc: { remainingMinor: amount }, $set: { expiredAt: null } });
      continue;
    }
    total += amount;
    await WalletLedger.updateOne(
      { idempotencyKey: `expire:${e.entryId}` },
      { $setOnInsert: {
        entryId: rid('wle'), tenantId, kind: 'expire', bucket: 'bonus', amountMinor: amount,
        cashAfterMinor: w.cashMinor || 0, bonusAfterMinor: w.bonusMinor || 0,
        reason: 'Promotional credit expired', source: 'wallet_expiry', idempotencyKey: `expire:${e.entryId}`,
      } },
      { upsert: true },
    );
  }
  return total;
}

export async function expireBonusCredits(tenantId, now = new Date()) {
  return withTenantLock(tenantId, () => _expireBonusCredits(tenantId, now));
}

export async function walletSnapshot(tenantId, currency = 'INR') {
  await ensureWallet(tenantId, currency);
  await expireBonusCredits(tenantId);
  const w = await ensureWallet(tenantId, currency);
  return {
    tenantId,
    currency: w.currency || currency,
    cashMinor: Number(w.cashMinor || 0),
    bonusMinor: Number(w.bonusMinor || 0),
    heldCashMinor: Number(w.heldCashMinor || 0),
    heldBonusMinor: Number(w.heldBonusMinor || 0),
    availableMinor: availableMinor(w),
  };
}

export async function walletHistory(tenantId, limit = 100) {
  return WalletLedger.find({ tenantId }).sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 100, 500)).lean();
}

/** Credits a wallet. Bonus credits get an expiry; cash never expires. Idempotent by key. */
export async function creditWallet({
  tenantId, amountMinor, bucket = 'cash', reason = '', source = '',
  campaignId, offerId, invoiceId, topupId, idempotencyKey, expiresAt, meta,
}) {
  const amount = Math.round(Number(amountMinor || 0));
  if (!(amount > 0)) throw fail('Credit amount must be positive', 400);
  return withTenantLock(tenantId, async () => {
    if (idempotencyKey) {
      const existing = await WalletLedger.findOne({ idempotencyKey }).lean();
      if (existing) return existing;
    }
    const config = await getBillingConfig();
    await ensureWallet(tenantId, config.currency);
    let expiry = expiresAt ? new Date(expiresAt) : null;
    if (!expiry && bucket === 'bonus' && config.bonusExpiryEnabled !== false) {
      const months = Number(config.bonusExpiryMonths || 12);
      expiry = new Date(Date.now() + months * 30 * 864e5);
    }
    const inc = bucket === 'bonus' ? { bonusMinor: amount } : { cashMinor: amount };
    const w = await Wallet.findOneAndUpdate({ tenantId }, { $inc: inc }, { new: true, lean: true });
    try {
      return await WalletLedger.create({
        entryId: rid('wle'), tenantId, kind: 'credit', bucket, amountMinor: amount, remainingMinor: amount,
        cashAfterMinor: w?.cashMinor || 0, bonusAfterMinor: w?.bonusMinor || 0,
        reason: String(reason || '').slice(0, 300), source: String(source || '').slice(0, 80),
        campaignId, offerId, invoiceId, topupId, idempotencyKey: idempotencyKey || undefined, expiresAt: expiry, meta,
      });
    } catch (e) {
      await Wallet.findOneAndUpdate({ tenantId }, { $inc: bucket === 'bonus' ? { bonusMinor: -amount } : { cashMinor: -amount } }, {});
      if (e?.code === 11000 && idempotencyKey) return WalletLedger.findOne({ idempotencyKey }).lean();
      throw e;
    }
  });
}

export async function holdWallet({ tenantId, amountMinor, purpose = '', invoiceId, topupId }) {
  const amount = Math.round(Number(amountMinor || 0));
  if (!(amount > 0)) throw fail('Hold amount must be positive', 400);
  return withTenantLock(tenantId, async () => {
    await ensureWallet(tenantId);
    await _expireBonusCredits(tenantId);
    const wallet = await ensureWallet(tenantId);
    if (availableMinor(wallet) < amount) throw fail('Insufficient wallet balance', 409, 'insufficient_wallet');

    const now = new Date();
    const bonusCredits = await WalletLedger.find({
      tenantId, kind: 'credit', bucket: 'bonus', remainingMinor: { $gt: 0 },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }).lean();
    // Soonest expiry first; non-expiring bonus after expiring bonus.
    bonusCredits.sort((a, b) => {
      if (!a.expiresAt && !b.expiresAt) return new Date(a.createdAt) - new Date(b.createdAt);
      if (!a.expiresAt) return 1;
      if (!b.expiresAt) return -1;
      return new Date(a.expiresAt) - new Date(b.expiresAt) || new Date(a.createdAt) - new Date(b.createdAt);
    });
    const cashCredits = await WalletLedger.find({ tenantId, kind: 'credit', bucket: 'cash', remainingMinor: { $gt: 0 } })
      .sort({ createdAt: 1 }).lean();

    let left = amount;
    let cashPart = 0;
    let bonusPart = 0;
    const allocations = [];
    for (const [bucket, credits] of [['bonus', bonusCredits], ['cash', cashCredits]]) {
      for (const c of credits) {
        if (left <= 0) break;
        const take = Math.min(left, Number(c.remainingMinor || 0));
        if (take <= 0) continue;
        const ok = await WalletLedger.findOneAndUpdate(
          { _id: c._id, remainingMinor: { $gte: take } },
          { $inc: { remainingMinor: -take } },
          { new: true },
        );
        if (!ok) continue;
        allocations.push({ entryId: String(c.entryId), bucket, amountMinor: take });
        if (bucket === 'bonus') bonusPart += take; else cashPart += take;
        left -= take;
      }
    }
    if (left > 0) {
      for (const a of allocations) await WalletLedger.updateOne({ tenantId, entryId: a.entryId }, { $inc: { remainingMinor: a.amountMinor } });
      throw fail('Insufficient wallet balance', 409, 'insufficient_wallet');
    }
    const holdId = rid('hold');
    let hold;
    let heldApplied = false;
    try {
      hold = await WalletHold.create({ holdId, tenantId, amountMinor: amount, cashMinor: cashPart, bonusMinor: bonusPart, allocations, purpose, invoiceId, topupId });
      const w = await Wallet.findOneAndUpdate(
        { tenantId },
        { $inc: { heldCashMinor: cashPart, heldBonusMinor: bonusPart } },
        { new: true, lean: true },
      );
      heldApplied = Boolean(w);
      await WalletLedger.updateOne(
        { idempotencyKey: `hold:${holdId}` },
        { $setOnInsert: {
          entryId: rid('wle'), tenantId, kind: 'hold', bucket: null, amountMinor: amount,
          cashAfterMinor: w?.cashMinor || 0, bonusAfterMinor: w?.bonusMinor || 0,
          reason: `Wallet reserved${purpose ? ` for ${purpose}` : ''}`, source: 'wallet_hold', invoiceId, topupId, holdId,
          idempotencyKey: `hold:${holdId}`,
        } },
        { upsert: true },
      );
    } catch (e) {
      if (hold) await WalletHold.deleteOne({ holdId });
      for (const a of allocations) await WalletLedger.updateOne({ tenantId, entryId: a.entryId }, { $inc: { remainingMinor: a.amountMinor } });
      if (heldApplied) await Wallet.findOneAndUpdate({ tenantId }, { $inc: { heldCashMinor: -cashPart, heldBonusMinor: -bonusPart } });
      throw e;
    }
    return hold.toObject ? hold.toObject() : hold;
  });
}

export async function captureWalletHold(holdId, meta = {}) {
  const existing = await WalletHold.findOne({ holdId }).lean();
  if (!existing) throw fail('Wallet hold not found', 404);
  return withTenantLock(existing.tenantId, async () => {
    const current = await WalletHold.findOne({ holdId }).lean();
    if (!current) throw fail('Wallet hold not found', 404);
    if (current.status === 'captured') return { hold: current, already: true };
    if (current.status === 'released' || current.status === 'expired') return { hold: current, already: false, captured: false };
    const hold = await WalletHold.findOneAndUpdate(
      { holdId, status: 'held' },
      { $set: { status: 'captured', capturedAt: new Date() } },
      { new: true },
    );
    if (!hold) {
      const h = await WalletHold.findOne({ holdId }).lean();
      return { hold: h, already: h?.status === 'captured', captured: h?.status === 'captured' };
    }
    const w = await Wallet.findOneAndUpdate(
      {
        tenantId: hold.tenantId,
        cashMinor: { $gte: hold.cashMinor },
        bonusMinor: { $gte: hold.bonusMinor },
        heldCashMinor: { $gte: hold.cashMinor },
        heldBonusMinor: { $gte: hold.bonusMinor },
      },
      { $inc: { cashMinor: -hold.cashMinor, bonusMinor: -hold.bonusMinor, heldCashMinor: -hold.cashMinor, heldBonusMinor: -hold.bonusMinor } },
      { new: true, lean: true },
    );
    if (!w) {
      await WalletHold.updateOne({ holdId }, { $set: { status: 'reconciliation_required' } });
      throw fail('Wallet state could not be reconciled for capture', 409, 'wallet_reconciliation_required');
    }
    const allocations = hold.allocations?.length ? hold.allocations : [
      ...(hold.bonusMinor ? [{ entryId: 'bonus', bucket: 'bonus', amountMinor: hold.bonusMinor }] : []),
      ...(hold.cashMinor ? [{ entryId: 'cash', bucket: 'cash', amountMinor: hold.cashMinor }] : []),
    ];
    for (const a of allocations) {
      if (!a.amountMinor) continue;
      await WalletLedger.updateOne(
        { idempotencyKey: `capture:${holdId}:${a.entryId}` },
        { $setOnInsert: {
          entryId: rid('wle'), tenantId: hold.tenantId, kind: 'debit', bucket: a.bucket, amountMinor: a.amountMinor,
          cashAfterMinor: w.cashMinor || 0, bonusAfterMinor: w.bonusMinor || 0,
          reason: String(meta.reason || 'Wallet payment'), source: String(meta.source || 'wallet_payment'),
          invoiceId: hold.invoiceId || meta.invoiceId, topupId: hold.topupId, holdId,
          idempotencyKey: `capture:${holdId}:${a.entryId}`,
        } },
        { upsert: true },
      );
    }
    return { hold: hold.toObject ? hold.toObject() : hold, already: false, captured: true };
  });
}

export async function releaseWalletHold(holdId, { reason = 'Payment failed' } = {}) {
  const existing = await WalletHold.findOne({ holdId }).lean();
  if (!existing) return { hold: null, already: true };
  return withTenantLock(existing.tenantId, async () => {
    const current = await WalletHold.findOne({ holdId }).lean();
    if (!current) return { hold: null, already: true };
    if (current.status === 'released') return { hold: current, already: true };
    if (current.status === 'captured') return { hold: current, already: false, captured: true };
    if (current.status === 'reconciliation_required') throw fail('Wallet hold needs manual reconciliation', 409, 'wallet_reconciliation_required');
    const hold = await WalletHold.findOneAndUpdate(
      { holdId, status: 'held' },
      { $set: { status: 'releasing', releasedAt: new Date() } },
      { new: true },
    );
    if (!hold) {
      const h = await WalletHold.findOne({ holdId }).lean();
      return { hold: h, already: h?.status === 'released', captured: h?.status === 'captured' };
    }
    const w = await Wallet.findOneAndUpdate(
      {
        tenantId: hold.tenantId,
        heldCashMinor: { $gte: hold.cashMinor },
        heldBonusMinor: { $gte: hold.bonusMinor },
      },
      { $inc: { heldCashMinor: -hold.cashMinor, heldBonusMinor: -hold.bonusMinor } },
      { new: true, lean: true },
    );
    if (!w) {
      await WalletHold.updateOne({ holdId }, { $set: { status: 'reconciliation_required' } });
      throw fail('Wallet state could not be reconciled for release', 409, 'wallet_reconciliation_required');
    }
    for (const a of hold.allocations || []) {
      await WalletLedger.updateOne({ tenantId: hold.tenantId, entryId: a.entryId }, { $inc: { remainingMinor: a.amountMinor } });
    }
    await WalletLedger.updateOne(
      { idempotencyKey: `release:${holdId}` },
      { $setOnInsert: {
        entryId: rid('wle'), tenantId: hold.tenantId, kind: 'release', bucket: null, amountMinor: hold.amountMinor,
        cashAfterMinor: w.cashMinor || 0, bonusAfterMinor: w.bonusMinor || 0,
        reason: String(reason || 'Payment failed'), source: 'wallet_release', invoiceId: hold.invoiceId, topupId: hold.topupId, holdId,
        idempotencyKey: `release:${holdId}`,
      } },
      { upsert: true },
    );
    await WalletHold.updateOne({ holdId }, { $set: { status: 'released', releasedAt: new Date() } });
    return { hold: { ...(hold.toObject ? hold.toObject() : hold), status: 'released' }, already: false };
  });
}

export async function debitWallet({ tenantId, amountMinor, reason, invoiceId, source = 'wallet_payment' }) {
  const hold = await holdWallet({ tenantId, amountMinor, purpose: reason, invoiceId });
  return captureWalletHold(hold.holdId, { reason, invoiceId, source });
}

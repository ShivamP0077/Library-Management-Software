// Offer quota accounting (Issue #19).
// Quote is read-only. Checkout reserves capacity atomically; settlement converts exactly one
// reservation into a paid use; failure/void revokes the reservation.
import crypto from 'crypto';
import { Offer, OfferRedemption } from '../commerce.js';

const rid = (p) => `${p}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
const err = (msg) => Object.assign(new Error(msg), { status: 400, code: 'offer_invalid' });

/** Remaining global capacity counting paid uses and live reservations. */
export function offerCapacityLeft(offer) {
  if (offer?.usageLimit == null) return Infinity;
  return Number(offer.usageLimit) - Number(offer.usedCount || 0) - Number(offer.reservedCount || 0);
}

/**
 * Reserve one use of `offerId` for `tenantId` on `invoiceId`.
 * Per-tenant: claims a unique slot (0..perTenantLimit-1) so concurrent checkouts cannot exceed it.
 * Global: conditional $inc on reservedCount only while usedCount + reservedCount < usageLimit.
 */
export async function reserveOffer({ offerId, tenantId, invoiceId, discountMinor }) {
  const existing = await OfferRedemption.findOne({ offerId, tenantId, invoiceId, status: { $in: ['pending', 'applied'] } }).lean();
  if (existing) return existing;
  const offer = await Offer.findOne({ offerId }).lean();
  if (!offer || !offer.active || offer.archived) throw err('Offer code is not valid');
  const perTenant = offer.perTenantLimit == null ? null : Math.max(0, Number(offer.perTenantLimit));
  let redemption = null;
  const slots = perTenant == null ? [undefined] : Array.from({ length: perTenant }, (_, i) => i);
  for (const slot of slots) {
    try {
      redemption = await OfferRedemption.create({
        redemptionId: rid('ore'), offerId, tenantId, invoiceId, discountMinor, status: 'pending',
        ...(slot !== undefined ? { slot } : {}),
      });
      break;
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  if (!redemption) throw err('You have already used this offer');
  const inc = await Offer.findOneAndUpdate(
    {
      offerId, active: true, archived: { $ne: true },
      $or: [
        { usageLimit: null },
        { $expr: { $lt: [{ $add: [{ $ifNull: ['$usedCount', 0] }, { $ifNull: ['$reservedCount', 0] }] }, '$usageLimit'] } },
      ],
    },
    { $inc: { reservedCount: 1 } },
    { new: true },
  );
  if (!inc) {
    await OfferRedemption.updateOne({ redemptionId: redemption.redemptionId }, { $set: { status: 'void', voidReason: 'usage_limit_reached' }, $unset: { slot: 1 } });
    throw err('Offer usage limit reached');
  }
  return redemption.toObject();
}

/** Revoke a pending reservation (payment failed / invoice voided). Idempotent. */
export async function releaseOfferReservation(invoiceId, reason = 'payment_failed') {
  const rows = await OfferRedemption.find({ invoiceId, status: 'pending' }).lean();
  for (const r of rows) {
    const done = await OfferRedemption.findOneAndUpdate(
      { redemptionId: r.redemptionId, status: 'pending' },
      { $set: { status: 'void', voidReason: String(reason).slice(0, 200) }, $unset: { slot: 1 } },
    );
    if (done) await Offer.updateOne({ offerId: r.offerId, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1 } });
  }
}

/** Convert the invoice's reservation to a paid use exactly once. */
export async function applyOfferOnSettlement({ invoiceId, tenantId, offerId }) {
  const pending = await OfferRedemption.findOneAndUpdate(
    { invoiceId, tenantId, offerId, status: 'pending' },
    { $set: { status: 'applied' } },
  );
  if (pending) {
    await Offer.updateOne({ offerId, reservedCount: { $gt: 0 } }, { $inc: { usedCount: 1, reservedCount: -1 } });
    return { applied: true };
  }
  // A verified late payment after the reservation was voided: the discount was charged, so count it truthfully.
  const revived = await OfferRedemption.findOneAndUpdate(
    { invoiceId, tenantId, offerId, status: 'void' },
    { $set: { status: 'applied', voidReason: 'late_payment_settled' } },
  );
  if (revived) {
    await Offer.updateOne({ offerId }, { $inc: { usedCount: 1 } });
    return { applied: true, late: true };
  }
  return { applied: false };
}

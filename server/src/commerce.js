// Issue #19: wallet, offers, referrals and top-up records.
// Wallet amounts are integer minor units (paise/cents) everywhere.
import mongoose from 'mongoose';

const add = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

const walletSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, unique: true, index: true },
  currency: { type: String, default: 'INR' },
  cashMinor: { type: Number, default: 0 },
  bonusMinor: { type: Number, default: 0 },
  heldCashMinor: { type: Number, default: 0 },
  heldBonusMinor: { type: Number, default: 0 },
}, { timestamps: true });
export const Wallet = add('Wallet', walletSchema);

const walletLedgerSchema = new mongoose.Schema({
  entryId: { type: String, required: true, unique: true, index: true },
  tenantId: { type: String, required: true, index: true },
  kind: { type: String, enum: ['credit', 'debit', 'hold', 'release', 'expire', 'adjustment'], required: true },
  bucket: { type: String, enum: ['cash', 'bonus', null], default: 'cash' },
  amountMinor: { type: Number, required: true },
  remainingMinor: { type: Number, default: 0 },
  cashAfterMinor: { type: Number, default: 0 },
  bonusAfterMinor: { type: Number, default: 0 },
  reason: { type: String, default: '' },
  source: { type: String, default: '' },
  campaignId: String,
  offerId: String,
  invoiceId: String,
  topupId: String,
  holdId: String,
  idempotencyKey: { type: String },
  expiresAt: { type: Date, default: null },
  expiredAt: { type: Date, default: null },
  meta: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
walletLedgerSchema.index({ tenantId: 1, createdAt: -1 });
walletLedgerSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
export const WalletLedger = add('WalletLedger', walletLedgerSchema);

const walletHoldSchema = new mongoose.Schema({
  holdId: { type: String, required: true, unique: true, index: true },
  tenantId: { type: String, required: true, index: true },
  amountMinor: { type: Number, required: true },
  cashMinor: { type: Number, default: 0 },
  bonusMinor: { type: Number, default: 0 },
  allocations: { type: [{ entryId: String, bucket: String, amountMinor: Number }], default: [] },
  status: { type: String, enum: ['held', 'releasing', 'captured', 'released', 'expired', 'reconciliation_required'], default: 'held', index: true },
  purpose: String,
  invoiceId: String,
  topupId: String,
  capturedAt: Date,
  releasedAt: Date,
}, { timestamps: true });
export const WalletHold = add('WalletHold', walletHoldSchema);

const walletTopupSchema = new mongoose.Schema({
  topupId: { type: String, required: true, unique: true, index: true },
  tenantId: { type: String, required: true, index: true },
  amountMinor: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['pending', 'paid', 'failed', 'cancelled'], default: 'pending', index: true },
  provider: String,
  providerRef: String,
  invoiceId: { type: String, index: true },
  paidAt: Date,
  raw: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
export const WalletTopup = add('WalletTopup', walletTopupSchema);

const offerSchema = new mongoose.Schema({
  offerId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
  discountType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
  discountValue: { type: Number, default: 0 }, // percent (0-100) or minor currency units
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  usageLimit: { type: Number, default: null },
  perTenantLimit: { type: Number, default: 1 },
  usedCount: { type: Number, default: 0 }, // settled (paid) redemptions only
  reservedCount: { type: Number, default: 0 }, // pending checkout reservations holding capacity
  planIds: { type: [String], default: [] },
  minAmountMinor: { type: Number, default: 0 },
  stackable: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  archived: { type: Boolean, default: false },
  updatedBy: String,
}, { timestamps: true });
export const Offer = add('Offer', offerSchema);

const offerRedemptionSchema = new mongoose.Schema({
  redemptionId: { type: String, required: true, unique: true, index: true },
  offerId: { type: String, required: true, index: true },
  tenantId: { type: String, required: true, index: true },
  invoiceId: { type: String, index: true },
  discountMinor: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'applied', 'void'], default: 'pending', index: true },
  // Per-tenant capacity slot (0..perTenantLimit-1). Unique while set; unset when voided so it can be reused.
  slot: { type: Number },
  voidReason: String,
}, { timestamps: true });
offerRedemptionSchema.index({ offerId: 1, tenantId: 1, status: 1 });
offerRedemptionSchema.index({ offerId: 1, tenantId: 1, slot: 1 }, { unique: true, partialFilterExpression: { slot: { $type: 'number' } } });
export const OfferRedemption = add('OfferRedemption', offerRedemptionSchema);

const referralCampaignSchema = new mongoose.Schema({
  campaignId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  rewardMinor: { type: Number, default: 0 },
  rewardBucket: { type: String, enum: ['bonus', 'cash'], default: 'bonus' },
  qualifyingEvent: { type: String, default: 'first_paid_subscription' },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  active: { type: Boolean, default: true },
  maxRewards: { type: Number, default: null },
  planIds: { type: [String], default: [] },
  allowTrials: { type: Boolean, default: false },
  allow100PercentPromo: { type: Boolean, default: false },
  updatedBy: String,
}, { timestamps: true });
export const ReferralCampaign = add('ReferralCampaign', referralCampaignSchema);

const referralSchema = new mongoose.Schema({
  referralId: { type: String, required: true, unique: true, index: true },
  code: { type: String, required: true, index: true },
  referrerTenantId: { type: String, required: true, index: true },
  referredTenantId: { type: String, required: true, unique: true, index: true },
  campaignId: { type: String, index: true },
  status: { type: String, enum: ['pending', 'qualified', 'credited', 'rejected'], default: 'pending', index: true },
  rewardMinor: { type: Number, default: 0 },
  reason: String,
  invoiceId: String,
  qualifiedAt: Date,
  creditedAt: Date,
}, { timestamps: true });
export const Referral = add('Referral', referralSchema);

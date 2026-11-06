// Issue #19: explicitly configurable billing policy. There is deliberately NO default GST rate.
import mongoose from 'mongoose';
import express from 'express';
import { audit } from './audit.js';

const schema = new mongoose.Schema({
  _id: { type: String, default: 'default' },
  currency: { type: String, enum: ['INR', 'USD'], default: 'INR' },
  taxMode: { type: String, enum: ['included', 'excluded', 'none', null], default: null },
  taxRatePct: { type: Number, default: null, min: 0, max: 100 },
  walletMaxSpendPercent: { type: Number, default: 100, min: 0, max: 100 },
  bonusExpiryEnabled: { type: Boolean, default: true },
  bonusExpiryMonths: { type: Number, default: 12, min: 1, max: 120 },
  gatewayFeesAbsorbed: { type: Boolean, default: true },
  configuredAt: { type: Date, default: null },
  updatedBy: String,
}, { collection: 'platform_billing_config', timestamps: true });

export const PlatformBillingConfig = mongoose.models.PlatformBillingConfig
  || mongoose.model('PlatformBillingConfig', schema);

export async function getBillingConfig() {
  let doc = await PlatformBillingConfig.findById('default');
  if (!doc) doc = await PlatformBillingConfig.create({ _id: 'default' });
  return doc;
}

export function publicBillingConfig(doc) {
  const d = doc?.toObject ? doc.toObject() : (doc || {});
  return {
    currency: d.currency || 'INR',
    taxMode: d.taxMode ?? null,
    taxRatePct: d.taxRatePct ?? null,
    walletMaxSpendPercent: d.walletMaxSpendPercent ?? 100,
    bonusExpiryEnabled: d.bonusExpiryEnabled !== false,
    bonusExpiryMonths: d.bonusExpiryMonths || 12,
    gatewayFeesAbsorbed: d.gatewayFeesAbsorbed !== false,
    configured: Boolean(d.configuredAt),
    configuredAt: d.configuredAt || null,
    updatedBy: d.updatedBy || null,
  };
}

export async function updateBillingConfig(body = {}, { updatedBy } = {}) {
  const doc = await getBillingConfig();
  if (body.currency !== undefined) {
    if (!['INR', 'USD'].includes(body.currency)) throw Object.assign(new Error('Invalid currency'), { status: 400 });
    doc.currency = body.currency;
  }
  if (body.taxMode !== undefined) {
    if (!['included', 'excluded', 'none'].includes(body.taxMode)) throw Object.assign(new Error('Choose how tax applies (included, excluded or none)'), { status: 400 });
    doc.taxMode = body.taxMode;
  }
  if (body.taxRatePct !== undefined) {
    if (body.taxRatePct === null || body.taxRatePct === '') doc.taxRatePct = null;
    else {
      const n = Number(body.taxRatePct);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw Object.assign(new Error('Invalid tax rate'), { status: 400 });
      doc.taxRatePct = n;
    }
  }
  if (body.taxMode !== undefined && doc.taxMode !== 'none' && doc.taxRatePct == null) {
    throw Object.assign(new Error('Set the tax rate explicitly before enabling tax'), { status: 400, code: 'tax_rate_required' });
  }
  for (const [k, min, max] of [['walletMaxSpendPercent', 0, 100], ['bonusExpiryMonths', 1, 120]]) {
    if (body[k] !== undefined) {
      const n = Number(body[k]);
      if (!Number.isFinite(n) || n < min || n > max) throw Object.assign(new Error(`Invalid ${k}`), { status: 400 });
      doc[k] = n;
    }
  }
  if (body.bonusExpiryEnabled !== undefined) doc.bonusExpiryEnabled = !!body.bonusExpiryEnabled;
  if (body.gatewayFeesAbsorbed !== undefined) doc.gatewayFeesAbsorbed = true; // platform absorbs gateway fees
  if (body.taxMode !== undefined) doc.configuredAt = new Date(); // conscious configuration only
  doc.updatedBy = updatedBy || null;
  await doc.save();
  return publicBillingConfig(doc);
}

/** Calculates tax for a pre-tax taxable amount (minor units). */
export function taxFor(taxableMinor, config) {
  const base = Math.max(0, Math.round(Number(taxableMinor || 0)));
  const mode = config?.taxMode || null;
  const rate = Number(config?.taxRatePct ?? 0);
  if (!mode || mode === 'none' || !rate) {
    return { taxableMinor: base, taxMinor: 0, totalMinor: base, mode: mode || 'none', ratePct: rate };
  }
  if (mode === 'excluded') {
    const taxMinor = Math.round(base * rate / 100);
    return { taxableMinor: base, taxMinor, totalMinor: base + taxMinor, mode, ratePct: rate };
  }
  // included: the advertised/plan amount is the final GST-inclusive amount.
  const taxMinor = Math.round(base * rate / (100 + rate));
  return { taxableMinor: base - taxMinor, taxMinor, totalMinor: base, mode, ratePct: rate };
}

export function createBillingAdminRouter() {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  r.get('/billing/config', wrap(async (_req, res) => res.json(publicBillingConfig(await getBillingConfig()))));
  r.put('/billing/config', wrap(async (req, res) => {
    const view = await updateBillingConfig(req.body || {}, { updatedBy: req.user.email });
    await audit(req, 'billing.config_updated', { detail: view });
    res.json(view);
  }));
  return r;
}

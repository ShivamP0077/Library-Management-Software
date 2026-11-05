// Issue #14: subscription access + plan feature gates.
// Libraries with no subscription keep working (existing installs). Only libraries that
// have a subscription record are locked when unpaid / trial ended / cancelled / expired.
import { Library } from './models.js';
import { SoftwarePlan, libraryLimits } from './plans.js';

const LOCKED = new Set(['pending_payment', 'expired', 'cancelled', 'past_due']);
const OPEN = new Set(['active', 'trialing']);

/** Paths a locked library may still call (pay, ask for help, read their plan). */
const ALLOW_PREFIXES = [
  '/subscription',
  '/support',
  '/auth/',
];

export function effectiveStatus(sub, now = new Date()) {
  if (!sub || !sub.status) return null;
  let status = sub.status;
  if (status === 'trialing') {
    const end = sub.trialEndsAt || sub.currentPeriodEnd;
    if (end && new Date(end) < now) status = 'expired';
  } else if (status === 'active' && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) < now && !sub.cancelAtPeriodEnd) {
    // Period ended without renewal.
    status = 'expired';
  } else if (status === 'active' && sub.cancelAtPeriodEnd && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) < now) {
    status = 'cancelled';
  }
  return status;
}

/**
 * Whether the library may use write APIs.
 * No subscription → allowed (legacy libraries). Super-admin drill-in → allowed.
 */
export function accessFor(lib, { now = new Date(), role } = {}) {
  if (role === 'superadmin') return { ok: true, status: null, code: null };
  if (!lib?.subscription) return { ok: true, status: null, code: null };
  const status = effectiveStatus(lib.subscription, now);
  if (OPEN.has(status)) return { ok: true, status, code: null };
  if (LOCKED.has(status)) {
    const messages = {
      pending_payment: 'Complete payment to unlock your library.',
      expired: 'Your plan or free trial has ended. Renew to continue.',
      cancelled: 'Your subscription was cancelled. Choose a plan to continue.',
      past_due: 'Your last payment failed. Update billing to continue.',
    };
    return { ok: false, status, code: 'subscription_locked', message: messages[status] || 'Subscription inactive.' };
  }
  return { ok: true, status, code: null };
}

/** Persist expired/cancelled when we notice the period ended (lazy, no cron required). */
export async function refreshSubscriptionStatus(libraryId, now = new Date()) {
  const lib = await Library.findOne({ libraryId }).lean();
  if (!lib?.subscription) return lib;
  const next = effectiveStatus(lib.subscription, now);
  if (next && next !== lib.subscription.status) {
    await Library.updateOne({ libraryId }, { $set: { 'subscription.status': next } });
    return { ...lib, subscription: { ...lib.subscription, status: next } };
  }
  return lib;
}

export function pathAllowedWhenLocked(path = '') {
  const p = path.split('?')[0];
  return ALLOW_PREFIXES.some(pre => p === pre || p.startsWith(pre + '/') || p.startsWith(pre));
}

/**
 * After tenantScope: block mutating requests when the subscription is locked.
 * GET/HEAD/OPTIONS always allowed so owners can still see data and the paywall.
 */
export function requireActiveSubscription(req, res, next) {
  Promise.resolve((async () => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.user?.role === 'superadmin') return next();
    if (!req.tenantId) return next();
    if (pathAllowedWhenLocked(req.path) || pathAllowedWhenLocked(req.baseUrl + req.path)) return next();
    // Also allow when the mount path itself is /subscription (express strips mount).
    if (String(req.baseUrl || '').endsWith('/subscription') || String(req.originalUrl || '').includes('/subscription')) return next();
    if (String(req.originalUrl || '').includes('/support')) return next();

    const lib = await refreshSubscriptionStatus(req.tenantId);
    const access = accessFor(lib, { role: req.user?.role });
    if (access.ok) return next();
    return res.status(402).json({ error: access.message, code: access.code, status: access.status });
  })()).catch(next);
}

/** Normalize free-text plan features into keys. Empty list = all features allowed. */
export function featureKeys(features = []) {
  return (features || []).map(f => String(f).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')).filter(Boolean);
}

export function planHasFeature(plan, feature) {
  if (!plan) return true; // no plan → no feature restrictions
  const keys = featureKeys(plan.features);
  if (!keys.length) return true; // blank features = everything included
  const want = String(feature).toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return keys.some(k => k === want || k.includes(want) || want.includes(k));
}

export async function hasFeature(tenantId, feature) {
  const lib = await Library.findOne({ libraryId: tenantId }).lean();
  if (!lib?.planId) return true;
  const plan = await SoftwarePlan.findOne({ planId: lib.planId }).lean();
  return planHasFeature(plan, feature);
}

export function requireFeature(feature) {
  return (req, res, next) => {
    Promise.resolve((async () => {
      if (req.user?.role === 'superadmin') return next();
      if (!req.tenantId) return next();
      if (await hasFeature(req.tenantId, feature)) return next();
      return res.status(403).json({
        error: `Your plan does not include ${feature}. Upgrade to use this feature.`,
        code: 'feature_not_in_plan',
        feature,
      });
    })()).catch(next);
  };
}

export { libraryLimits };

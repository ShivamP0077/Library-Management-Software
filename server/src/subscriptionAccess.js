// Issue #14: subscription access + plan feature gates.
// Libraries with no subscription keep working (existing installs). Only libraries that
// have a subscription record are locked when unpaid / trial ended / cancelled / expired.
import { Library } from './models.js';
import { SoftwarePlan, libraryLimits } from './plans.js';

const LOCKED = new Set(['pending_payment', 'awaiting_payment', 'expired', 'cancelled', 'past_due']);
const OPEN = new Set(['active', 'trialing']);

export const LOCKED_MESSAGE = 'Your My Library OS plan has expired. Renew to continue.';
export const LOCKED_SECTIONS = ['dashboard', 'settings', 'profile'];

/**
 * Routes a locked library may still call. Everything else (students, payments,
 * seats, reports, expenses, WhatsApp, staff) is rejected for reads and writes.
 * Paths are without the /api prefix. `prefix` matches that path and its children.
 */
export const LOCKED_ROUTE_ALLOWLIST = [
  { methods: '*', prefix: '/auth' },
  { methods: '*', prefix: '/subscription' },
  { methods: '*', prefix: '/software-plan' },
  { methods: '*', prefix: '/account' },
  { methods: '*', prefix: '/support' },
  { methods: '*', prefix: '/help' },
  { methods: '*', prefix: '/contact' },
  { methods: '*', prefix: '/billing' },
  { methods: '*', prefix: '/invoices' },
  { methods: '*', prefix: '/wallet' },
  { methods: '*', prefix: '/referrals' },
  { methods: '*', prefix: '/checkout' },
  { methods: '*', prefix: '/public/enquiry' },
  { methods: ['GET', 'HEAD', 'OPTIONS'], prefix: '/notifications' },
  { methods: ['GET', 'HEAD', 'OPTIONS'], prefix: '/dashboard' },
  { methods: ['GET', 'HEAD', 'OPTIONS', 'PUT'], exact: '/settings' },
  // Library configuration. The seat map, students, staff and money stay locked.
  { methods: '*', prefix: '/branches' },
  { methods: '*', prefix: '/sections' },
  { methods: '*', prefix: '/shifts' },
  { methods: '*', prefix: '/seatTypes' },
  { methods: '*', prefix: '/plans' },
];

export const isAwaitingPayment = (status) => status === 'pending_payment' || status === 'awaiting_payment';

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
  if (role === 'superadmin') return { ok: true, locked: false, status: null, code: null };
  if (!lib?.subscription) return { ok: true, locked: false, status: null, code: null };
  const status = effectiveStatus(lib.subscription, now);
  if (OPEN.has(status)) return { ok: true, locked: false, status, code: null };
  if (LOCKED.has(status)) {
    const messages = {
      pending_payment: 'Complete payment to unlock your library.',
      expired: 'Your plan or free trial has ended. Renew to continue.',
      cancelled: 'Your subscription was cancelled. Choose a plan to continue.',
      past_due: 'Your last payment failed. Update billing to continue.',
    };
    return { ok: false, locked: true, status, code: 'SUBSCRIPTION_LOCKED', message: LOCKED_MESSAGE, detail: messages[status] || null };
  }
  return { ok: true, locked: false, status, code: null };
}

/** Shape returned by /auth/me and login so the app can render the locked shell. */
export function toClientAccess(access) {
  if (!access || access.ok) {
    return {
      ok: true,
      locked: false,
      status: access?.status || null,
      code: null,
      message: null,
      allowedSections: null,
    };
  }
  return {
    ok: false,
    locked: true,
    status: access.status || null,
    code: 'SUBSCRIPTION_LOCKED',
    message: LOCKED_MESSAGE,
    allowedSections: LOCKED_SECTIONS,
  };
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

/** Normalise a URL or req.path to the app path without /api and without a query. */
export function normaliseRoutePath(path = '') {
  let p = String(path || '').split('?')[0];
  if (p.startsWith('/api/')) p = p.slice(4);
  else if (p === '/api') p = '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function ruleMatches(path, rule) {
  if (rule.exact) return path === rule.exact;
  if (rule.prefix) return path === rule.prefix || path.startsWith(`${rule.prefix}/`);
  return false;
}

/** Pure check used by the lock middleware and by tests. */
export function isRouteAllowedWhenLocked(method, path) {
  const m = String(method || 'GET').toUpperCase();
  const p = normaliseRoutePath(path);
  return LOCKED_ROUTE_ALLOWLIST.some(rule => {
    const methods = rule.methods === '*' ? null : rule.methods;
    if (methods && !methods.includes(m)) return false;
    return ruleMatches(p, rule);
  });
}

/** @deprecated use isRouteAllowedWhenLocked(method, path) */
export function pathAllowedWhenLocked(path = '') {
  return isRouteAllowedWhenLocked('GET', path);
}

/**
 * After tenantScope: when the library subscription is locked, only the allowlist
 * is reachable. Reads and writes outside it return 402. Super Admin is never locked.
 */
export function requireActiveSubscription(req, res, next) {
  Promise.resolve((async () => {
    if (req.user?.role === 'superadmin') return next();
    if (!req.tenantId) return next();
    const path = req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`;
    if (isRouteAllowedWhenLocked(req.method, path)) return next();

    const lib = await refreshSubscriptionStatus(req.tenantId);
    const access = accessFor(lib, { role: req.user?.role });
    if (access.ok) return next();
    return res.status(402).json({
      error: 'subscription_locked',
      code: 'SUBSCRIPTION_LOCKED',
      message: LOCKED_MESSAGE,
    });
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

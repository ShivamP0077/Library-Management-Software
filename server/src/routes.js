import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { COLLECTIONS, models, Settings, StudentDocument, Library, User, keyOf, clean, isPlatformRole } from './models.js';
import { signToken, requireAuth, requireRole, tenantScope } from './auth.js';
import { createLibrary, createUser, computeMetrics, hashPassword, validatePassword } from './services.js';
import { verifyGoogleIdToken, googleEnabled, googleConfig, buildAuthUrl, exchangeCode } from './google.js';
import { createWhatsappRouter, createWhatsappWebhookRouter } from './whatsapp.js';
import { createFinanceRouter, validatePaymentBatch, normalizeStudentPaymentDates, applyPaidOn } from './finance.js';
import { createStudentRouter, recordStudentDiff, recordArchiveDiff, checkCapacity } from './students.js';
import { audit, AuditLog } from './audit.js';
import { enforceAmountEdits, amountSettingsChanged, isOwnerRole } from './amountPermission.js';
import { createNotificationRouter } from './notifications.js';
import { createInsightsRouter } from './insights.js';
import { createSupportRouter, createSupportAdminRouter } from './support.js';
import { createPartnerAdminRouter, createPartnerPortalRouter } from './partners.js';
import { createTemplateRouter } from './templates.js';
import { createReminderRouter, autoSendReceipts, receiptsForNewStudents } from './reminders.js';

// Auto-receipts never block or fail the save; in tests we await so results are observable.
const sendReceiptsAfterSave = async (tenantId, payments, newStudentKeys) => {
  const p = (newStudentKeys ? receiptsForNewStudents(tenantId, newStudentKeys) : autoSendReceipts(tenantId, payments)).catch(e => console.error('[receipts]', e.message));
  if (process.env.NODE_ENV === 'test') await p;
};
import { deleteLibraryData, ensureDeletionJob, startDeletionAttempt, completeDeletionJob, failDeletionJob, recordDeletionProof } from './deleteLibrary.js';
import { retentionDeadline } from './documentRetention.js';
import { confirmNameMatches } from './confirmName.js';
import { createSignupRouter, createGoogleSignupPending, signupEnabled } from './signup.js';
import { createProfileRouter } from './profile.js';
import { createSoftwarePlanRouter, createSoftwarePlanAdminRouter } from './softwarePlan.js';
import { throttleHit, clearThrottle } from './throttle.js';
import { normalizeEmail, normalizeMobile, EMAIL_RE } from './identity.js';
import { createSubscriptionRouter } from './subscription.js';
import { requireActiveSubscription, requireFeature, refreshSubscriptionStatus, accessFor, toClientAccess } from './subscriptionAccess.js';
import { createPublicEnquiryRouter, createTenantEnquiryRouter } from './enquiry.js';
import { createPlanAdminRouter, SoftwarePlan, checkBranchLimit, checkStaffLimit } from './plans.js';
import { createPaymentsAdminRouter } from './paymentsAdmin.js';
import { createBillingAdminRouter } from './billingConfig.js';
import { refreshPaymentProvider } from './paymentConfig.js';
import { DeletionJob } from './deletionJob.js';
import { createPublicAccountRouter, createTenantAccountRouter, auditSuperadminAccess, acceptInvite } from './accounts.js';
import { createSeatRouter, reconcileStudents, releaseForStudents, validateSeatSync, SeatAllocation, seatMatchesAllocation, SeatConflictError } from './seats.js';

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Tenant identity is stripped from all client input: it always comes from req.tenantId.
// Writes also mirror it into the legacy libraryId field (rollback + legacy indexes).
const stripMeta = (body) => { const o = { ...(body || {}) }; for (const f of ['_id', '_key', '_order', '__v', 'createdAt', 'updatedAt', 'tenantId', 'libraryId']) delete o[f]; return o; };

const tenantOfUser = (user) => user.tenantId || user.libraryId || null;

// ---------------------------------------------------------------- Health
export const healthHandler = wrap(async (req, res) => {
  const state = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
  let ping = false;
  if (state === 'connected') { await mongoose.connection.db.admin().ping(); ping = true; }
  const collections = ping ? (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).sort() : [];
  // Root /health is a liveness probe (always 200, reports DB state); /api/health is readiness (503 when DB is down)
  const liveness = req.baseUrl !== '/api';
  res.status(ping || liveness ? 200 : 503).json({ ok: ping, db: { state, name: mongoose.connection.name, collections }, googleAuth: googleEnabled() });
});
router.get('/health', healthHandler);

// ---------------------------------------------------------------- Auth
async function resolveSession(user) {
  if (user.status !== 'Active') {
    return { denial: { status: 403, code: 'account_disabled', message: 'Account is disabled' } };
  }
  let library = null;
  if (!isPlatformRole(user.role)) {
    library = await Library.findOne({ libraryId: tenantOfUser(user) }).lean();
    if (!library || library.status !== 'Active') {
      return { denial: { status: 403, code: 'library_disabled', message: 'Library is disabled' } };
    }
  }
  return { library };
}

async function issueSession(user, res) {
  const { library, denial } = await resolveSession(user);
  if (denial) return res.status(denial.status).json({ error: denial.message });
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  const access = library ? accessFor(library, { role: user.role }) : { ok: true, status: null };
  const subscriptionAccess = toClientAccess(access);
  res.json({
    token: signToken(user),
    user: user.toSafeJSON(),
    library: library && { libraryId: library.libraryId, name: library.name, status: library.status },
    subscriptionAccess,
  });
}

// ---------------------------------------------------------------- Server-side Google OAuth
const GOOGLE_COOKIE = 'lms_g_oauth';
const GOOGLE_COOKIE_PATH = '/api/auth/google';
const googleCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: GOOGLE_COOKIE_PATH,
});

const googleNoStore = (res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
};

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const name = part.slice(0, i).trim();
    if (!name) return;
    let value = part.slice(i + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* keep the raw value */ }
    out[name] = value;
  });
  return out;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

router.get('/auth/google/start', (req, res) => {
  googleNoStore(res);
  const { frontendUrl } = googleConfig();
  if (!googleEnabled()) {
    if (!frontendUrl) return res.status(501).json({ error: 'Google sign-in is not configured' });
    return res.redirect(302, `${frontendUrl}/#google_error=not_configured`);
  }

  const state = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  // Issue #13: invite token may ride along. Issue #15: signup=1 starts Google owner signup.
  const invite = typeof req.query.invite === 'string' && /^[A-Za-z0-9_-]{16,200}$/.test(req.query.invite) ? req.query.invite : undefined;
  const signup = req.query.signup === '1' || req.query.signup === 'true';
  const cookieValue = Buffer.from(JSON.stringify({
    s: state, v: codeVerifier,
    ...(invite ? { i: invite } : {}),
    ...(signup ? { su: 1 } : {}),
  }), 'utf8').toString('base64url');

  res.cookie(GOOGLE_COOKIE, cookieValue, { ...googleCookieOptions(), maxAge: 600 * 1000 });
  return res.redirect(302, buildAuthUrl({ state, codeChallenge }));
});

router.get('/auth/google/callback', wrap(async (req, res) => {
  googleNoStore(res);
  const { frontendUrl } = googleConfig();
  const fail = (code) => res.redirect(302, `${frontendUrl}/#google_error=${code}`);

  // Always clear the short-lived state/PKCE cookie, even on malformed requests.
  const rawCookie = parseCookies(req.headers.cookie)[GOOGLE_COOKIE];
  res.clearCookie(GOOGLE_COOKIE, googleCookieOptions());

  if (!frontendUrl) return res.status(501).json({ error: 'Google sign-in is not configured' });

  try {
    if (req.query.error) return fail('access_denied');

    let cookieData = null;
    try {
      if (rawCookie) cookieData = JSON.parse(Buffer.from(rawCookie, 'base64url').toString('utf8'));
    } catch { cookieData = null; }

    const state = String(req.query.state || '');
    if (!cookieData?.s || !cookieData?.v || !state || !safeEqual(cookieData.s, state)) return fail('invalid_state');
    if (!req.query.code) return fail('invalid_request');

    let identity;
    try {
      identity = await exchangeCode({ code: String(req.query.code), codeVerifier: String(cookieData.v) });
    } catch (err) {
      if (err?.code === 'email_unverified') return fail('email_unverified');
      throw err;
    }

    let user = await User.findOne({ email: identity.email });
    if (!user && cookieData.i) {
      // Only a valid invite for this exact email creates the account (never self-signup).
      const r = await acceptInvite({ token: String(cookieData.i), google: identity, ip: req.ip });
      if (r.error) return fail(r.code);
      user = r.user;
    }
    // Issue #15: Google owner signup — park identity and let the frontend finish plan + library.
    if (!user && cookieData.su && signupEnabled()) {
      const pending = await createGoogleSignupPending(identity);
      return res.redirect(302, `${frontendUrl}/#google_signup=${encodeURIComponent(pending)}`);
    }
    if (!user) return fail('not_registered'); // Google identity never creates users or grants roles outside signup
    if (user.googleSub && user.googleSub !== identity.sub) return fail('account_mismatch');

    const { denial } = await resolveSession(user);
    if (denial) return fail(denial.code);

    if (!user.googleSub) user.googleSub = identity.sub;
    if (!Array.isArray(user.authProviders)) user.authProviders = [];
    if (!user.authProviders.includes('google')) user.authProviders = [...user.authProviders, 'google'];
    if (!user.name && identity.name) user.name = identity.name;
    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken(user);
    return res.redirect(302, `${frontendUrl}/#google_token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('[auth] google callback failed:', err?.code || 'error');
    return fail('google_failed');
  }
}));

router.get('/auth/config', (_req, res) => res.json({ googleEnabled: googleEnabled(), passwordLogin: true }));

// Optional fallback for seeded / password-enabled accounts
router.post('/auth/login', wrap(async (req, res) => {
  const { password } = req.body || {};
  const identifier = String(req.body?.identifier || req.body?.email || req.body?.mobile || '').trim();
  if (!identifier || !password) return res.status(400).json({ error: 'Enter your email or mobile number and password' });
  if (await throttleHit(`login:${identifier.toLowerCase()}`, 8, 15 * 60e3)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  }
  let user;
  if (identifier.includes('@')) {
    const email = normalizeEmail(identifier);
    user = EMAIL_RE.test(email) ? await User.findOne({ email }).select('+passwordHash') : null;
  } else {
    user = await User.findOne({ mobile: normalizeMobile(identifier) }).select('+passwordHash');
  }
  if (!user || !user.passwordHash || !(await bcrypt.compare(String(password), user.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' });
  await clearThrottle(`login:${identifier.toLowerCase()}`);
  return issueSession(user, res);
}));

// Google Identity Services: verify ID token, map verified email to a pre-provisioned user. No self-signup.
router.post('/auth/google', wrap(async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'credential (Google ID token) is required' });
  const g = await verifyGoogleIdToken(credential);
  const user = await User.findOne({ email: g.email });
  if (!user) return res.status(403).json({ error: 'This Google account is not registered. Ask your administrator to add your email.' });
  if (user.googleSub && user.googleSub !== g.sub) return res.status(401).json({ error: 'Google account mismatch' });
  if (!user.googleSub) { user.googleSub = g.sub; if (!user.name && g.name) user.name = g.name; await user.save(); }
  return issueSession(user, res);
}));

router.use(createPublicAccountRouter({ issueSession }));
router.use(createSignupRouter({ issueSession })); // Issue #15 (off unless OWNER_SIGNUP_ENABLED=true)
router.use(createPublicEnquiryRouter()); // public QR form; still accepts enquiries when the plan is locked

// Evolution delivery webhook: no login, verified by a per-instance HMAC token.
router.use('/whatsapp', createWhatsappWebhookRouter());

router.use(requireAuth);

router.get('/auth/me', wrap(async (req, res) => {
  const user = await User.findById(req.user.id);
  const tenantId = tenantOfUser(user);
  let library = tenantId ? await refreshSubscriptionStatus(tenantId) : null;
  if (!library && tenantId) library = await Library.findOne({ libraryId: tenantId }).lean();
  const access = accessFor(library, { role: user.role });
  res.json({
    user: user.toSafeJSON(),
    library: library && { libraryId: library.libraryId, name: library.name, status: library.status, planId: library.planId || null, subscription: library.subscription || null },
    subscriptionAccess: toClientAccess(access),
  });
}));

const pwTries = new Map();
router.post('/auth/change-password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!validatePassword(newPassword)) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  // Issue #15: slow down guessing of the current password (5 wrong tries per 15 minutes).
  const key = String(user._id); const now = Date.now();
  const tries = (pwTries.get(key) || []).filter(t => now - t < 15 * 60 * 1000);
  if (tries.length >= 5) return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
  if (user.passwordHash && !(await bcrypt.compare(String(currentPassword || ''), user.passwordHash))) {
    pwTries.set(key, [...tries, now]);
    return res.status(400).json({ error: 'Current password is incorrect' }); // 400, not 401: a 401 signs the user out in the app
  }
  pwTries.delete(key);
  if (user.passwordHash && await bcrypt.compare(String(newPassword), user.passwordHash)) return res.status(400).json({ error: 'New password must be different from the current one' });
  user.passwordHash = await hashPassword(newPassword);
  user.authProviders = [...new Set([...(user.authProviders || []), 'password'])];
  await user.save();
  await audit(req, 'password.changed', { tenantId: user.tenantId || null });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Super admin
const admin = express.Router();
admin.use(requireRole('superadmin'));

admin.use(createInsightsRouter());
admin.use(createPartnerAdminRouter());
admin.use(createSupportAdminRouter());
admin.use(createPlanAdminRouter());
admin.use(createPaymentsAdminRouter()); // Issue #19
admin.use(createBillingAdminRouter()); // Issue #19 explicit tax/currency policy
admin.use(createSoftwarePlanAdminRouter()); // Issue #19 offers + referral campaigns

admin.get('/libraries', wrap(async (_req, res) => {
  const libs = await Library.find().sort({ createdAt: 1 }).lean();
  const { perLibrary } = await computeMetrics(libs.map(l => l.libraryId));
  const admins = await User.find({ role: 'client_admin' }).lean();
  const m = Object.fromEntries(perLibrary.map(x => [x.libraryId, x]));
  res.json(libs.map(l => ({
    libraryId: l.libraryId, name: l.name, status: l.status, contactEmail: l.contactEmail, createdAt: l.createdAt, planId: l.planId || null, studentLimit: l.studentLimit || null,
    billing: l.subscription || null, deletionRequest: l.deletionRequest || null,
    admins: admins.filter(a => tenantOfUser(a) === l.libraryId).map(a => ({ id: String(a._id), email: a.email, name: a.name, status: a.status })),
    metrics: m[l.libraryId],
  })));
}));

admin.post('/libraries', wrap(async (req, res) => {
  const { name, libraryId, contactEmail, adminEmail, adminName, adminPassword, generatePassword } = req.body || {};
  const r = await createLibrary({ name, libraryId, contactEmail, createdBy: req.user.email,
    admin: adminEmail ? { email: adminEmail, name: adminName, password: adminPassword, generatePassword } : null });
  res.status(201).json({
    library: { libraryId: r.library.libraryId, name: r.library.name, status: r.library.status },
    admin: r.adminUser?.toSafeJSON() || null,
    generatedPassword: r.generatedPassword || undefined, // shown once, never stored in plain text
  });
}));

admin.patch('/libraries/:libraryId', wrap(async (req, res) => {
  const set = {};
  if (req.body?.name) set.name = String(req.body.name).trim();
  if (req.body?.status) { if (!['Active', 'Disabled'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' }); set.status = req.body.status; }
  if (req.body?.contactEmail !== undefined) set.contactEmail = req.body.contactEmail;
  if (req.body?.city !== undefined) set.city = req.body.city ? String(req.body.city).trim().slice(0, 80) : null;
  if (req.body?.studentLimit !== undefined) { const n = req.body.studentLimit === null ? null : Number(req.body.studentLimit); if (n !== null && !(n >= 0)) return res.status(400).json({ error: 'Invalid studentLimit' }); set.studentLimit = n || null; }
  if (req.body?.planId !== undefined) {
    if (req.body.planId && !(await SoftwarePlan.exists({ planId: req.body.planId }))) return res.status(400).json({ error: 'Unknown plan' });
    set.planId = req.body.planId || null;
  }
  await audit(req, 'library.update', { tenantId: req.params.libraryId, target: req.params.libraryId, detail: set });
  const lib = await Library.findOneAndUpdate({ libraryId: req.params.libraryId }, { $set: set }, { new: true, lean: true });
  lib ? res.json({ libraryId: lib.libraryId, name: lib.name, status: lib.status }) : res.status(404).json({ error: 'Library not found' });
}));

// Issue #16: permanent delete. The exact library name must be typed back; only that tenant's data is removed.
admin.delete('/libraries/:libraryId', wrap(async (req, res) => {
  const libraryId = req.params.libraryId;
  const lib = await Library.findOne({ libraryId }).lean();
  let job = await DeletionJob.findOne({ libraryId });

  if (!lib) {
    // Idempotent retry after success, or resume a job that was interrupted after
    // the Library row was removed. The immutable job name is the confirmation.
    if (!job) {
      const prior = await AuditLog.findOne({ action: 'library.deleted', target: libraryId }).sort({ at: -1 }).lean();
      if (!prior) return res.status(404).json({ error: 'Library not found' });
      const priorName = prior.detail?.name || null;
      if (priorName && !confirmNameMatches(req.body?.confirmName, priorName)) {
        return res.status(400).json({ error: `The name you typed does not match "${priorName}". Nothing was deleted.`, code: 'confirm_mismatch' });
      }
      return res.json({ ok: true, libraryId, alreadyDeleted: true, counts: prior.detail?.counts || {}, whatsapp: prior.detail?.whatsapp || 'skipped', retention: prior.detail?.retention || null });
    }
    if (!confirmNameMatches(req.body?.confirmName, job.targetName)) {
      return res.status(400).json({ error: `The name you typed does not match "${job.targetName}". Nothing was deleted.`, code: 'confirm_mismatch' });
    }
    if (job.status === 'completed') {
      return res.json({ ok: true, libraryId, alreadyDeleted: true, counts: job.counts || {}, whatsapp: job.whatsapp || 'skipped', retention: job.retention || null, deletedAt: job.completedAt });
    }
    job = await startDeletionAttempt(libraryId);
    try {
      const r = await deleteLibraryData(libraryId, { evolution: req.app.locals.evolutionClient });
      await recordDeletionProof(libraryId, job.targetName, r, req);
      const done = await completeDeletionJob(libraryId, r);
      return res.json({ ok: true, libraryId, resumed: true, counts: done?.counts || r.counts, whatsapp: r.whatsapp, retention: r.retention, deletedAt: r.deletedAt });
    } catch (e) {
      await failDeletionJob(libraryId, e);
      throw e;
    }
  }

  // A failed attempt may be retried after the owner renames the library. Once the
  // Library row is gone the job name is immutable and is the only confirmation.
  if (job && job.status === 'failed' && job.targetName !== lib.name) {
    await DeletionJob.deleteOne({ _id: job._id });
    job = null;
  }
  const expectedName = job?.targetName || lib.name;
  if (!confirmNameMatches(req.body?.confirmName, expectedName)) {
    return res.status(400).json({ error: `The name you typed does not match "${expectedName}". Nothing was deleted.`, code: 'confirm_mismatch' });
  }
  job = job || await ensureDeletionJob(libraryId, lib.name);
  job = await startDeletionAttempt(libraryId);
  try {
    const r = await deleteLibraryData(libraryId, { evolution: req.app.locals.evolutionClient });
    await recordDeletionProof(libraryId, job.targetName, r, req);
    const done = await completeDeletionJob(libraryId, r);
    res.json({ ok: true, libraryId, counts: done?.counts || r.counts, whatsapp: r.whatsapp, retention: r.retention, deletedAt: r.deletedAt });
  } catch (e) {
    await failDeletionJob(libraryId, e);
    throw e;
  }
}));

admin.get('/metrics', wrap(async (_req, res) => {
  const libs = await Library.find().lean();
  const { perLibrary, totals } = await computeMetrics(libs.map(l => l.libraryId));
  const names = Object.fromEntries(libs.map(l => [l.libraryId, { name: l.name, status: l.status }]));
  res.json({ totals, perLibrary: perLibrary.map(p => ({ ...p, ...names[p.libraryId] })) });
}));

admin.get('/libraries/:libraryId/users', wrap(async (req, res) => {
  res.json((await User.find({ tenantId: req.params.libraryId })).map(u => u.toSafeJSON()));
}));

// Pre-provision a client admin (or staff) by email; Google sign-in then works for them.
admin.post('/libraries/:libraryId/users', wrap(async (req, res) => {
  if (!(await Library.exists({ libraryId: req.params.libraryId }))) return res.status(404).json({ error: 'Library not found' });
  const role = req.body?.role === 'staff' ? 'staff' : 'client_admin';
  const r = await createUser({ ...req.body, role, tenantId: req.params.libraryId, libraryId: req.params.libraryId });
  res.status(201).json({ user: r.user.toSafeJSON(), generatedPassword: r.generatedPassword || undefined });
}));

admin.patch('/users/:id', wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body?.status) user.status = req.body.status === 'Disabled' ? 'Disabled' : 'Active';
  if (req.body?.name !== undefined) user.name = req.body.name;
  if (req.body?.password) {
    if (!validatePassword(req.body.password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    user.passwordHash = await hashPassword(req.body.password);
    user.authProviders = [...new Set([...(user.authProviders || []), 'password'])];
  }
  await user.save();
  await audit(req, req.body?.password ? 'superadmin.password_set' : 'superadmin.user_update', { tenantId: user.tenantId || null, target: user.email, detail: { status: req.body?.status } });
  res.json(user.toSafeJSON());
}));

admin.get('/audit-logs', wrap(async (req, res) => {
  const { AuditLog, pubAudit } = await import('./audit.js');
  const q = {}; if (req.query.libraryId) q.tenantId = String(req.query.libraryId); if (req.query.action) q.action = String(req.query.action);
  res.json((await AuditLog.find(q).sort({ at: -1 }).limit(Math.min(Number(req.query.limit || 200), 1000)).lean()).map(pubAudit));
}));

router.use('/admin', admin);
router.use('/partner', createPartnerPortalRouter());

// ---------------------------------------------------------------- Tenant data (scoped)
const tenant = express.Router();
tenant.use(tenantScope);
tenant.use(auditSuperadminAccess);
tenant.use(requireActiveSubscription); // Issue #14: lock writes when unpaid / trial ended / cancelled
tenant.use(createTenantAccountRouter());
tenant.use('/account', createProfileRouter()); // Issue #15 My Profile
tenant.use('/software-plan', createSoftwarePlanRouter()); // Issue #19 My Software Plan

// Client admins manage login accounts for their own library (staff / co-admins)
tenant.get('/users', requireRole('client_admin', 'superadmin'), wrap(async (req, res) => {
  res.json((await User.find({ tenantId: req.tenantId })).map(u => u.toSafeJSON()));
}));
tenant.post('/users', requireRole('client_admin', 'superadmin'), wrap(async (req, res) => {
  const role = req.body?.role === 'client_admin' ? 'client_admin' : 'staff';
  if (role === 'staff') await checkStaffLimit(req.tenantId); // Issue #14: all user-creation endpoints
  const r = await createUser({ ...req.body, role, tenantId: req.tenantId, libraryId: req.tenantId });
  await audit(req, 'user.create', { target: r.user.email, detail: { role } });
  res.status(201).json({ user: r.user.toSafeJSON(), generatedPassword: r.generatedPassword || undefined });
}));
tenant.patch('/users/:id', requireRole('client_admin', 'superadmin'), wrap(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body?.status) user.status = req.body.status === 'Disabled' ? 'Disabled' : 'Active';
  if (req.body?.name !== undefined) user.name = req.body.name;
  if (req.body?.staffId !== undefined) user.staffId = req.body.staffId;
  await user.save();
  await audit(req, 'user.update', { target: user.email, detail: { status: req.body?.status, staffId: req.body?.staffId } });
  res.json(user.toSafeJSON());
}));

// Full snapshot of this library (frontend loads this on start)
tenant.get('/state', wrap(async (req, res) => {
  const out = {};
  await Promise.all(Object.keys(COLLECTIONS).map(async col => {
    out[col] = (await models[col].find({ tenantId: req.tenantId }).sort({ _order: 1, createdAt: 1 }).lean()).map(clean);
  }));
  const s = await Settings.findOne({ tenantId: req.tenantId }).lean();
  out.settings = s && Object.keys(clean(s)).length > 1 ? clean(s) : null;
  out.libraryId = req.tenantId; // public API shape: tenant id is still exposed as libraryId
  out.readOnly = req.readOnly;
  res.json(out);
}));

tenant.get('/dashboard', wrap(async (req, res) => {
  const [students, seats, payments] = await Promise.all([
    models.students.countDocuments({ tenantId: req.tenantId }),
    models.seats.countDocuments({ tenantId: req.tenantId }),
    models.payments.countDocuments({ tenantId: req.tenantId }),
  ]);
  res.json({ students, seats, payments });
}));

tenant.get('/settings', wrap(async (req, res) => {
  const s = await Settings.findOne({ tenantId: req.tenantId }).lean();
  res.json(s ? clean(s) : null);
}));
tenant.put('/settings', requireRole('client_admin', 'superadmin', 'staff'), wrap(async (req, res) => {
  const before = await Settings.findOne({ tenantId: req.tenantId }).lean();
  if (amountSettingsChanged(before || {}, req.body || {})) {
    if (!isOwnerRole(req.user)) return res.status(403).json({ error: 'Only the owner can change who may edit payment amounts.', code: 'owner_only' });
    await audit(req, 'settings.amount_edit_permission', { tenantId: req.tenantId, detail: { managerCanEditAmount: req.body?.managerCanEditAmount ?? null, staffCanEditAmount: req.body?.staffCanEditAmount ?? null } });
  }
  const s = await Settings.findOneAndReplace({ tenantId: req.tenantId }, { ...stripMeta(req.body), tenantId: req.tenantId, libraryId: req.tenantId }, { upsert: true, new: true, lean: true });
  res.json(clean(s));
}));

const RETENTION_DAYS = 30;
const DOC_META_FIELDS = ['studentId', 'docTypeId', 'fileName', 'fileType', 'fileSize', 'status'];
const docMeta = (body) => {
  const out = {};
  for (const f of DOC_META_FIELDS) if (body?.[f] !== undefined) out[f] = body[f];
  if (out.fileName) out.fileName = String(out.fileName).slice(0, 160);
  if (out.fileType) out.fileType = String(out.fileType).slice(0, 80);
  if (out.fileSize !== undefined) out.fileSize = Number(out.fileSize) || null;
  if (out.uploadedAt) out.uploadedAt = new Date(out.uploadedAt);
  return out;
};

tenant.get('/documents/:key', wrap(async (req, res) => {
  const d = await StudentDocument.findOne({ tenantId: req.tenantId, storageKey: req.params.key, retiredAt: null }).lean();
  d ? res.json({ storageKey: d.storageKey, data: d.data, studentId: d.studentId || null, fileName: d.fileName || null, fileType: d.fileType || null }) : res.status(404).json({ error: 'Not found' });
}));
// Attach/claim an existing upload to a student after admission (metadata only, never replaces data).
tenant.patch('/documents/:key', wrap(async (req, res) => {
  const meta = docMeta(req.body);
  if (!Object.keys(meta).length) return res.status(400).json({ error: 'No document metadata supplied' });
  if (meta.studentId && !(await models.students.exists({ tenantId: req.tenantId, _key: String(meta.studentId) }))) return res.status(400).json({ error: 'Unknown student for this library' });
  const d = await StudentDocument.findOneAndUpdate(
    { tenantId: req.tenantId, storageKey: req.params.key, retiredAt: null },
    { $set: { ...meta, updatedBy: req.user?.email || null } },
    { new: true, lean: true },
  );
  d ? res.json({ ok: true }) : res.status(404).json({ error: 'Document not found' });
}));
// Student-scoped fetch: a caller may only read a file attached to that same student.
tenant.get('/students/:studentId/documents/:key', wrap(async (req, res) => {
  const student = await models.students.findOne({ tenantId: req.tenantId, _key: String(req.params.studentId) }).lean();
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const d = await StudentDocument.findOne({ tenantId: req.tenantId, storageKey: req.params.key, retiredAt: null }).lean();
  if (!d || (d.studentId && String(d.studentId) !== String(req.params.studentId))) return res.status(404).json({ error: 'Not found' });
  res.json({ storageKey: d.storageKey, data: d.data, fileName: d.fileName || null, fileType: d.fileType || null });
}));
tenant.put('/documents/:key', wrap(async (req, res) => {
  if (!req.body?.data) return res.status(400).json({ error: 'data is required' });
  if (String(req.body.data).length > 12 * 1024 * 1024) return res.status(413).json({ error: 'File is too large' });
  const meta = docMeta(req.body);
  if (meta.studentId && !(await models.students.exists({ tenantId: req.tenantId, _key: String(meta.studentId) }))) return res.status(400).json({ error: 'Unknown student for this library' });
  await StudentDocument.updateOne(
    { tenantId: req.tenantId, storageKey: req.params.key },
    { $set: { data: req.body.data, libraryId: req.tenantId, ...meta, uploadedAt: new Date(), createdBy: req.user?.email || null, retiredAt: null, purgeAfter: null } },
    { upsert: true },
  );
  res.json({ ok: true });
}));
// Issue #3: retire for 30 days instead of destroying on the first click; the purge job removes it later.
tenant.delete('/documents/:key', wrap(async (req, res) => {
  const now = new Date();
  const purgeAfter = retentionDeadline(now, RETENTION_DAYS);
  const r = await StudentDocument.updateOne(
    { tenantId: req.tenantId, storageKey: req.params.key, retiredAt: null },
    { $set: { retiredAt: now, purgeAfter } },
  );
  await audit(req, 'document.retired', { target: req.params.key, detail: { retentionDays: RETENTION_DAYS, matched: r.matchedCount } });
  res.json({ ok: true, retainedUntil: purgeAfter.toISOString(), retentionDays: RETENTION_DAYS });
}));

tenant.use(createSubscriptionRouter());
tenant.use(createTenantEnquiryRouter());
tenant.use(createSeatRouter());
tenant.use(createFinanceRouter());
tenant.use(createStudentRouter());
tenant.use(createNotificationRouter());
tenant.use(createReminderRouter());
tenant.use(createTemplateRouter());
tenant.use(createSupportRouter());

// Generic REST for each entity collection, always filtered by req.tenantId
const colParam = (req, res, next) => {
  if (!COLLECTIONS[req.params.col]) return res.status(404).json({ error: `Unknown collection "${req.params.col}"` });
  req.Model = models[req.params.col];
  next();
};

tenant.get('/:col', colParam, wrap(async (req, res) => {
  const filter = { tenantId: req.tenantId };
  for (const f of ['branchId', 'status', 'studentId']) if (req.query[f]) filter[f] = String(req.query[f]);
  res.json((await req.Model.find(filter).sort({ _order: 1, createdAt: 1 }).lean()).map(clean));
}));

tenant.get('/:col/:key', colParam, wrap(async (req, res) => {
  const d = await req.Model.findOne({ tenantId: req.tenantId, _key: req.params.key }).lean();
  d ? res.json(clean(d)) : res.status(404).json({ error: 'Not found' });
}));

tenant.post('/:col', colParam, wrap(async (req, res) => {
  const body = stripMeta(req.body);
  const _key = keyOf(req.params.col, body);
  if (!_key) return res.status(400).json({ error: `Missing key field (${COLLECTIONS[req.params.col].keys.join(' or ')})` });
  if (await req.Model.exists({ tenantId: req.tenantId, _key })) return res.status(409).json({ error: 'Already exists' });
  if (req.params.col === 'students') {
    const n = await req.Model.countDocuments({ tenantId: req.tenantId });
    await checkCapacity(req.tenantId, n + 1, n);
    normalizeStudentPaymentDates(body, null);
    await reconcileStudents(req.tenantId, [body], { actor: req.user.email });
  }
  if (req.params.col === 'payments') { validatePaymentBatch([body]); await enforceAmountEdits(req, [body]); }
  if (req.params.col === 'branches') { const n = await req.Model.countDocuments({ tenantId: req.tenantId }); await checkBranchLimit(req.tenantId, n + 1, n); }
  const d = await req.Model.create({ ...body, _key, tenantId: req.tenantId, libraryId: req.tenantId });
  if (req.params.col === 'students') await recordStudentDiff(req.tenantId, new Map(), [{ ...body, id: _key }], req.user.email);
  if (req.params.col === 'payments') await sendReceiptsAfterSave(req.tenantId, [{ ...body, _key }]);
  res.status(201).json(clean(d));
}));

tenant.put('/:col/:key', colParam, wrap(async (req, res) => {
  if (req.params.col === 'students') {
    const prev = await req.Model.findOne({ tenantId: req.tenantId, _key: req.params.key }).lean();
    if (!prev) return res.status(404).json({ error: 'Not found' });
    const merged = { ...clean(prev), ...stripMeta(req.body), id: prev.id ?? req.params.key };
    normalizeStudentPaymentDates(merged, prev);
    await reconcileStudents(req.tenantId, [merged], { actor: req.user.email, previous: new Map([[String(merged.id), prev]]) });
    await recordStudentDiff(req.tenantId, new Map([[String(merged.id), prev]]), [merged], req.user.email);
  }
  const patch = stripMeta(req.body);
  if (req.params.col === 'payments') {
    const prev = await req.Model.findOne({ tenantId: req.tenantId, _key: req.params.key }).lean();
    const mergedPay = { ...(prev ? clean(prev) : {}), ...patch, receiptNo: prev?.receiptNo ?? req.params.key };
    if (prev) validatePaymentBatch([mergedPay], new Map([[req.params.key, prev]]));
    else validatePaymentBatch([mergedPay]);
    if (mergedPay.paidOn) { patch.paidOn = mergedPay.paidOn; patch.date = mergedPay.date; patch.enteredAt = mergedPay.enteredAt; }
    await enforceAmountEdits(req, [mergedPay], prev ? new Map([[String(prev.receiptNo ?? req.params.key), prev]]) : new Map());
  }
  const d = await req.Model.findOneAndUpdate({ tenantId: req.tenantId, _key: req.params.key }, { $set: patch }, { new: true, lean: true });
  d ? res.json(clean(d)) : res.status(404).json({ error: 'Not found' });
}));

tenant.delete('/:col/:key', colParam, wrap(async (req, res) => {
  if (req.params.col === 'seats') {
    const seat = await req.Model.findOne({ tenantId: req.tenantId, _key: req.params.key }).lean();
    const held = seat && (await SeatAllocation.find({ tenantId: req.tenantId, status: 'active' }).lean()).some(a => seatMatchesAllocation(seat, a));
    if (held) throw new SeatConflictError(`Seat ${seat.name} has an active student. Move the student to another seat before removing it.`, { seatNo: seat.name });
  }
  if (req.params.col === 'students') await releaseForStudents(req.tenantId, [req.params.key]);
  if (req.params.col === 'archivedStudents') return res.status(400).json({ error: 'Use DELETE /archived-students/:id with confirmation', code: 'confirmation_required' });
  const r = await req.Model.deleteOne({ tenantId: req.tenantId, _key: req.params.key });
  r.deletedCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
}));

// Bulk sync: make this library's collection match the array the UI holds
// (upsert all, delete this library's docs that are no longer present).
tenant.put('/:col', colParam, wrap(async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Body must be an array' });
  const col = req.params.col;
  // A locked library can still PUT config collections. Never let an empty local cache wipe saved rows.
  if (req.body.length === 0 && req.user?.role !== 'superadmin') {
    const lib = await refreshSubscriptionStatus(req.tenantId);
    const access = accessFor(lib, { role: req.user?.role });
    if (!access.ok) {
      const existing = await req.Model.countDocuments({ tenantId: req.tenantId });
      if (existing > 0) {
        return res.status(409).json({
          error: `This library is locked. Refusing to replace ${col} with an empty list because it still has saved records.`,
          code: 'LOCKED_EMPTY_REPLACE',
        });
      }
    }
  }
  const prevArchived = col === 'archivedStudents' ? await req.Model.find({ tenantId: req.tenantId }).lean() : null;
  if (col === 'seats') await validateSeatSync(req.tenantId, req.body.map(stripMeta));
  let newPayments = null;
  let prevPayByKey = new Map();
  if (col === 'payments') {
    const prevDocs = await req.Model.find({ tenantId: req.tenantId }).lean();
    prevPayByKey = new Map(prevDocs.map(d => [String(d._key), d]));
    validatePaymentBatch(req.body.map(stripMeta), prevPayByKey);
    await enforceAmountEdits(req, req.body.map(stripMeta), prevPayByKey);
    const had = new Set(prevDocs.map(d => String(d._key)));
    newPayments = req.body.map(stripMeta).map(b => ({ ...b, _key: keyOf(col, b) })).filter(b => b._key && !had.has(String(b._key)));
  }
  if (col === 'branches') {
    const n = await req.Model.countDocuments({ tenantId: req.tenantId });
    await checkBranchLimit(req.tenantId, new Set(req.body.map(stripMeta).map(b => keyOf(col, b)).filter(Boolean)).size, n);
  }
  if (col === 'students') {
    const prevDocs = await req.Model.find({ tenantId: req.tenantId }).lean();
    const previous = new Map(prevDocs.map(d => [String(d._key), d]));
    const incoming = req.body.map(stripMeta).filter(b => keyOf(col, b));
    for (const s of incoming) normalizeStudentPaymentDates(s, previous.get(String(keyOf(col, s))));
    await checkCapacity(req.tenantId, new Set(incoming.map(b => keyOf(col, b))).size, prevDocs.length);
    await reconcileStudents(req.tenantId, incoming, { actor: req.user.email, previous });
    req.studentDiff = { previous, incoming };
    const keep = new Set(incoming.map(b => keyOf(col, b)));
    await releaseForStudents(req.tenantId, prevDocs.map(d => d._key).filter(k => !keep.has(k)));
  }
  const seen = new Set();
  const ops = [];
  req.body.forEach((raw, i) => {
    const body = stripMeta(raw);
    const _key = keyOf(col, body);
    if (!_key || seen.has(_key)) return;
    if (col === 'payments') {
      const prevPay = prevPayByKey.get(String(_key));
      if (!prevPay || prevPay.paidOn !== body.paidOn) applyPaidOn(body);
    }
    if (col === 'students') normalizeStudentPaymentDates(body, req.studentDiff?.previous?.get(String(_key)));
    seen.add(_key);
    ops.push({ replaceOne: { filter: { tenantId: req.tenantId, _key }, replacement: { ...body, _key, _order: i, tenantId: req.tenantId, libraryId: req.tenantId }, upsert: true } });
  });
  if (ops.length) await req.Model.bulkWrite(ops, { ordered: false });
  const del = await req.Model.deleteMany({ tenantId: req.tenantId, _key: { $nin: [...seen] } });
  if (req.studentDiff) await recordStudentDiff(req.tenantId, req.studentDiff.previous, req.studentDiff.incoming, req.user.email);
  if (newPayments?.length) await sendReceiptsAfterSave(req.tenantId, newPayments);
  if (req.studentDiff) {
    const added = [...new Set(req.studentDiff.incoming.map(b => keyOf(col, b)))].filter(k => !req.studentDiff.previous.has(String(k)));
    if (added.length) await sendReceiptsAfterSave(req.tenantId, null, added);
  }
  if (prevArchived) await recordArchiveDiff(req, prevArchived, req.body.map(stripMeta).filter(b => keyOf(col, b)));
  res.json({ ok: true, upserted: ops.length, deleted: del.deletedCount });
}));

// WhatsApp (Evolution API) is proxied server-side; mounted before the generic /:col routes
router.use('/whatsapp', tenantScope, auditSuperadminAccess, requireActiveSubscription, requireFeature('whatsapp'), createWhatsappRouter());
router.use('/', tenant);
export default router;

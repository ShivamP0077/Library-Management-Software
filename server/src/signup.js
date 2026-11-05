// Issue #15: owner self-signup -> verify email (or Google) -> choose a plan -> library created.
// Off unless OWNER_SIGNUP_ENABLED=true. Google signup is allowed only while signup is on;
// otherwise Google still never creates accounts (login / invite only).
import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import { User, Library } from './models.js';
import { createLibrary, validatePassword } from './services.js';
import { sendMail } from './mailer.js';
import { audit } from './audit.js';
import { rateLimited } from './accounts.js';
import { SoftwarePlan, pubPlan } from './plans.js';
import { initialSubscription, INTERVALS, paymentProvider } from './billing.js';
import { googleEnabled, verifyGoogleIdToken } from './google.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const signupEnabled = () => String(process.env.OWNER_SIGNUP_ENABLED || '').toLowerCase() === 'true';
const CODE_MINUTES = 15;
const GOOGLE_PENDING_MINUTES = 30;

const signupOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, index: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  usedAt: Date,
}, { timestamps: true });
signupOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const SignupOtp = mongoose.models.SignupOtp || mongoose.model('SignupOtp', signupOtpSchema);

/** Short-lived Google identity waiting for plan + library name (Issue #15). */
const signupGoogleSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  email: { type: String, required: true, index: true },
  googleSub: { type: String, required: true },
  name: { type: String, default: '' },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
}, { timestamps: true });
signupGoogleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const SignupGooglePending = mongoose.models.SignupGooglePending || mongoose.model('SignupGooglePending', signupGoogleSchema);

const signupPlans = async () => (await SoftwarePlan.find({ active: true, public: true }).sort({ sortOrder: 1, priceMonthly: 1 }).lean()).map(pubPlan);

/** Create a pending Google signup token the frontend finishes with plan + library name. */
export async function createGoogleSignupPending(identity) {
  const raw = crypto.randomBytes(32).toString('base64url');
  await SignupGooglePending.create({
    tokenHash: sha(raw),
    email: String(identity.email).toLowerCase().trim(),
    googleSub: String(identity.sub),
    name: String(identity.name || '').slice(0, 80),
    expiresAt: new Date(Date.now() + GOOGLE_PENDING_MINUTES * 60e3),
  });
  return raw;
}

function paymentHookFor(subscription) {
  const needsPayment = subscription?.status === 'pending_payment';
  return {
    needsPayment: Boolean(needsPayment),
    paymentsConfigured: Boolean(paymentProvider()),
    // Frontend / #19 checkout endpoint. Present even when provider is missing so the UI can show the step.
    paymentHook: needsPayment ? { action: 'checkout', path: '/api/subscription/checkout', method: 'POST' } : null,
  };
}

async function finishOwnerSignup({ email, name, libraryName, password, plan, interval, google, ip, issueSession, res }) {
  if (await User.exists({ email })) {
    return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
  }
  const admin = { email, name, ...(password ? { password } : {}), ...(google?.sub ? { googleSub: google.sub } : {}) };
  // createUser always tags google in authProviders; we fix providers + googleSub below when needed.
  const { library, adminUser } = await createLibrary({
    name: libraryName,
    contactEmail: email,
    createdBy: google ? `signup-google:${email}` : `signup:${email}`,
    admin: { email, name, ...(password ? { password } : {}) },
  });
  const user = await User.findById(adminUser._id);
  if (google?.sub) {
    user.googleSub = google.sub;
    user.authProviders = [...new Set([...(password ? ['password'] : []), 'google'])];
    if (google.name && !user.name) user.name = google.name;
    await user.save();
  } else {
    user.authProviders = ['password'];
    await user.save();
  }
  const subscription = initialSubscription(plan, interval);
  await Library.updateOne({ libraryId: library.libraryId }, { $set: { planId: plan?.planId || null, subscription, signupAt: new Date() } });
  await audit(
    { user: { id: String(user._id), email, role: 'client_admin' }, ip },
    'owner.signup',
    { tenantId: library.libraryId, target: email, detail: { planId: plan?.planId || null, interval, status: subscription?.status || null, via: google ? 'google' : 'email' } },
  );
  // Attach payment step fields onto the session response.
  const origJson = res.json.bind(res);
  res.json = (body) => origJson({ ...body, ...paymentHookFor(subscription) });
  return issueSession(user, res);
}

async function resolvePlan(body) {
  const interval = INTERVALS.includes(body.interval) ? body.interval : 'month';
  const plans = await signupPlans();
  const plan = body.planId ? plans.find(p => p.planId === body.planId) : null;
  if (plans.length && !plan) return { error: { status: 400, body: { error: 'Choose a plan', code: 'plan_required' } } };
  if (plan && interval === 'year' && !plan.priceYearly && plan.priceMonthly > 0) {
    return { error: { status: 400, body: { error: 'This plan has no yearly price' } } };
  }
  return { plan, interval, plans };
}

export function createSignupRouter({ issueSession }) {
  const r = express.Router();
  const off = (res) => res.status(403).json({ error: 'Signup is not open yet. Contact us to get an account.', code: 'signup_disabled' });

  r.get('/auth/signup/config', wrap(async (_req, res) => {
    const enabled = signupEnabled();
    res.json({
      enabled,
      plans: enabled ? await signupPlans() : [],
      googleSignup: enabled && googleEnabled(),
      paymentsConfigured: Boolean(paymentProvider()),
    });
  }));

  r.post('/auth/signup/start', wrap(async (req, res) => {
    if (!signupEnabled()) return off(res);
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (rateLimited(`su-ip:${req.ip}`, 10, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    if (rateLimited(`su:${email}`, 1, 60e3)) return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    const generic = { ok: true, message: 'We sent a 6-digit code to your email.' };
    if (await User.exists({ email })) {
      await sendMail({ to: email, subject: 'Library OS signup', text: 'Someone tried to sign up with this email, but you already have a Library OS account. Sign in instead, or use Forgot password.' });
      return res.json(generic); // same answer: no account discovery
    }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await SignupOtp.updateMany({ email, usedAt: null }, { $set: { usedAt: new Date() } });
    await SignupOtp.create({ email, codeHash: sha(`${email}:${code}`), expiresAt: new Date(Date.now() + CODE_MINUTES * 60e3) });
    await sendMail({ to: email, subject: 'Your Library OS signup code', text: `Your signup code is ${code}. It expires in ${CODE_MINUTES} minutes.` });
    res.json(generic);
  }));

  r.post('/auth/signup/complete', wrap(async (req, res) => {
    if (!signupEnabled()) return off(res);
    const b = req.body || {};
    const email = String(b.email || '').toLowerCase().trim();
    const name = String(b.name || '').trim().slice(0, 80);
    const libraryName = String(b.libraryName || '').trim().slice(0, 100);
    if (!EMAIL.test(email) || !b.code) return res.status(400).json({ error: 'Email and code are required' });
    if (!name || !libraryName) return res.status(400).json({ error: 'Your name and library name are required' });
    if (!validatePassword(b.password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (rateLimited(`suc:${req.ip}`, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

    const resolved = await resolvePlan(b);
    if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);

    const bad = () => res.status(400).json({ error: 'Invalid or expired code', code: 'invalid_code' });
    const rec = await SignupOtp.findOne({ email, usedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!rec || rec.attempts >= 5) return bad();
    if (rec.codeHash !== sha(`${email}:${String(b.code).trim()}`)) { rec.attempts += 1; await rec.save(); return bad(); }
    const claimed = await SignupOtp.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) return bad();

    return finishOwnerSignup({
      email, name, libraryName, password: b.password, plan: resolved.plan, interval: resolved.interval,
      ip: req.ip, issueSession, res,
    });
  }));

  /**
   * Finish Google signup after OAuth (pending token) or GIS credential.
   * Body: { pendingToken } OR { credential }, plus libraryName, planId, interval, optional name/password.
   */
  r.post('/auth/signup/complete-google', wrap(async (req, res) => {
    if (!signupEnabled()) return off(res);
    const b = req.body || {};
    const libraryName = String(b.libraryName || '').trim().slice(0, 100);
    if (!libraryName) return res.status(400).json({ error: 'Library name is required' });
    if (b.password && !validatePassword(b.password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (rateLimited(`sug:${req.ip}`, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

    let email, googleSub, nameFromGoogle = '';
    if (b.pendingToken) {
      const rec = await SignupGooglePending.findOne({
        tokenHash: sha(String(b.pendingToken)),
        usedAt: null,
        expiresAt: { $gt: new Date() },
      });
      if (!rec) return res.status(400).json({ error: 'Google signup expired. Start again.', code: 'google_signup_expired' });
      const claimed = await SignupGooglePending.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
      if (!claimed) return res.status(400).json({ error: 'Google signup expired. Start again.', code: 'google_signup_expired' });
      email = rec.email;
      googleSub = rec.googleSub;
      nameFromGoogle = rec.name || '';
    } else if (b.credential) {
      if (!googleEnabled()) return res.status(501).json({ error: 'Google sign-in is not configured', code: 'google_not_configured' });
      const g = await verifyGoogleIdToken(b.credential);
      email = String(g.email).toLowerCase().trim();
      googleSub = g.sub;
      nameFromGoogle = g.name || '';
    } else {
      return res.status(400).json({ error: 'Google credential or pending token is required' });
    }

    const name = String(b.name || nameFromGoogle || email.split('@')[0]).trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Your name is required' });

    const resolved = await resolvePlan(b);
    if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);

    return finishOwnerSignup({
      email, name, libraryName, password: b.password || undefined,
      plan: resolved.plan, interval: resolved.interval,
      google: { sub: googleSub, name: nameFromGoogle },
      ip: req.ip, issueSession, res,
    });
  }));

  return r;
}

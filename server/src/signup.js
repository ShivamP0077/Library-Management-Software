// Issue #15: owner self-signup -> verify email or mobile (or Google) -> choose a plan -> library created.
// Off unless OWNER_SIGNUP_ENABLED=true. Mobile verification never falls back to email.
import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import { User, Library } from './models.js';
import { createLibrary, validatePassword } from './services.js';
import { sendMail } from './mailer.js';
import { sendMobileMessage, smsConfigured } from './messaging.js';
import { audit } from './audit.js';
import { rateLimited } from './accounts.js';
import { throttleHit } from './throttle.js';
import { SoftwarePlan, pubPlan } from './plans.js';
import { initialSubscription, INTERVALS, paymentProvider } from './billing.js';
import { trialIdentityUsed, recordTrialIdentifiers, TRIAL_USED_MESSAGE } from './trialUsage.js';
import { googleEnabled, verifyGoogleIdToken } from './google.js';
import { EMAIL_RE, normalizeEmail, normalizeMobile, isMobile, maskIdentifier } from './identity.js';
import { createRegistrationConfirmation, deliverRegistrationConfirmation } from './registration.js';
import { Referral } from './commerce.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const signupEnabled = () => String(process.env.OWNER_SIGNUP_ENABLED || '').toLowerCase() === 'true';
const CODE_MINUTES = 15;
const GOOGLE_PENDING_MINUTES = 30;

const signupOtpSchema = new mongoose.Schema({
  email: { type: String, index: true },
  mobile: { type: String, index: true },
  channel: { type: String, enum: ['email', 'mobile'], default: 'email' },
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
    email: normalizeEmail(identity.email),
    googleSub: String(identity.sub),
    name: String(identity.name || '').slice(0, 80),
    expiresAt: new Date(Date.now() + GOOGLE_PENDING_MINUTES * 60e3),
  });
  return raw;
}

function paymentHookFor(subscription, trialMessage) {
  const needsPayment = subscription?.status === 'pending_payment' || subscription?.status === 'awaiting_payment';
  return {
    needsPayment: Boolean(needsPayment),
    paymentsConfigured: Boolean(paymentProvider()),
    // Frontend / #19 checkout endpoint. Present even when provider is missing so the UI can show the step.
    paymentHook: needsPayment ? { action: 'checkout', path: '/api/subscription/checkout', softwarePlanPath: '/api/software-plan/checkout', method: 'POST' } : null,
    ...(trialMessage ? { message: trialMessage } : {}),
  };
}

async function uniqueReferralCode() {
  for (let i = 0; i < 8; i += 1) {
    const code = `LIB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    if (!(await Library.exists({ referralCode: code }))) return code;
  }
  return `LIB-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

async function finishOwnerSignup({ email, mobile, name, libraryName, city, password, plan, interval, google, via = 'email', referralCode, ip, issueSession, res }) {
  email = email ? normalizeEmail(email) : '';
  mobile = mobile ? normalizeMobile(mobile) : '';
  if (email && await User.exists({ email })) {
    return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
  }
  if (mobile && await User.exists({ mobile })) {
    return res.status(409).json({ error: 'An account with this mobile number already exists. Sign in instead.' });
  }
  if (!email && !mobile) return res.status(400).json({ error: 'An email or mobile number is required' });

  // Checked before the account exists so the new row is not treated as a previous trial.
  let trialMessage = null;
  let grantTrial = false;
  if (Number(plan?.trialDays) > 0) {
    const decision = await trialIdentityUsed({ email, mobile, googleSub: google?.sub || null });
    if (decision.used) trialMessage = TRIAL_USED_MESSAGE;
    else grantTrial = true;
  }

  const referrer = referralCode ? await Library.findOne({ referralCode: String(referralCode).trim().toUpperCase() }).lean() : null;
  const ownCode = await uniqueReferralCode();
  const { library, adminUser } = await createLibrary({
    name: libraryName,
    contactEmail: email || null,
    phone: mobile || null,
    city: city || null,
    referralCode: ownCode,
    referredByCode: referrer ? referrer.referralCode : null,
    createdBy: google ? `signup-google:${email}` : `signup:${email || mobile}`,
    admin: {
      email: email || undefined,
      mobile: mobile || undefined,
      name,
      ...(password ? { password } : {}),
      emailVerified: Boolean(email) && via !== 'mobile',
      mobileVerified: via === 'mobile' || Boolean(google && mobile),
    },
  });
  const user = await User.findById(adminUser._id);
  if (google?.sub) {
    user.googleSub = google.sub;
    user.authProviders = [...new Set([...(password ? ['password'] : []), 'google'])];
    user.emailVerified = true;
    if (google.name && !user.name) user.name = google.name;
    await user.save();
  } else {
    user.authProviders = ['password'];
    await user.save();
  }
  let subscription = initialSubscription(plan, interval);
  if (subscription?.status === 'trialing' && trialMessage) {
    subscription = { ...subscription, status: 'awaiting_payment', trialEndsAt: null, currentPeriodEnd: null };
  } else if (grantTrial && subscription) {
    subscription = { ...subscription, trialGrantedAt: new Date() };
    await recordTrialIdentifiers({ email, mobile, googleSub: google?.sub || null });
  }
  await Library.updateOne({ libraryId: library.libraryId }, { $set: { planId: plan?.planId || null, subscription, signupAt: new Date() } });
  if (referrer && referrer.libraryId !== library.libraryId) {
    await Referral.create({
      referralId: `ref_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      code: referrer.referralCode,
      referrerTenantId: referrer.libraryId,
      referredTenantId: library.libraryId,
      campaignId: null,
      status: 'pending',
      rewardMinor: 0,
      reason: 'Awaiting first genuine paid subscription',
    });
  }
  await audit(
    { user: { id: String(user._id), email: user.email, role: 'client_admin' }, ip },
    'owner.signup',
    { tenantId: library.libraryId, target: user.email || user.mobile, detail: { planId: plan?.planId || null, interval, status: subscription?.status || null, via: google ? 'google' : via } },
  );
  // Issue #15: persistent registration confirmation, independent of delivery success.
  let confirmation = await createRegistrationConfirmation({ library, user, plan, subscription, via: google ? 'email' : via });
  confirmation = await deliverRegistrationConfirmation(confirmation._id).catch(e => { console.error('[registration] delivery failed:', e.message); return confirmation; });

  const origJson = res.json.bind(res);
  res.json = (body) => origJson({ ...body, ...paymentHookFor(subscription, trialMessage), registrationConfirmation: { confirmationNumber: confirmation.confirmationNumber, paymentStatus: confirmation.paymentStatus, deliveryStatus: confirmation.delivery?.status || 'pending' } });
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
      mobileSignup: enabled && smsConfigured(),
      paymentsConfigured: Boolean(paymentProvider()),
    });
  }));

  r.post('/auth/signup/start', wrap(async (req, res) => {
    if (!signupEnabled()) return off(res);
    const email = normalizeEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (rateLimited(`su-ip:${req.ip}`, 10, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    if (rateLimited(`su-email:${email}`, 1, 60e3)) return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    if (await throttleHit(`signup-email:${email}`, 5, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    const generic = { ok: true, message: 'We sent a 6-digit code to your email.' };
    if (await User.exists({ email })) {
      await sendMail({ to: email, subject: 'My Library OS signup', text: 'Someone tried to sign up with this email, but you already have a My Library OS account. Sign in instead, or use Forgot password.' });
      return res.json(generic); // same answer: no account discovery
    }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await SignupOtp.updateMany({ email, channel: 'email', usedAt: null }, { $set: { usedAt: new Date() } });
    await SignupOtp.create({ email, channel: 'email', codeHash: sha(`${email}:${code}`), expiresAt: new Date(Date.now() + CODE_MINUTES * 60e3) });
    await sendMail({ to: email, subject: 'Your My Library OS signup code', text: `Your signup code is ${code}. It expires in ${CODE_MINUTES} minutes.` });
    res.json(generic);
  }));

  r.post('/auth/signup/start-mobile', wrap(async (req, res) => {
    if (!signupEnabled()) return off(res);
    const mobile = normalizeMobile(req.body?.mobile);
    if (!isMobile(mobile)) return res.status(400).json({ error: 'A valid mobile number is required' });
    if (!smsConfigured()) return res.status(503).json({ error: 'Mobile verification is not configured. Contact support.', code: 'mobile_otp_not_configured' });
    if (rateLimited(`sump-ip:${req.ip}`, 10, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    if (rateLimited(`su-mobile:${mobile}`, 1, 60e3)) return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    if (await throttleHit(`signup-mobile:${mobile}`, 5, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    const generic = { ok: true, message: `We sent a 6-digit code to ${maskIdentifier(mobile)}.` };
    if (await User.exists({ mobile })) {
      await sendMobileMessage({ to: mobile, text: 'Someone tried to sign up with this mobile number, but a My Library OS account already exists. Sign in instead, or use Forgot password.' });
      return res.json(generic);
    }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await SignupOtp.updateMany({ mobile, channel: 'mobile', usedAt: null }, { $set: { usedAt: new Date() } });
    await SignupOtp.create({ mobile, channel: 'mobile', codeHash: sha(`mobile:${mobile}:${code}`), expiresAt: new Date(Date.now() + CODE_MINUTES * 60e3) });
    await sendMobileMessage({ to: mobile, text: `Your My Library OS signup code is ${code}. It expires in ${CODE_MINUTES} minutes.` });
    res.json(generic);
  }));

  r.post('/auth/signup/complete', wrap(async (req, res) => {
    if (!signupEnabled()) return off(res);
    const b = req.body || {};
    const email = normalizeEmail(b.email);
    const mobile = b.mobile ? normalizeMobile(b.mobile) : '';
    const name = String(b.name || '').trim().slice(0, 80);
    const libraryName = String(b.libraryName || '').trim().slice(0, 100);
    const city = String(b.city || '').trim().slice(0, 80);
    if (!EMAIL_RE.test(email) || !b.code) return res.status(400).json({ error: 'Email and code are required' });
    if (mobile && !isMobile(mobile)) return res.status(400).json({ error: 'Enter a valid mobile number' });
    if (!name || !libraryName) return res.status(400).json({ error: 'Your name and library name are required' });
    if (!validatePassword(b.password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (rateLimited(`suc:${req.ip}`, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

    const resolved = await resolvePlan(b);
    if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);

    const bad = () => res.status(400).json({ error: 'Invalid or expired code', code: 'invalid_code' });
    const rec = await SignupOtp.findOne({ email, channel: 'email', usedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!rec || rec.attempts >= 5) return bad();
    if (rec.codeHash !== sha(`${email}:${String(b.code).trim()}`)) { rec.attempts += 1; await rec.save(); return bad(); }
    const claimed = await SignupOtp.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) return bad();

    return finishOwnerSignup({
      email, mobile, name, libraryName, city, password: b.password, plan: resolved.plan, interval: resolved.interval,
      via: 'email', referralCode: b.referralCode, ip: req.ip, issueSession, res,
    });
  }));

  r.post('/auth/signup/complete-mobile', wrap(async (req, res) => {
    if (!signupEnabled()) return off(res);
    const b = req.body || {};
    const mobile = normalizeMobile(b.mobile);
    const email = b.email ? normalizeEmail(b.email) : '';
    const name = String(b.name || '').trim().slice(0, 80);
    const libraryName = String(b.libraryName || '').trim().slice(0, 100);
    const city = String(b.city || '').trim().slice(0, 80);
    if (!isMobile(mobile) || !b.code) return res.status(400).json({ error: 'Mobile number and code are required' });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (!name || !libraryName) return res.status(400).json({ error: 'Your name and library name are required' });
    if (!validatePassword(b.password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (rateLimited(`sucm:${req.ip}`, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

    const resolved = await resolvePlan(b);
    if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);

    const bad = () => res.status(400).json({ error: 'Invalid or expired code', code: 'invalid_code' });
    const rec = await SignupOtp.findOne({ mobile, channel: 'mobile', usedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!rec || rec.attempts >= 5) return bad();
    if (rec.codeHash !== sha(`mobile:${mobile}:${String(b.code).trim()}`)) { rec.attempts += 1; await rec.save(); return bad(); }
    const claimed = await SignupOtp.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) return bad();

    return finishOwnerSignup({
      email, mobile, name, libraryName, city, password: b.password, plan: resolved.plan, interval: resolved.interval,
      via: 'mobile', referralCode: b.referralCode, ip: req.ip, issueSession, res,
    });
  }));

  /**
   * Finish Google signup after OAuth (pending token) or GIS credential.
   * Body: { pendingToken } OR { credential }, plus libraryName, planId, interval, optional name/password/mobile.
   */
  r.post('/auth/signup/complete-google', wrap(async (req, res) => {
    if (!signupEnabled()) return off(res);
    const b = req.body || {};
    const libraryName = String(b.libraryName || '').trim().slice(0, 100);
    const city = String(b.city || '').trim().slice(0, 80);
    const mobile = b.mobile ? normalizeMobile(b.mobile) : '';
    if (!libraryName) return res.status(400).json({ error: 'Library name is required' });
    if (mobile && !isMobile(mobile)) return res.status(400).json({ error: 'Enter a valid mobile number' });
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
      email = normalizeEmail(g.email);
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
      email, mobile, name, libraryName, city, password: b.password || undefined,
      plan: resolved.plan, interval: resolved.interval, via: 'email',
      google: { sub: googleSub, name: nameFromGoogle },
      referralCode: b.referralCode, ip: req.ip, issueSession, res,
    });
  }));

  return r;
}

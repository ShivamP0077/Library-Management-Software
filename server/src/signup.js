// Issue #15: owner self-signup -> verify email -> choose a plan -> library created.
// Off unless OWNER_SIGNUP_ENABLED=true. Google never creates accounts; after signup the
// owner can sign in with Google using the same (verified) email.
import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import { User, Library } from './models.js';
import { createLibrary, validatePassword } from './services.js';
import { sendMail } from './mailer.js';
import { audit } from './audit.js';
import { rateLimited } from './accounts.js';
import { SoftwarePlan, pubPlan } from './plans.js';
import { initialSubscription, INTERVALS } from './billing.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const signupEnabled = () => String(process.env.OWNER_SIGNUP_ENABLED || '').toLowerCase() === 'true';
const CODE_MINUTES = 15;

const signupOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, index: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  usedAt: Date,
}, { timestamps: true });
signupOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const SignupOtp = mongoose.models.SignupOtp || mongoose.model('SignupOtp', signupOtpSchema);

const signupPlans = async () => (await SoftwarePlan.find({ active: true, public: true }).sort({ sortOrder: 1, priceMonthly: 1 }).lean()).map(pubPlan);

export function createSignupRouter({ issueSession }) {
  const r = express.Router();
  const off = (res) => res.status(403).json({ error: 'Signup is not open yet. Contact us to get an account.', code: 'signup_disabled' });

  r.get('/auth/signup/config', wrap(async (_req, res) => {
    res.json({ enabled: signupEnabled(), plans: signupEnabled() ? await signupPlans() : [] });
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
    const interval = INTERVALS.includes(b.interval) ? b.interval : 'month';
    if (!EMAIL.test(email) || !b.code) return res.status(400).json({ error: 'Email and code are required' });
    if (!name || !libraryName) return res.status(400).json({ error: 'Your name and library name are required' });
    if (!validatePassword(b.password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (rateLimited(`suc:${req.ip}`, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

    const plans = await signupPlans();
    const plan = b.planId ? plans.find(p => p.planId === b.planId) : null;
    if (plans.length && !plan) return res.status(400).json({ error: 'Choose a plan', code: 'plan_required' });
    if (plan && interval === 'year' && !plan.priceYearly && plan.priceMonthly > 0) return res.status(400).json({ error: 'This plan has no yearly price' });

    const bad = () => res.status(400).json({ error: 'Invalid or expired code', code: 'invalid_code' });
    const rec = await SignupOtp.findOne({ email, usedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!rec || rec.attempts >= 5) return bad();
    if (rec.codeHash !== sha(`${email}:${String(b.code).trim()}`)) { rec.attempts += 1; await rec.save(); return bad(); }
    const claimed = await SignupOtp.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) return bad();
    if (await User.exists({ email })) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });

    const { library, adminUser } = await createLibrary({ name: libraryName, contactEmail: email, createdBy: `signup:${email}`, admin: { email, name, password: b.password } });
    const subscription = initialSubscription(plan, interval);
    await Library.updateOne({ libraryId: library.libraryId }, { $set: { planId: plan?.planId || null, subscription, signupAt: new Date() } });
    await audit({ user: { id: String(adminUser._id), email, role: 'client_admin' }, ip: req.ip }, 'owner.signup', { tenantId: library.libraryId, target: email, detail: { planId: plan?.planId || null, interval, status: subscription?.status || null } });
    const user = await User.findById(adminUser._id);
    return issueSession(user, res);
  }));
  return r;
}

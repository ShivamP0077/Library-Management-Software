// Issue #15: owner My Profile — verified contacts, registration confirmation, password setup.
import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, Library } from './models.js';
import { hashPassword, validatePassword } from './services.js';
import { audit } from './audit.js';
import { sendMail, mailEnabled } from './mailer.js';
import { sendMobileMessage, smsConfigured } from './messaging.js';
import { verifyGoogleIdToken, googleEnabled } from './google.js';
import { EMAIL_RE, normalizeEmail, normalizeMobile, isMobile, maskIdentifier } from './identity.js';
import { throttleHit } from './throttle.js';
import { SoftwarePlan, pubPlan } from './plans.js';
import {
  RegistrationConfirmation, createRegistrationConfirmation, deliverRegistrationConfirmation,
  registrationConfirmationText, registrationConfirmationPdf,
} from './registration.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const minutes = (n) => new Date(Date.now() + n * 60e3);
const emailConfigured = () => mailEnabled() || process.env.NODE_ENV === 'test';
const maskContact = (value) => String(value || '').replace(/^(.{2}).*(@.*)$/, '$1***$2').replace(/^(\d{2}).*(\d{4})$/, '$1****$2');

const otpBase = {
  userId: { type: String, required: true, index: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  usedAt: Date,
};

const setupOtpSchema = new mongoose.Schema({
  ...otpBase,
  via: { type: String, enum: ['email', 'mobile'], required: true },
}, { timestamps: true });
setupOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const PasswordSetupOtp = mongoose.models.PasswordSetupOtp || mongoose.model('PasswordSetupOtp', setupOtpSchema);

const reauthOtpSchema = new mongoose.Schema({
  ...otpBase,
  channel: { type: String, enum: ['email', 'mobile'], required: true },
  target: { type: String, required: true },
}, { timestamps: true });
reauthOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const ProfileReauthOtp = mongoose.models.ProfileReauthOtp || mongoose.model('ProfileReauthOtp', reauthOtpSchema);

const reauthTokenSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
}, { timestamps: true });
reauthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const ProfileReauthToken = mongoose.models.ProfileReauthToken || mongoose.model('ProfileReauthToken', reauthTokenSchema);

const contactOtpSchema = new mongoose.Schema({
  ...otpBase,
  tenantId: { type: String, required: true, index: true },
  channel: { type: String, enum: ['email', 'mobile'], required: true },
  target: { type: String, required: true },
  targetHash: { type: String, required: true },
}, { timestamps: true });
contactOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const ContactVerificationOtp = mongoose.models.ContactVerificationOtp || mongoose.model('ContactVerificationOtp', contactOtpSchema);

const pubConfirmation = (d) => d && ({
  confirmationNumber: d.confirmationNumber,
  libraryId: d.libraryId,
  libraryName: d.libraryName,
  ownerName: d.ownerName,
  email: d.email || null,
  mobile: d.mobile || null,
  planName: d.planName,
  interval: d.interval,
  subscriptionStatus: d.subscriptionStatus,
  paymentStatus: d.paymentStatus,
  isPaymentReceipt: false,
  registeredAt: d.registeredAt,
  trialEndsAt: d.trialEndsAt || null,
  supportContact: d.supportContact || null,
  delivery: d.delivery,
  downloadPath: '/api/account/registration-confirmation/download',
  pdfPath: '/api/account/registration-confirmation/download?format=pdf',
  historyPath: '/api/account/registration-confirmation/history',
});

async function ensureConfirmation(req) {
  let doc = await RegistrationConfirmation.findOne({ tenantId: req.tenantId });
  if (doc) return doc;
  const library = await Library.findOne({ libraryId: req.tenantId }).lean();
  const user = await User.findById(req.user.id).lean();
  const plan = library?.planId ? await SoftwarePlan.findOne({ planId: library.planId }).lean() : null;
  doc = await createRegistrationConfirmation({
    library: library || { libraryId: req.tenantId, name: req.tenantId },
    user, plan: plan ? pubPlan(plan) : null, subscription: library?.subscription,
    via: user?.mobile && !user?.email ? 'mobile' : 'email',
  });
  return doc;
}

async function profileView(req) {
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) return null;
  const library = await Library.findOne({ libraryId: req.tenantId }).lean();
  const confirmation = await ensureConfirmation(req);
  const loginMethods = [];
  if (user.passwordHash && user.emailVerified && user.email) loginMethods.push('email_password');
  if (user.passwordHash && user.mobileVerified && user.mobile) loginMethods.push('mobile_password');
  if (user.googleSub) loginMethods.push('google');
  return {
    user: { ...user.toSafeJSON(), hasPassword: Boolean(user.passwordHash), pendingEmail: user.pendingEmail || null, pendingMobile: user.pendingMobile || null },
    owner: {
      name: user.name,
      email: user.email || null,
      emailVerified: user.emailVerified === true,
      mobile: user.mobile || null,
      mobileVerified: user.mobileVerified === true,
      pendingEmail: user.pendingEmail || null,
      pendingMobile: user.pendingMobile || null,
      loginMethods,
      hasPassword: Boolean(user.passwordHash),
      googleLinked: Boolean(user.googleSub),
    },
    library: library && {
      libraryId: library.libraryId, name: library.name, city: library.city || null,
      address: library.address || null, phone: library.phone || null,
      contactEmail: library.contactEmail || null, referralCode: library.referralCode || null,
    },
    libraryDetails: library && {
      libraryId: library.libraryId, name: library.name, city: library.city || null,
      address: library.address || null, phone: library.phone || null, contactEmail: library.contactEmail || null,
    },
    ownerDetails: {
      name: user.name, email: user.email || null, emailVerified: user.emailVerified === true,
      mobile: user.mobile || null, mobileVerified: user.mobileVerified === true,
      loginMethods, pendingEmail: user.pendingEmail || null, pendingMobile: user.pendingMobile || null,
    },
    permissions: {
      canEditOwner: true,
      canEditLibrary: user.role === 'client_admin' && !req.readOnly,
      sensitiveLibraryReauth: user.role === 'client_admin' && !req.readOnly,
      readOnly: Boolean(req.readOnly),
    },
    registrationConfirmation: pubConfirmation(confirmation),
    services: { mobileVerification: smsConfigured(), emailDelivery: true, google: googleEnabled() },
  };
}

async function checkPassword(user, password) {
  if (!user.passwordHash) return false;
  return bcrypt.compare(String(password || ''), user.passwordHash);
}

/** Current password when one exists; otherwise a one-time reauth token (Google/OTP flow). */
async function verifyReauth(user, body = {}) {
  if (body.currentPassword !== undefined) {
    if (!user.passwordHash) return { ok: false, status: 400, error: 'This account has no password. Re-authenticate with a verification code or Google.', code: 'password_not_set' };
    if (!(await checkPassword(user, body.currentPassword))) return { ok: false, status: 400, error: 'Current password is incorrect', code: 'reauth_failed' };
    return { ok: true, method: 'password' };
  }
  if (body.reauthToken) {
    const token = await ProfileReauthToken.findOneAndUpdate(
      { userId: String(user._id), tokenHash: sha(body.reauthToken), usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } }, { new: true },
    );
    if (!token) return { ok: false, status: 401, error: 'Your security check expired. Request a new code.', code: 'reauth_expired' };
    return { ok: true, method: 'otp' };
  }
  if (body.googleCredential && googleEnabled()) {
    try {
      const g = await verifyGoogleIdToken(body.googleCredential);
      if (normalizeEmail(g.email) !== normalizeEmail(user.email)) {
        return { ok: false, status: 403, error: 'Google account does not match this profile', code: 'google_mismatch' };
      }
      return { ok: true, method: 'google' };
    } catch {
      return { ok: false, status: 401, error: 'Google verification failed', code: 'google_reauth_failed' };
    }
  }
  return { ok: false, status: 403, error: 'Confirm your current password or re-authenticate before changing security details.', code: 'reauth_required' };
}

function normalizeContact(channel, value) {
  if (channel === 'mobile') {
    const mobile = normalizeMobile(value);
    return isMobile(mobile) ? mobile : null;
  }
  const email = normalizeEmail(value);
  return EMAIL_RE.test(email) ? email : null;
}

async function sendReauthCode(user, channel, code) {
  const target = channel === 'mobile' ? user.mobile : user.email;
  if (!target) return { sent: false, reason: 'no_verified_channel' };
  if (channel === 'mobile') {
    if (!smsConfigured()) return { sent: false, reason: 'sms_not_configured' };
    return sendMobileMessage({ to: target, text: `Your My Library OS security code is ${code}. It expires in 10 minutes.` });
  }
  if (!emailConfigured()) return { sent: false, reason: 'email_not_configured' };
  try {
    const sent = await sendMail({ to: target, subject: 'Your My Library OS security code', text: `Your security code is ${code}. It expires in 10 minutes.` });
    return { sent: Boolean(sent) || process.env.NODE_ENV === 'test', reason: sent ? null : 'email_capture_only' };
  } catch (e) {
    return { sent: false, reason: 'email_delivery_failed' };
  }
}

export function createProfileRouter() {
  const r = express.Router();

  r.get('/profile', wrap(async (req, res) => {
    const view = await profileView(req);
    if (!view) return res.status(404).json({ error: 'User not found' });
    res.json(view);
  }));

  r.patch('/profile', wrap(async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const body = req.body || {};

    if (body.name !== undefined) {
      const name = String(body.name || '').trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: 'Name is required' });
      user.name = name;
    }

    const libIn = body.library && typeof body.library === 'object' ? body.library : {};
    const hasLibraryEdit = libIn.name !== undefined || ['city', 'address', 'phone', 'contactEmail'].some(k => body[k] !== undefined || libIn[k] !== undefined);
    if (hasLibraryEdit) {
      if (user.role !== 'client_admin') return res.status(403).json({ error: 'Only the library owner can edit library details', code: 'owner_only' });
      if (req.readOnly) return res.status(403).json({ error: 'Read-only access cannot edit library details', code: 'read_only' });
      const pick = (k) => (k === 'name' ? libIn.name : (body[k] !== undefined ? body[k] : libIn[k]));
      const libSet = {};
      if (libIn.name !== undefined) {
        const name = String(libIn.name || '').trim().slice(0, 100);
        if (!name) return res.status(400).json({ error: 'Library name is required' });
        libSet.name = name;
      }
      if (pick('city') !== undefined) libSet.city = String(pick('city') || '').trim().slice(0, 80) || null;
      if (pick('address') !== undefined) libSet.address = String(pick('address') || '').trim().slice(0, 300) || null;
      const sensitive = pick('phone') !== undefined || pick('contactEmail') !== undefined;
      if (sensitive) {
        const auth = await verifyReauth(user, body);
        if (!auth.ok) return res.status(auth.status).json({ error: auth.error, code: auth.code });
      }
      if (pick('phone') !== undefined) {
        const raw = String(pick('phone') || '').trim();
        libSet.phone = raw ? normalizeContact('mobile', raw) : null;
        if (raw && !libSet.phone) return res.status(400).json({ error: 'Enter a valid library contact mobile number' });
      }
      if (pick('contactEmail') !== undefined) {
        const raw = String(pick('contactEmail') || '').trim();
        libSet.contactEmail = raw ? normalizeContact('email', raw) : null;
        if (raw && !libSet.contactEmail) return res.status(400).json({ error: 'Enter a valid library contact email' });
      }
      await Library.updateOne({ libraryId: req.tenantId }, { $set: libSet });
    }

    await user.save();
    await audit(req, 'profile.updated', { detail: { fields: Object.keys(body || {}), libraryFields: hasLibraryEdit ? Object.keys(libIn).concat(Object.keys(body).filter(k => ['name','city','address','phone','contactEmail'].includes(k))) : [] } });
    res.json(await profileView(req));
  }));

  // Re-authentication for Google-only/passwordless accounts (or users who prefer OTP).
  r.post('/reauth/start', wrap(async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const requested = req.body?.via === 'mobile' ? 'mobile' : req.body?.via === 'email' ? 'email' : null;
    const channel = requested || (user.emailVerified && user.email ? 'email' : (user.mobileVerified && user.mobile ? 'mobile' : null));
    if (!channel) return res.status(400).json({ error: 'Verify an email or mobile number first', code: 'no_verified_channel' });
    if (requested === 'mobile' && (!user.mobileVerified || !user.mobile)) return res.status(400).json({ error: 'That mobile number is not verified on this account', code: 'verified_channel_required' });
    if (requested === 'email' && (!user.emailVerified || !user.email)) return res.status(400).json({ error: 'That email is not verified on this account', code: 'verified_channel_required' });
    if (channel === 'mobile' && !smsConfigured()) return res.status(503).json({ error: 'Mobile verification is not configured', code: 'mobile_otp_not_configured' });
    if (await throttleHit(`reauth:user:${user._id}`, 5, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    if (await throttleHit(`reauth:ip:${req.ip}:${user._id}`, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    if (await throttleHit(`reauth:resend:${user._id}:${channel}`, 1, 60e3)) return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await ProfileReauthOtp.updateMany({ userId: String(user._id), usedAt: null }, { $set: { usedAt: new Date() } });
    await ProfileReauthOtp.create({ userId: String(user._id), channel, target: channel === 'mobile' ? user.mobile : user.email, codeHash: sha(`${user._id}:${channel}:${code}`), expiresAt: minutes(10) });
    const result = await sendReauthCode(user, channel, code).catch(() => ({ sent: false, reason: 'delivery_failed' }));
    if (!result.sent) {
      await ProfileReauthOtp.updateMany({ userId: String(user._id), usedAt: null }, { $set: { usedAt: new Date() } });
      return res.status(503).json({ error: 'Could not deliver the security code', code: result.reason || 'delivery_failed' });
    }
    res.json({ ok: true, channel, sentTo: maskContact(channel === 'mobile' ? user.mobile : user.email) });
  }));

  r.post('/reauth/complete', wrap(async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (await throttleHit(`reauth-complete:user:${user._id}`, 10, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const bad = () => res.status(400).json({ error: 'Invalid or expired security code', code: 'invalid_code' });
    const rec = await ProfileReauthOtp.findOne({ userId: String(user._id), usedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!rec || rec.attempts >= 5) return bad();
    if (rec.codeHash !== sha(`${user._id}:${rec.channel}:${String(req.body?.code || '').trim()}`)) {
      rec.attempts += 1; await rec.save(); return bad();
    }
    const claimed = await ProfileReauthOtp.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) return bad();
    const raw = crypto.randomBytes(32).toString('base64url');
    await ProfileReauthToken.create({ userId: String(user._id), tokenHash: sha(raw), expiresAt: minutes(10) });
    res.json({ ok: true, reauthToken: raw, expiresInMinutes: 10 });
  }));

  // Start verification for a NEW email/mobile. The code is sent to the new value only.
  r.post('/contact/start', wrap(async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const channel = req.body?.channel === 'mobile' ? 'mobile' : 'email';
    const target = normalizeContact(channel, req.body?.value);
    if (!target) return res.status(400).json({ error: channel === 'mobile' ? 'Enter a valid mobile number' : 'Enter a valid email address' });
    if (channel === 'mobile' && !smsConfigured()) return res.status(503).json({ error: 'Mobile verification is not configured. No email fallback was used.', code: 'mobile_otp_not_configured' });
    const auth = await verifyReauth(user, req.body || {});
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error, code: auth.code });
    if (target === (channel === 'mobile' ? user.mobile : user.email)) return res.status(400).json({ error: 'This is already your verified contact', code: 'same_contact' });
    const taken = await User.exists({ [channel]: target, _id: { $ne: user._id } });
    if (taken) return res.status(409).json({ error: 'That contact is already linked to another account', code: 'contact_in_use' });
    if (await throttleHit(`contact-start:user:${user._id}`, 5, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    if (await throttleHit(`contact-start:ip:${req.ip}`, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    if (await throttleHit(`contact-resend:${user._id}:${channel}:${target}`, 1, 60e3)) return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await ContactVerificationOtp.updateMany({ userId: String(user._id), channel, usedAt: null }, { $set: { usedAt: new Date() } });
    await ContactVerificationOtp.create({
      userId: String(user._id), tenantId: req.tenantId, channel, target, targetHash: sha(target),
      codeHash: sha(`${user._id}:${channel}:${target}:${code}`), expiresAt: minutes(10),
    });
    if (channel === 'mobile') user.pendingMobile = target; else user.pendingEmail = target;
    await user.save();
    let result;
    if (channel === 'mobile') {
      result = await sendMobileMessage({ to: target, text: `Your My Library OS verification code is ${code}. It expires in 10 minutes.` });
    } else if (!emailConfigured()) {
      result = { sent: false, reason: 'email_not_configured' };
    } else {
      try {
        const sent = await sendMail({ to: target, subject: 'Verify your new My Library OS email', text: `Your verification code is ${code}. It expires in 10 minutes.` });
        result = { sent: Boolean(sent) || process.env.NODE_ENV === 'test', reason: sent ? null : 'email_delivery_failed' };
      } catch { result = { sent: false, reason: 'email_delivery_failed' }; }
    }
    if (!result.sent) {
      await ContactVerificationOtp.updateMany({ userId: String(user._id), channel, usedAt: null }, { $set: { usedAt: new Date() } });
      if (channel === 'mobile') user.pendingMobile = null; else user.pendingEmail = null;
      await user.save();
      return res.status(503).json({ error: 'Could not deliver the verification code. No email fallback was used.', code: result.reason || 'delivery_failed' });
    }
    await audit(req, 'profile.contact_verification_requested', { detail: { channel, target: maskContact(target) } });
    res.json({ ok: true, channel, sentTo: maskContact(target), delivered: true });
  }));

  // Verify the code sent to the NEW value. The record is bound to this user and target.
  r.post('/contact/verify', wrap(async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const channel = req.body?.channel === 'mobile' ? 'mobile' : 'email';
    const target = normalizeContact(channel, req.body?.value);
    if (!target) return res.status(400).json({ error: 'Enter the contact value that was verified' });
    if (await throttleHit(`contact-verify:user:${user._id}`, 10, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const rec = await ContactVerificationOtp.findOne({
      userId: String(user._id), tenantId: req.tenantId, channel, target, targetHash: sha(target),
      usedAt: null, expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });
    const bad = () => res.status(400).json({ error: 'Invalid or expired verification code', code: 'invalid_code' });
    if (!rec || rec.attempts >= 5) return bad();
    if (rec.codeHash !== sha(`${user._id}:${channel}:${target}:${String(req.body?.code || '').trim()}`)) {
      rec.attempts += 1; await rec.save(); return bad();
    }
    const taken = await User.exists({ [channel]: target, _id: { $ne: user._id } });
    if (taken) return res.status(409).json({ error: 'That contact is already linked to another account', code: 'contact_in_use' });
    const claimed = await ContactVerificationOtp.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) return bad();
    if (channel === 'mobile') {
      user.mobile = target; user.mobileVerified = true; user.pendingMobile = null;
      user.authProviders = [...new Set([...(user.authProviders || []), 'mobile'])];
    } else {
      user.email = target; user.emailVerified = true; user.pendingEmail = null;
      user.authProviders = [...new Set([...(user.authProviders || []), 'email'])];
    }
    await user.save();
    await audit(req, 'profile.contact_verified', { detail: { channel, target: maskContact(target) } });
    res.json({ ok: true, ...(await profileView(req)) });
  }));

  // Controlled unlink: never leave an account without a verified login identity.
  r.post('/contact/unlink', wrap(async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const channel = req.body?.channel === 'mobile' ? 'mobile' : 'email';
    const auth = await verifyReauth(user, req.body || {});
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error, code: auth.code });
    if (channel === 'email' && user.googleSub) return res.status(409).json({ error: 'This email is linked to Google. Link another login method before unlinking it.', code: 'google_email_locked' });
    const otherVerified = channel === 'email' ? Boolean(user.mobileVerified && user.mobile) : Boolean(user.emailVerified && user.email);
    if (!otherVerified) return res.status(409).json({ error: 'Link and verify another email or mobile before unlinking the last identifier.', code: 'last_identifier' });
    if (channel === 'email') { user.email = null; user.emailVerified = false; }
    else { user.mobile = null; user.mobileVerified = false; }
    user.authProviders = (user.authProviders || []).filter(p => p !== channel);
    await user.save();
    // save() may still persist email: null; the unique index must not keep that null.
    if (channel === 'email') await User.collection.updateOne({ _id: user._id }, { $unset: { email: '' } });
    await audit(req, 'profile.contact_unlinked', { detail: { channel } });
    res.json({ ok: true, ...(await profileView(req)) });
  }));

  r.get('/registration-confirmation', wrap(async (req, res) => {
    const doc = await ensureConfirmation(req);
    res.json(pubConfirmation(doc));
  }));

  r.get('/registration-confirmation/history', wrap(async (req, res) => {
    const doc = await ensureConfirmation(req);
    res.json({
      confirmationNumber: doc.confirmationNumber,
      isPaymentReceipt: false,
      delivery: {
        status: doc.delivery?.status || 'pending',
        attempts: doc.delivery?.attempts || 0,
        lastAttemptAt: doc.delivery?.lastAttemptAt || null,
        sentAt: doc.delivery?.sentAt || null,
        history: doc.delivery?.history || [],
      },
    });
  }));

  r.get('/registration-confirmation/download', wrap(async (req, res) => {
    const doc = await ensureConfirmation(req);
    const lib = await Library.findOne({ libraryId: req.tenantId }).lean();
    const format = String(req.query?.format || 'txt').toLowerCase();
    if (format === 'pdf') {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="registration-confirmation-${doc.confirmationNumber}.pdf"`);
      return res.send(registrationConfirmationPdf(doc, lib));
    }
    const text = registrationConfirmationText(doc, lib);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="registration-confirmation-${doc.confirmationNumber}.txt"`);
    res.send(text);
  }));

  r.post('/registration-confirmation/retry', wrap(async (req, res) => {
    const user = await User.findById(req.user.id).lean();
    if (user && await throttleHit(`confirmation-retry:${user._id}`, 3, 15 * 60e3)) {
      return res.status(429).json({ error: 'Too many retries. Try again later.' });
    }
    const doc = await ensureConfirmation(req);
    const updated = await deliverRegistrationConfirmation(doc._id);
    res.json(pubConfirmation(updated));
  }));

  // Google-only/mobile-only owners can create a password after proving the verified channel.
  r.post('/password/setup/start', wrap(async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const requested = req.body?.via === 'mobile' ? 'mobile' : req.body?.via === 'email' ? 'email' : null;
    let via = requested || (user.emailVerified && user.email ? 'email' : (user.mobileVerified && user.mobile ? 'mobile' : null));
    if (!via) return res.status(400).json({ error: 'Verify an email or mobile number first', code: 'no_verified_channel' });
    if (via === 'mobile' && (!user.mobileVerified || !user.mobile)) return res.status(400).json({ error: 'That mobile number is not verified on this account', code: 'verified_channel_required' });
    if (via === 'email' && (!user.emailVerified || !user.email)) return res.status(400).json({ error: 'That email is not verified on this account', code: 'verified_channel_required' });
    if (via === 'mobile' && !smsConfigured()) return res.status(503).json({ error: 'Mobile verification is not configured. No email fallback was used.', code: 'mobile_otp_not_configured' });
    if (via === 'email' && !emailConfigured()) return res.status(503).json({ error: 'Email delivery is not configured.', code: 'email_not_configured' });
    if (await throttleHit(`pwsetup:user:${user._id}`, 5, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    if (await throttleHit(`pwsetup:resend:${user._id}:${via}`, 1, 60e3)) return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await PasswordSetupOtp.updateMany({ userId: String(user._id), usedAt: null }, { $set: { usedAt: new Date() } });
    await PasswordSetupOtp.create({ userId: String(user._id), via, codeHash: sha(`${user._id}:${via}:${code}`), expiresAt: minutes(10) });
    const target = via === 'mobile' ? user.mobile : user.email;
    let result;
    if (via === 'mobile') result = await sendMobileMessage({ to: target, text: `Your My Library OS password setup code is ${code}. It expires in 10 minutes.` });
    else {
      try {
        const sent = await sendMail({ to: target, subject: 'Your My Library OS password setup code', text: `Your password setup code is ${code}. It expires in 10 minutes.` });
        result = { sent: Boolean(sent) || process.env.NODE_ENV === 'test', reason: sent ? null : 'email_delivery_failed' };
      } catch { result = { sent: false, reason: 'email_delivery_failed' }; }
    }
    if (!result.sent) {
      await PasswordSetupOtp.updateMany({ userId: String(user._id), usedAt: null }, { $set: { usedAt: new Date() } });
      return res.status(503).json({ error: 'Could not deliver the password setup code', code: result.reason || 'delivery_failed' });
    }
    res.json({ ok: true, via, sentTo: maskIdentifier(target) });
  }));

  r.post('/password/setup/complete', wrap(async (req, res) => {
    const { code, newPassword } = req.body || {};
    if (!validatePassword(newPassword)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (await throttleHit(`pwsetup-complete:user:${user._id}`, 10, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const bad = () => res.status(400).json({ error: 'Invalid or expired code', code: 'invalid_code' });
    const rec = await PasswordSetupOtp.findOne({ userId: String(user._id), usedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!rec || rec.attempts >= 5) return bad();
    if (rec.codeHash !== sha(`${user._id}:${rec.via}:${String(code || '').trim()}`)) { rec.attempts += 1; await rec.save(); return bad(); }
    const claimed = await PasswordSetupOtp.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) return bad();
    user.passwordHash = await hashPassword(newPassword);
    user.authProviders = [...new Set([...(user.authProviders || []), 'password'])];
    await user.save();
    await audit(req, 'password.setup_completed', { via: rec.via });
    res.json({ ok: true });
  }));

  return r;
}

/** Link a verified Google identity to the authenticated profile (email must match). */
export async function verifyGoogleForProfile(req) {
  if (!req.body?.credential || !googleEnabled()) return null;
  const g = await verifyGoogleIdToken(req.body.credential);
  const user = await User.findById(req.user.id);
  if (!user || normalizeEmail(user.email) !== normalizeEmail(g.email)) return null;
  user.googleSub = g.sub;
  user.emailVerified = true;
  user.authProviders = [...new Set([...(user.authProviders || []), 'google'])];
  await user.save();
  return user;
}

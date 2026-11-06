/**
 * Staff invitations (expiring one-time links) and password reset by email OTP
 * (spec §2, AUTH-02/AUTH-03), plus the owner-visible audit log (§1).
 * Tokens and OTPs are stored only as SHA-256 hashes and never logged.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import express from 'express';
import bcrypt from 'bcryptjs';
import { User, Library, isPlatformRole } from './models.js';
import { hashPassword, validatePassword } from './services.js';
import { sendMail } from './mailer.js';
import { sendMobileMessage, smsConfigured } from './messaging.js';
import { normalizeMobile, isMobile } from './identity.js';
import { throttleHit } from './throttle.js';
import { audit, AuditLog, pubAudit } from './audit.js';
import { requireRole } from './auth.js';
import { checkStaffLimit } from './plans.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const frontendUrl = () => (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/+$/, '');
const INVITE_HOURS = () => Number(process.env.INVITE_EXPIRY_HOURS || 72);
const OTP_MINUTES = () => Number(process.env.OTP_EXPIRY_MINUTES || 10);

const inviteSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  email: { type: String, lowercase: true, trim: true },
  name: String,
  role: { type: String, enum: ['staff', 'client_admin'], default: 'staff' },
  staffId: String, // links to staffMembers.id (holds the owner-assigned permissions)
  permissions: mongoose.Schema.Types.Mixed,
  expiresAt: { type: Date, required: true },
  usedAt: Date, usedBy: String, revokedAt: Date,
  createdBy: String,
}, { timestamps: true });
export const Invite = mongoose.models.Invite || mongoose.model('Invite', inviteSchema);

const otpSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  usedAt: Date,
  ip: String,
  channel: { type: String, enum: ['email', 'mobile'], default: 'email' },
  mobile: String,
}, { timestamps: true });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const PasswordResetOtp = mongoose.models.PasswordResetOtp || mongoose.model('PasswordResetOtp', otpSchema);

const inviteStatus = (i) => i.usedAt ? 'accepted' : i.revokedAt ? 'revoked' : i.expiresAt < new Date() ? 'expired' : 'pending';
const pubInvite = (i) => ({ id: String(i._id), email: i.email, name: i.name, role: i.role, staffId: i.staffId, expiresAt: i.expiresAt, status: inviteStatus(i), createdAt: i.createdAt });

/* Simple in-memory per-key rate limiter (per instance). */
const hits = new Map();
export function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
export const resetRateLimits = () => hits.clear();

const mask = (email) => email.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.min(b.length, 6)) + c);

/** Public (unauthenticated) routes. */
/**
 * Issue #13: the one place an invite becomes an account (password or Google).
 * Atomic single use; the account is bound to the invited email, library and role.
 * With `google`, the verified Google email must equal the invited email.
 */
export async function acceptInvite({ token, name, passwordHash, google, ip }) {
  const now = new Date();
  const i = await Invite.findOneAndUpdate({ tokenHash: sha(token), usedAt: null, revokedAt: null, expiresAt: { $gt: now } }, { $set: { usedAt: now } }, { new: true });
  if (!i) return { status: 410, error: 'This invite link is invalid, expired or already used', code: 'invite_invalid' };
  const release = () => Invite.updateOne({ _id: i._id }, { $set: { usedAt: null } });
  if (google && String(google.email).toLowerCase() !== i.email) {
    await release();
    return { status: 403, error: `This invite is for ${i.email}. Sign in to Google with that email.`, code: 'invite_email_mismatch' };
  }
  const lib = await Library.findOne({ libraryId: i.tenantId }).lean();
  if (!lib || lib.status !== 'Active') { await release(); return { status: 403, error: 'Library is disabled', code: 'library_disabled' }; }
  if (i.role === 'staff') {
    try { await checkStaffLimit(i.tenantId, { Invite }); }
    catch (e) { await release(); return { status: e.status || 409, error: e.message, code: e.code || 'staff_limit' }; }
  }
  if (await User.exists({ email: i.email })) {
    await release();
    return { status: 409, error: 'An account with this email already exists. Sign in instead.', code: 'account_exists' };
  }
  const user = await User.create({
    email: i.email, name: name || i.name || google?.name || '', role: i.role, tenantId: i.tenantId, libraryId: i.tenantId, staffId: i.staffId,
    ...(passwordHash ? { passwordHash } : {}),
    ...(google ? { googleSub: google.sub } : {}),
    authProviders: [google ? 'google' : 'password'],
  });
  await Invite.updateOne({ _id: i._id }, { $set: { usedBy: String(user._id) } });
  await audit({ user: { id: String(user._id), email: user.email, role: user.role }, ip }, 'invite.accepted', { tenantId: i.tenantId, target: i.email, detail: { via: google ? 'google' : 'password' } });
  return { user };
}

export function createPublicAccountRouter({ issueSession }) {
  const r = express.Router();

  r.get('/auth/invite/:token', wrap(async (req, res) => {
    const i = await Invite.findOne({ tokenHash: sha(req.params.token) }).lean();
    if (!i || inviteStatus(i) !== 'pending') return res.status(410).json({ error: 'This invite link is invalid, expired or already used', code: i ? inviteStatus(i) : 'invalid' });
    const lib = await Library.findOne({ libraryId: i.tenantId }).lean();
    res.json({ email: i.email, name: i.name, role: i.role, library: lib?.name, expiresAt: i.expiresAt });
  }));

  r.post('/auth/invite/accept', wrap(async (req, res) => {
    const { token, name, password } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required' });
    if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const r = await acceptInvite({ token, name, passwordHash: await hashPassword(password), ip: req.ip });
    if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
    return issueSession(r.user, res);
  }));

  // Always answers the same way so it cannot be used to discover accounts.
  r.post('/auth/forgot-password', wrap(async (req, res) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const generic = { ok: true, message: 'If this email is registered, a reset code has been sent.' };
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (rateLimited(`ip:${req.ip}`, 10, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    if (rateLimited(`fp:${email}`, 1, 60e3)) return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    if (await throttleHit(`forgot-email:${email}`, 5, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    const user = await User.findOne({ email }).lean();
    if (!user || user.status !== 'Active') return res.json(generic); // disabled accounts cannot recover
    if (!isPlatformRole(user.role)) {
      const lib = await Library.findOne({ libraryId: user.tenantId || user.libraryId }).lean();
      if (!lib || lib.status !== 'Active') return res.json(generic);
    }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await PasswordResetOtp.updateMany({ userId: String(user._id), usedAt: null }, { $set: { usedAt: new Date() } }); // old codes stop working
    await PasswordResetOtp.create({ userId: String(user._id), codeHash: sha(`${user._id}:${code}`), expiresAt: new Date(Date.now() + OTP_MINUTES() * 60e3), ip: req.ip });
    await sendMail({ to: user.email, subject: 'Your Library OS password reset code',
      text: `Your password reset code is ${code}. It expires in ${OTP_MINUTES()} minutes. If you did not ask for this, ignore this email.` });
    await audit({ user: { id: String(user._id), email: user.email, role: user.role }, ip: req.ip }, 'password.reset_requested', { tenantId: user.tenantId || null, target: mask(user.email) });
    res.json(generic);
  }));

  // Issue #15: password recovery by verified mobile (no silent email fallback).
  r.post('/auth/forgot-password-mobile', wrap(async (req, res) => {
    const mobile = normalizeMobile(req.body?.mobile);
    const generic = { ok: true, message: 'If this mobile number is registered, a reset code has been sent.' };
    if (!isMobile(mobile)) return res.status(400).json({ error: 'A valid mobile number is required' });
    if (!smsConfigured()) return res.status(503).json({ error: 'Mobile verification is not configured. Contact support.', code: 'mobile_otp_not_configured' });
    if (rateLimited(`fmp:${req.ip}`, 10, 15 * 60e3)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    if (await throttleHit(`forgot-mobile:${mobile}`, 3, 60e3)) return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    const user = await User.findOne({ mobile }).lean();
    if (!user || user.status !== 'Active') return res.json(generic);
    if (!isPlatformRole(user.role)) {
      const lib = await Library.findOne({ libraryId: user.tenantId || user.libraryId }).lean();
      if (!lib || lib.status !== 'Active') return res.json(generic);
    }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    await PasswordResetOtp.updateMany({ userId: String(user._id), usedAt: null }, { $set: { usedAt: new Date() } });
    await PasswordResetOtp.create({ userId: String(user._id), mobile, channel: 'mobile', codeHash: sha(`${user._id}:${code}`), expiresAt: new Date(Date.now() + OTP_MINUTES() * 60e3), ip: req.ip });
    await sendMobileMessage({ to: mobile, text: `Your Library OS password reset code is ${code}. It expires in ${OTP_MINUTES()} minutes. If you did not ask for this, ignore this message.` });
    await audit({ user: { id: String(user._id), email: user.email, role: user.role }, ip: req.ip }, 'password.reset_requested', { tenantId: user.tenantId || null, target: `••••${mobile.slice(-4)}` });
    res.json(generic);
  }));

  r.post('/auth/reset-password-mobile', wrap(async (req, res) => {
    const mobile = normalizeMobile(req.body?.mobile);
    const { otp, newPassword } = req.body || {};
    if (!isMobile(mobile) || !otp) return res.status(400).json({ error: 'mobile and code are required' });
    if (!validatePassword(newPassword)) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    if (rateLimited(`rpm:${req.ip}`, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const bad = () => res.status(400).json({ error: 'Invalid or expired code' });
    const user = await User.findOne({ mobile }).select('+passwordHash');
    if (!user || user.status !== 'Active') return bad();
    const rec = await PasswordResetOtp.findOne({ userId: String(user._id), channel: 'mobile', usedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!rec) return bad();
    if (rec.attempts >= 5) { rec.usedAt = new Date(); await rec.save(); return res.status(429).json({ error: 'Too many wrong codes. Request a new one.' }); }
    const ok = rec.codeHash === sha(`${user._id}:${String(otp).trim()}`);
    if (!ok) { rec.attempts += 1; await rec.save(); return bad(); }
    const claimed = await PasswordResetOtp.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) return bad();
    user.passwordHash = await hashPassword(newPassword);
    user.authProviders = [...new Set([...(user.authProviders || []), 'password'])];
    user.passwordChangedAt = new Date();
    await user.save();
    await audit({ user: { id: String(user._id), email: user.email, role: user.role }, ip: req.ip }, 'password.reset_completed', { tenantId: user.tenantId || null, via: 'mobile' });
    res.json({ ok: true });
  }));

  r.post('/auth/reset-password', wrap(async (req, res) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const { otp, newPassword } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: 'email and code are required' });
    if (!validatePassword(newPassword)) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    if (rateLimited(`rp:${req.ip}`, 20, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const bad = () => res.status(400).json({ error: 'Invalid or expired code' });
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || user.status !== 'Active') return bad();
    const rec = await PasswordResetOtp.findOne({ userId: String(user._id), usedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!rec) return bad();
    if (rec.attempts >= 5) { rec.usedAt = new Date(); await rec.save(); return res.status(429).json({ error: 'Too many wrong codes. Request a new one.' }); }
    const ok = crypto.timingSafeEqual(Buffer.from(rec.codeHash), Buffer.from(sha(`${user._id}:${String(otp).trim()}`)));
    if (!ok) { rec.attempts += 1; await rec.save(); return bad(); }
    const claimed = await PasswordResetOtp.findOneAndUpdate({ _id: rec._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) return bad();
    user.passwordHash = await hashPassword(newPassword);
    user.authProviders = [...new Set([...(user.authProviders || []), 'password'])];
    user.passwordChangedAt = new Date();
    await user.save();
    await audit({ user: { id: String(user._id), email: user.email, role: user.role }, ip: req.ip }, 'password.reset_completed', { tenantId: user.tenantId || null });
    res.json({ ok: true });
  }));
  return r;
}

/** Tenant routes (mounted after requireAuth + tenantScope). */
export function createTenantAccountRouter() {
  const r = express.Router();
  const owner = requireRole('client_admin', 'superadmin');

  r.get('/invites', owner, wrap(async (req, res) => {
    res.json((await Invite.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).lean()).map(pubInvite));
  }));

  r.post('/invites', owner, wrap(async (req, res) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (await User.exists({ email })) return res.status(409).json({ error: 'This email already has an account' });
    const role = req.body?.role === 'client_admin' ? 'client_admin' : 'staff';
    if (role === 'staff') await checkStaffLimit(req.tenantId, { Invite, excludeEmail: email }); // Issue #14
    const hours = Math.min(Math.max(Number(req.body?.expiresInHours || INVITE_HOURS()), 1), 24 * 14);
    await Invite.updateMany({ tenantId: req.tenantId, email, usedAt: null, revokedAt: null }, { $set: { revokedAt: new Date() } }); // one live invite per email
    const token = crypto.randomBytes(32).toString('base64url');
    const inv = await Invite.create({ tenantId: req.tenantId, tokenHash: sha(token), email, name: req.body?.name, role, staffId: req.body?.staffId, permissions: req.body?.permissions, expiresAt: new Date(Date.now() + hours * 3600e3), createdBy: req.user.email });
    const link = `${frontendUrl()}/#invite=${token}`;
    const lib = await Library.findOne({ libraryId: req.tenantId }).lean();
    let emailed = false;
    if (req.body?.sendEmail !== false) {
      try { emailed = await sendMail({ to: email, subject: `You're invited to ${lib?.name || 'a library'} on Library OS`, text: `You have been invited to join ${lib?.name || 'a library'} as ${role === 'staff' ? 'staff' : 'an admin'}.\n\nOpen this link to set your password (valid for ${hours} hours, one-time use):\n${link}` }); }
      catch (e) { console.error('[invite] email failed:', e.message); }
    }
    await audit(req, 'invite.created', { target: email, detail: { role, staffId: req.body?.staffId, hours } });
    res.status(201).json({ ...pubInvite(inv), link, emailed });
  }));

  r.post('/invites/:id/revoke', owner, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const i = await Invite.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId, usedAt: null }, { $set: { revokedAt: new Date() } }, { new: true, lean: true });
    if (!i) return res.status(404).json({ error: 'Not found or already used' });
    await audit(req, 'invite.revoked', { target: i.email });
    res.json(pubInvite(i));
  }));

  // Owner sees who did sensitive things in their library, including Super Admin access.
  r.get('/audit-logs', owner, wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const q = { tenantId: req.tenantId };
    if (req.query.action) q.action = String(req.query.action);
    res.json((await AuditLog.find(q).sort({ at: -1 }).limit(limit).lean()).map(pubAudit));
  }));
  return r;
}

/** Super Admin Access Library is audited: once per session-hour on reads, every write. */
const seen = new Map();
export function auditSuperadminAccess(req, _res, next) {
  if (['superadmin', 'partner', 'agent'].includes(req.user?.role) && req.tenantId) {
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const key = `${req.user.id}:${req.tenantId}`;
    const last = seen.get(key) || 0;
    if (write || Date.now() - last > 3600e3) {
      if (!write) seen.set(key, Date.now());
      audit(req, `${req.user.role}.${write ? 'library_write' : 'library_access'}`, { target: `${req.method} ${req.baseUrl}${req.path}`, reason: req.get('X-Access-Reason') || undefined, detail: { readOnly: !!req.readOnly } });
    }
  }
  next();
}
export const resetAccessCache = () => seen.clear();

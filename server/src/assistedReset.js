/**
 * Super Admin assisted password reset for a library owner or staff member.
 * The Super Admin proves their own identity (password, email OTP, or WhatsApp OTP
 * on their registered contacts). The customer's reset code is never accepted.
 * OTPs are stored only as SHA-256 hashes.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import express from 'express';
import bcrypt from 'bcryptjs';
import { User, Library, isPlatformRole } from './models.js';
import { hashPassword, validatePassword } from './services.js';
import { sendMail } from './mailer.js';
import { sendSystemWhatsapp } from './systemWhatsapp.js';
import { throttleHit } from './throttle.js';
import { audit } from './audit.js';
import { requireRole } from './auth.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const OTP_MINUTES = 10;
const METHODS = ['password', 'email', 'whatsapp'];

const challengeSchema = new mongoose.Schema({
  actorId: { type: String, required: true, index: true },
  targetUserId: { type: String, required: true, index: true },
  libraryId: { type: String, required: true },
  method: { type: String, enum: METHODS, required: true },
  reason: { type: String, required: true },
  codeHash: String,
  attempts: { type: Number, default: 0 },
  usedAt: Date,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
export const SaResetChallenge = mongoose.models.SaResetChallenge || mongoose.model('SaResetChallenge', challengeSchema);

const maskEmail = (email) => String(email || '').replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.min(b.length, 6)) + c);
const maskMobile = (m) => (m ? `••••${String(m).slice(-4)}` : '');

async function loadTarget(userId, libraryId) {
  if (!userId || !libraryId) return { status: 400, error: 'userId and libraryId are required' };
  if (!mongoose.isValidObjectId(userId)) return { status: 404, error: 'User not found' };
  const lib = await Library.findOne({ libraryId }).lean();
  if (!lib) return { status: 404, error: 'Library not found' };
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) return { status: 404, error: 'User not found' };
  if (isPlatformRole(user.role)) return { status: 403, error: 'A platform account cannot be reset this way', code: 'platform_user' };
  if (user.role !== 'client_admin' && user.role !== 'staff') return { status: 403, error: 'Only a library owner or staff password can be reset', code: 'role_not_allowed' };
  const tenantId = user.tenantId || user.libraryId;
  if (tenantId !== libraryId) return { status: 400, error: 'That user does not belong to this library', code: 'library_mismatch' };
  if (user.status !== 'Active' || lib.status !== 'Active') return { status: 403, error: 'The user or library is disabled' };
  return { user, lib };
}

export function createAssistedResetRouter() {
  const r = express.Router();
  r.use(requireRole('superadmin'));

  r.post('/assisted-password-reset/start', wrap(async (req, res) => {
    const method = String(req.body?.method || '');
    const reason = String(req.body?.reason || '').trim();
    if (!METHODS.includes(method)) return res.status(400).json({ error: 'method must be password, email, or whatsapp' });
    if (reason.length < 3 || reason.length > 500) return res.status(400).json({ error: 'A reason (3–500 characters) is required' });
    const actor = await User.findById(req.user.id).select('+passwordHash');
    if (!actor || actor.role !== 'superadmin' || actor.status !== 'Active') return res.status(403).json({ error: 'Forbidden' });
    const found = await loadTarget(req.body?.userId, req.body?.libraryId);
    if (found.error) return res.status(found.status).json({ error: found.error, ...(found.code ? { code: found.code } : {}) });
    if (await throttleHit(`sa-reset:actor:${actor._id}`, 5, 15 * 60e3)) return res.status(429).json({ error: 'Too many reset attempts. Try again later.' });
    if (await throttleHit(`sa-reset:target:${found.user._id}`, 3, 15 * 60e3)) return res.status(429).json({ error: 'Too many reset attempts for this user. Try again later.' });

    let codeHash;
    let sentTo = null;
    if (method === 'password') {
      if (!actor.passwordHash) return res.status(400).json({ error: 'This Super Admin account has no password. Use email or WhatsApp.', code: 'no_password' });
    } else {
      if (await throttleHit(`sa-reset:resend:${actor._id}:${method}`, 1, 30e3)) return res.status(429).json({ error: 'Please wait 30 seconds before requesting another code.' });
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      codeHash = sha(`${actor._id}:sa-stepup:${method}:${code}`);
      if (method === 'email') {
        if (!actor.email) return res.status(400).json({ error: 'This Super Admin account has no email.', code: 'no_email' });
        await sendMail({
          to: actor.email,
          subject: 'Your My Library OS Super Admin verification code',
          text: `Your Super Admin verification code is ${code}. It expires in ${OTP_MINUTES} minutes. It confirms a password reset you started. If you did not ask for this, ignore this email.`,
        });
        sentTo = maskEmail(actor.email);
      } else {
        if (!actor.mobile) return res.status(400).json({ error: 'This Super Admin account has no WhatsApp number.', code: 'no_mobile' });
        const sent = await sendSystemWhatsapp({
          to: actor.mobile,
          text: `Your My Library OS Super Admin verification code is ${code}. It expires in ${OTP_MINUTES} minutes.`,
        });
        if (!sent.sent) return res.status(503).json({ error: 'Could not send the WhatsApp code.', code: sent.reason || 'not_sent' });
        sentTo = maskMobile(actor.mobile);
      }
    }

    await SaResetChallenge.updateMany({ actorId: String(actor._id), usedAt: null }, { $set: { usedAt: new Date() } });
    const challenge = await SaResetChallenge.create({
      actorId: String(actor._id),
      targetUserId: String(found.user._id),
      libraryId: found.lib.libraryId,
      method,
      reason,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_MINUTES * 60e3),
    });
    res.json({ ok: true, challengeId: String(challenge._id), method, sentTo });
  }));

  r.post('/assisted-password-reset/complete', wrap(async (req, res) => {
    const { challengeId, proof, newPassword } = req.body || {};
    if (!challengeId || proof == null || proof === '') return res.status(400).json({ error: 'challengeId and verification are required' });
    if (!validatePassword(newPassword)) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    const actor = await User.findById(req.user.id).select('+passwordHash');
    if (!actor || actor.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
    if (await throttleHit(`sa-reset-complete:actor:${actor._id}`, 8, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const bad = () => res.status(400).json({ error: 'Verification failed', code: 'step_up_failed' });
    if (!mongoose.isValidObjectId(challengeId)) return bad();
    const challenge = await SaResetChallenge.findOne({ _id: challengeId, actorId: String(actor._id), usedAt: null, expiresAt: { $gt: new Date() } });
    if (!challenge) return bad();
    if (await throttleHit(`sa-reset-complete:target:${challenge.targetUserId}`, 8, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    if (challenge.attempts >= 5) {
      challenge.usedAt = new Date();
      await challenge.save();
      return res.status(429).json({ error: 'Too many wrong attempts. Start again.' });
    }
    let ok = false;
    if (challenge.method === 'password') {
      ok = Boolean(actor.passwordHash) && await bcrypt.compare(String(proof), actor.passwordHash);
    } else {
      const digest = sha(`${actor._id}:sa-stepup:${challenge.method}:${String(proof).trim()}`);
      ok = Boolean(challenge.codeHash) && challenge.codeHash.length === digest.length && crypto.timingSafeEqual(Buffer.from(challenge.codeHash), Buffer.from(digest));
    }
    if (!ok) {
      challenge.attempts += 1;
      await challenge.save();
      return bad();
    }
    const found = await loadTarget(challenge.targetUserId, challenge.libraryId);
    if (found.error) return res.status(found.status).json({ error: found.error, ...(found.code ? { code: found.code } : {}) });
    const target = found.user;
    if (target.passwordHash && await bcrypt.compare(String(newPassword), target.passwordHash)) {
      return res.status(400).json({ error: 'New password must be different from the current one' });
    }
    const claimed = await SaResetChallenge.findOneAndUpdate({ _id: challenge._id, usedAt: null }, { $set: { usedAt: new Date() } });
    if (!claimed) return bad();
    target.passwordHash = await hashPassword(newPassword);
    target.authProviders = [...new Set([...(target.authProviders || []), 'password'])];
    target.passwordChangedAt = new Date();
    target.tokenVersion = (target.tokenVersion ?? 0) + 1;
    await target.save();
    await audit(req, 'superadmin.assisted_password_reset', {
      tenantId: challenge.libraryId,
      target: target.email || target.mobile || String(target._id),
      reason: challenge.reason,
      detail: { method: challenge.method, targetUserId: String(target._id), targetRole: target.role },
    });
    const notify = { email: false, whatsapp: false };
    if (target.email) {
      try {
        await sendMail({
          to: target.email,
          subject: 'Your My Library OS password was reset',
          text: 'A Super Admin reset the password on your My Library OS account. Sign in with the new password you were given. If you did not expect this, contact support.',
        });
        notify.email = true;
      } catch (e) {
        console.error('[assisted-reset] notify email failed:', e.message);
      }
    }
    if (target.mobile) {
      try {
        const sent = await sendSystemWhatsapp({
          to: target.mobile,
          text: 'A Super Admin reset the password on your My Library OS account. If you did not expect this, contact support.',
        });
        notify.whatsapp = Boolean(sent.sent);
        if (!sent.sent) console.error('[assisted-reset] notify whatsapp failed:', sent.reason || 'not_sent');
      } catch (e) {
        console.error('[assisted-reset] notify whatsapp failed:', e.message);
      }
    }
    res.json({ ok: true, userId: String(target._id), notify });
  }));

  return r;
}

// One free trial per identity. Stores only hashes — never the email, phone or Google sub.
import crypto from 'crypto';
import mongoose from 'mongoose';
import { User, Library } from './models.js';
import { normalizeEmail } from './identity.js';

export const TRIAL_USED_MESSAGE = 'Free trial already used with this email/phone/Google account. Choose a plan to continue.';

const NS = 'mylibraryos.trial.v1';

const trialSchema = new mongoose.Schema({
  kind: { type: String, enum: ['email', 'phone', 'google'], required: true },
  hash: { type: String, required: true, unique: true },
}, { timestamps: true });
export const TrialUsage = mongoose.models.TrialUsage || mongoose.model('TrialUsage', trialSchema);

/**
 * Lowercase, trim. Gmail and googlemail.com drop dots and +tags, and googlemail.com
 * is folded to gmail.com because both domains are the same mailbox.
 */
export function normalizeTrialEmail(value) {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return `${local}@${domain}`;
}

/** Digits only. Indian mobiles (10 digits, or leading 0 / 91) become 91XXXXXXXXXX. */
export function normalizeTrialPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

export function indianMobile91(value) {
  const n = normalizeTrialPhone(value);
  return /^91[6-9]\d{9}$/.test(n) ? n : null;
}

function pepper() {
  return process.env.TRIAL_HASH_PEPPER || process.env.IDENTITY_PEPPER || '';
}

/** HMAC-SHA256 when a pepper env is set; otherwise SHA-256 of a fixed namespace prefix. */
export function hashTrialValue(kind, normalized) {
  const payload = `${NS}:${kind}:${normalized}`;
  const secret = pepper();
  if (secret) return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function phoneForms(normalized) {
  const forms = new Set([normalized]);
  if (normalized.startsWith('91') && normalized.length === 12) {
    const ten = normalized.slice(2);
    forms.add(ten);
    forms.add(`0${ten}`);
  }
  return [...forms];
}

export async function recordTrialIdentifiers({ email, mobile, googleSub } = {}) {
  const docs = [];
  const mail = email ? normalizeTrialEmail(email) : '';
  const phone = mobile ? normalizeTrialPhone(mobile) : '';
  const sub = googleSub ? String(googleSub) : '';
  if (mail.includes('@')) docs.push({ kind: 'email', hash: hashTrialValue('email', mail) });
  if (phone) docs.push({ kind: 'phone', hash: hashTrialValue('phone', phone) });
  if (sub) docs.push({ kind: 'google', hash: hashTrialValue('google', sub) });
  if (!docs.length) return;
  await TrialUsage.bulkWrite(docs.map(d => ({
    updateOne: { filter: { hash: d.hash }, update: { $setOnInsert: d }, upsert: true },
  })), { ordered: false });
}

async function gmailOwners(normalized) {
  const users = await User.find({ email: { $regex: '@(gmail\\.com|googlemail\\.com)$' } }).select('email mobile googleSub status').lean();
  const libs = await Library.find({ contactEmail: { $regex: '@(gmail\\.com|googlemail\\.com)$' } }).select('contactEmail phone libraryId status').lean();
  return {
    users: users.filter(u => normalizeTrialEmail(u.email) === normalized),
    libs: libs.filter(l => normalizeTrialEmail(l.contactEmail) === normalized),
  };
}

/**
 * True when this email, phone or Google sub has already had a trial.
 * Also checks owners and libraries already in the database (any status, including
 * disabled). A match is written into the registry so the next signup is a hash lookup.
 * Call this before the new account is created so the new row is not treated as a match.
 */
export async function trialIdentityUsed({ email, mobile, googleSub } = {}) {
  const mail = email ? normalizeTrialEmail(email) : '';
  const phone = mobile ? normalizeTrialPhone(mobile) : '';
  const sub = googleSub ? String(googleSub) : '';
  const hashes = [];
  if (mail.includes('@')) hashes.push(hashTrialValue('email', mail));
  if (phone) hashes.push(hashTrialValue('phone', phone));
  if (sub) hashes.push(hashTrialValue('google', sub));
  if (hashes.length && await TrialUsage.exists({ hash: { $in: hashes } })) {
    await recordTrialIdentifiers({ email: mail, mobile: phone, googleSub: sub });
    return { used: true, source: 'registry' };
  }

  let found = false;
  const backfill = { email: mail, mobile: phone, googleSub: sub };
  if (mail.includes('@')) {
    const domain = mail.split('@')[1];
    if (domain === 'gmail.com') {
      const hit = await gmailOwners(mail);
      if (hit.users.length || hit.libs.length) found = true;
      for (const u of hit.users) {
        if (u.mobile) backfill.mobile = backfill.mobile || u.mobile;
        if (u.googleSub) backfill.googleSub = backfill.googleSub || u.googleSub;
      }
      for (const l of hit.libs) if (l.phone) backfill.mobile = backfill.mobile || l.phone;
    } else {
      const user = await User.findOne({ email: mail }).select('email mobile googleSub').lean();
      const lib = await Library.findOne({ contactEmail: mail }).select('phone contactEmail').lean();
      if (user || lib) found = true;
      if (user?.mobile) backfill.mobile = backfill.mobile || user.mobile;
      if (user?.googleSub) backfill.googleSub = backfill.googleSub || user.googleSub;
      if (lib?.phone) backfill.mobile = backfill.mobile || lib.phone;
    }
  }
  if (phone) {
    const forms = phoneForms(phone);
    const user = await User.findOne({ mobile: { $in: forms } }).select('email mobile googleSub').lean();
    const lib = await Library.findOne({ phone: { $in: forms } }).select('contactEmail phone').lean();
    if (user || lib) found = true;
    if (user?.email) backfill.email = backfill.email || user.email;
    if (user?.googleSub) backfill.googleSub = backfill.googleSub || user.googleSub;
    if (lib?.contactEmail) backfill.email = backfill.email || lib.contactEmail;
  }
  if (sub) {
    const user = await User.findOne({ googleSub: sub }).select('email mobile googleSub').lean();
    if (user) {
      found = true;
      if (user.email) backfill.email = backfill.email || user.email;
      if (user.mobile) backfill.mobile = backfill.mobile || user.mobile;
    }
  }
  if (!found) return { used: false, source: null };
  await recordTrialIdentifiers(backfill);
  return { used: true, source: 'backfill' };
}

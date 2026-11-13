// One free trial per identity. Stores only hashes — never the email, phone or Google sub.
import crypto from 'crypto';
import mongoose from 'mongoose';
import { User, Library } from './models.js';
import { AuditLog } from './audit.js';
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

const OWNER_ROLE = 'client_admin';
/** Cap the Gmail scan when a precise local-part pattern cannot be built. */
const GMAIL_FALLBACK_LIMIT = 200;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Full-email pattern for a normalised Gmail local part.
 * Dots between characters are optional and a +tag may follow.
 * Returns null when the local part is empty or too long to compile safely.
 */
export function gmailVariantPattern(normalizedLocal) {
  const local = String(normalizedLocal || '');
  if (!local || local.length > 64) return null;
  const body = [...local].map(escapeRegExp).join('\\.?');
  return `^${body}(\\+.*)?@(gmail\\.com|googlemail\\.com)$`;
}

function sameMail(value, normalized) {
  return Boolean(value) && normalizeTrialEmail(value) === normalized;
}

function rememberContact(backfill, { email, mobile, googleSub } = {}) {
  if (email) backfill.email = backfill.email || email;
  if (mobile) backfill.mobile = backfill.mobile || mobile;
  if (googleSub) backfill.googleSub = backfill.googleSub || googleSub;
}

/**
 * Owners (any status) and library contact addresses, including a deleted library
 * whose contact was kept on the deletion proof. Never staff, partners or agents.
 */
async function matchEmail(normalized) {
  const local = normalized.split('@')[0];
  const domain = normalized.split('@')[1];
  const pattern = domain === 'gmail.com' ? gmailVariantPattern(local) : null;
  const userSelect = 'email mobile googleSub role status';
  const libSelect = 'contactEmail phone libraryId status';
  if (domain !== 'gmail.com') {
    const [user, lib, deleted] = await Promise.all([
      User.findOne({ role: OWNER_ROLE, email: normalized }).select(userSelect).lean(),
      Library.findOne({ contactEmail: normalized }).select(libSelect).lean(),
      AuditLog.findOne({ action: 'library.deleted', 'detail.contactEmail': normalized }).select('detail').lean(),
    ]);
    return { users: user ? [user] : [], libs: lib ? [lib] : [], deleted };
  }
  if (pattern) {
    const re = { $regex: pattern, $options: 'i' };
    const [users, libs, deletedRows] = await Promise.all([
      User.find({ role: OWNER_ROLE, email: re }).select(userSelect).limit(20).lean(),
      Library.find({ contactEmail: re }).select(libSelect).limit(20).lean(),
      AuditLog.find({ action: 'library.deleted', 'detail.contactEmail': re }).select('detail').limit(20).lean(),
    ]);
    return {
      users: users.filter(u => sameMail(u.email, normalized)),
      libs: libs.filter(l => sameMail(l.contactEmail, normalized)),
      deleted: deletedRows.find(d => sameMail(d.detail?.contactEmail, normalized)) || null,
    };
  }
  const domainRe = { $regex: '@(gmail\\.com|googlemail\\.com)$', $options: 'i' };
  const [users, libs, deletedRows] = await Promise.all([
    User.find({ role: OWNER_ROLE, email: domainRe }).select(userSelect).limit(GMAIL_FALLBACK_LIMIT).lean(),
    Library.find({ contactEmail: domainRe }).select(libSelect).limit(GMAIL_FALLBACK_LIMIT).lean(),
    AuditLog.find({ action: 'library.deleted', 'detail.contactEmail': domainRe }).select('detail').limit(GMAIL_FALLBACK_LIMIT).lean(),
  ]);
  return {
    users: users.filter(u => sameMail(u.email, normalized)),
    libs: libs.filter(l => sameMail(l.contactEmail, normalized)),
    deleted: deletedRows.find(d => sameMail(d.detail?.contactEmail, normalized)) || null,
  };
}

/** 10-digit Indian mobile, allowing +91 / 0 and separators between digits. */
function loosePhoneRegex(normalized) {
  const ten = String(normalized || '').slice(-10);
  const body = [...ten].map(escapeRegExp).join('\\D*');
  return `^(?:\\+?91|0)?\\D*${body}$`;
}

async function matchPhone(normalized) {
  const forms = phoneForms(normalized);
  const re = { $regex: loosePhoneRegex(normalized) };
  const phoneClause = { $or: [{ phone: { $in: forms } }, { phone: re }] };
  const mobileClause = { role: OWNER_ROLE, $or: [{ mobile: { $in: forms } }, { mobile: re }] };
  const [users, libs, deletedRows] = await Promise.all([
    User.find(mobileClause).select('email mobile googleSub role').limit(10).lean(),
    Library.find(phoneClause).select('contactEmail phone').limit(10).lean(),
    AuditLog.find({
      action: 'library.deleted',
      $or: [{ 'detail.phone': { $in: forms } }, { 'detail.phone': re }],
    }).select('detail').limit(10).lean(),
  ]);
  return {
    user: users.find(u => normalizeTrialPhone(u.mobile) === normalized) || null,
    lib: libs.find(l => normalizeTrialPhone(l.phone) === normalized) || null,
    deleted: deletedRows.find(d => normalizeTrialPhone(d.detail?.phone) === normalized) || null,
  };
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

/**
 * True when this email, phone or Google sub has already had a trial.
 * Lazy backfill counts only library owners (role client_admin, any status,
 * including disabled) and the contact email or phone of a library that still
 * exists or was deleted (contact kept on the deletion proof). Staff, partners
 * and agents do not count. A match is written into the registry so the next
 * signup is a hash lookup. Call this before the new account is created so the
 * new row is not treated as a match.
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
    const hit = await matchEmail(mail);
    if (hit.users.length || hit.libs.length || hit.deleted) found = true;
    for (const u of hit.users) rememberContact(backfill, u);
    for (const l of hit.libs) rememberContact(backfill, { email: l.contactEmail, mobile: l.phone });
    if (hit.deleted?.detail) rememberContact(backfill, { email: hit.deleted.detail.contactEmail, mobile: hit.deleted.detail.phone });
  }
  if (phone) {
    const hit = await matchPhone(phone);
    if (hit.user || hit.lib || hit.deleted) found = true;
    if (hit.user) rememberContact(backfill, hit.user);
    if (hit.lib) rememberContact(backfill, { email: hit.lib.contactEmail, mobile: hit.lib.phone });
    if (hit.deleted?.detail) rememberContact(backfill, { email: hit.deleted.detail.contactEmail, mobile: hit.deleted.detail.phone });
  }
  if (sub) {
    const user = await User.findOne({ role: OWNER_ROLE, googleSub: sub }).select('email mobile googleSub').lean();
    if (user) {
      found = true;
      rememberContact(backfill, user);
    }
  }
  if (!found) return { used: false, source: null };
  await recordTrialIdentifiers(backfill);
  return { used: true, source: 'backfill' };
}

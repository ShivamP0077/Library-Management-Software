// Public QR enquiry form. Accepts enquiries even when the library plan is locked.
import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import { Library, models, Settings } from './models.js';
import { findPlanChoice, publicEnquiryFormPayload, resolveEnquiryForm } from '../../src/utils/enquiryFormConfig.js';
import { requireRole } from './auth.js';
import { rateLimited } from './accounts.js';
import { EMAIL_RE } from './identity.js';
import { indianMobile91 } from './trialUsage.js';
import tenantGuard from './tenantGuard.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const STATUSES = ['waiting', 'admitted', 'removed'];
const GENDERS = ['male', 'female', 'other'];
const IMAGE_MAX = 500 * 1024;

const enquirySchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  mobile: { type: String, required: true },
  email: { type: String, default: null },
  gender: { type: String, default: '' },
  preferred: { type: String, default: '' },
  branchId: { type: String, default: '' },
  sectionId: { type: String, default: '' },
  aadhaar: { type: String, default: '' },
  photo: { type: String, default: '' },
  message: { type: String, default: '' },
  preferredPlan: { type: String, default: '' },
  status: { type: String, enum: STATUSES, default: 'waiting', index: true },
  source: { type: String, default: 'qr' },
}, { timestamps: true });
enquirySchema.index({ tenantId: 1, mobile: 1, createdAt: -1 });
enquirySchema.plugin(tenantGuard);
export const Enquiry = mongoose.models.Enquiry || mongoose.model('Enquiry', enquirySchema);

export function newEnquiryToken() {
  return crypto.randomBytes(16).toString('base64url');
}

export function enquiryPublicUrl(token) {
  const base = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/+$/, '');
  const path = `/enquiry/${token}`;
  return base ? `${base}${path}` : path;
}

export async function ensureEnquiryToken(libraryId) {
  const lib = await Library.findOne({ libraryId }).select('enquiryToken').lean();
  if (!lib) return null;
  if (lib.enquiryToken) return lib.enquiryToken;
  for (let i = 0; i < 5; i += 1) {
    const token = newEnquiryToken();
    const updated = await Library.findOneAndUpdate(
      { libraryId, $or: [{ enquiryToken: null }, { enquiryToken: { $exists: false } }] },
      { $set: { enquiryToken: token } },
      { new: true },
    ).lean();
    if (updated?.enquiryToken) return updated.enquiryToken;
    const again = await Library.findOne({ libraryId }).select('enquiryToken').lean();
    if (again?.enquiryToken) return again.enquiryToken;
  }
  return null;
}

function pub(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    mobile: doc.mobile,
    email: doc.email || null,
    gender: doc.gender || '',
    preferred: doc.preferred || '',
    branchId: doc.branchId || '',
    sectionId: doc.sectionId || '',
    message: doc.message || '',
    preferredPlan: doc.preferredPlan || '',
    status: doc.status,
    source: doc.source || 'qr',
    createdAt: doc.createdAt,
  };
}

export function parseEnquiryImage(value, label) {
  if (value == null || value === '') return { data: '' };
  const match = String(value).match(/^data:image\/(jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return { error: `${label} must be a JPEG or WebP image` };
  const raw = match[2].replace(/\s/g, '');
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length || buf.length > IMAGE_MAX) return { error: `${label} must be 500 KB or smaller` };
  const mime = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
  return { data: `data:image/${mime};base64,${raw}` };
}

function feePrice(plan) {
  if (Number.isFinite(Number(plan.price))) return Number(plan.price);
  const tiers = Array.isArray(plan.durationPricing) ? plan.durationPricing : [];
  const prices = tiers.map(tier => Number(tier.basePrice)).filter(n => Number.isFinite(n));
  return prices.length ? prices[0] : null;
}

export function publicFeePlan(plan) {
  if (!plan || plan.active === false || !plan.name) return null;
  return { id: String(plan.id || plan._key || plan.name), name: String(plan.name), price: feePrice(plan) };
}

const POSTER_THEMES = new Set(['classic', 'forest', 'sunset', 'ink']);

export function normalizeEnquiryPoster(input = {}) {
  const clip = (value, max) => String(value || '').trim().slice(0, max);
  const phone = clip(input.phone, 40);
  const address = clip(input.address, 180);
  return {
    heading: clip(input.heading, 80),
    message: clip(input.message, 280),
    phone,
    address,
    facilities: clip(input.facilities, 180),
    showPhone: Boolean(input.showPhone) && Boolean(phone),
    showAddress: Boolean(input.showAddress) && Boolean(address),
    showLogo: input.showLogo !== false,
    theme: POSTER_THEMES.has(input.theme) ? input.theme : 'classic',
  };
}

async function catalogue(tenantId) {
  const [plans, branches, sections, settings] = await Promise.all([
    models.plans.find({ tenantId }).lean(),
    models.branches.find({ tenantId }).select('id name').lean(),
    models.sections.find({ tenantId }).select('id name branchId').lean(),
    Settings.findOne({ tenantId }).lean(),
  ]);
  return {
    settings,
    settingsName: typeof settings?.name === 'string' ? settings.name.trim() : '',
    logo: settings?.logo || null,
    plans: plans.map(publicFeePlan).filter(Boolean),
    branches: branches.filter(b => b.id && b.name).map(b => ({ id: b.id, name: b.name })),
    sections: sections.filter(s => s.id && s.name).map(s => ({ id: s.id, name: s.name, branchId: s.branchId || '' })),
  };
}

function pickChoice(field, options, raw, labels) {
  const value = String(raw || '').trim();
  if (!field.show) return { id: '' };
  if (options.length === 1) {
    if (value && value !== options[0].id) return { error: labels.mismatch };
    return { id: options[0].id };
  }
  if (options.length > 1) {
    if (!value) return field.required ? { error: labels.required } : { id: '' };
    if (!options.some((o) => o.id === value)) return { error: labels.required };
    return { id: value };
  }
  if (value) return { error: labels.mismatch };
  return { id: '' };
}

function resolvePlace(form, body) {
  const branch = pickChoice(form.fields.branch, form.branches, body.branchId, { required: 'Choose a branch', mismatch: 'Branch does not match this library' });
  if (branch.error) return branch;
  const forBranch = (form.sections || []).filter((s) => !s.branchId || s.branchId === 'all' || s.branchId === branch.id);
  const section = pickChoice(form.fields.section, forBranch, body.sectionId, { required: 'Choose a section', mismatch: 'Section does not match the branch' });
  if (section.error) return section;
  return { branchId: branch.id, sectionId: section.id };
}

export function createPublicEnquiryRouter() {
  const r = express.Router();

  r.get('/public/enquiry/:token', wrap(async (req, res) => {
    const lib = await Library.findOne({ enquiryToken: req.params.token, status: 'Active' }).select('libraryId name').lean();
    if (!lib) return res.status(404).json({ error: 'Enquiry link not found' });
    const cat = await catalogue(lib.libraryId);
    const form = resolveEnquiryForm(cat.settings, cat);
    res.json({
      libraryName: cat.settingsName || lib.name,
      logo: cat.logo,
      plans: form.plan.show ? cat.plans : [],
      branches: form.fields.branch.show ? form.branches : [],
      sections: form.fields.section.show ? form.sections : [],
      enquiryForm: publicEnquiryFormPayload(form),
    });
  }));

  r.post('/public/enquiry/:token', wrap(async (req, res) => {
    const token = String(req.params.token || '');
    const lib = await Library.findOne({ enquiryToken: token, status: 'Active' }).select('libraryId name').lean();
    if (!lib) return res.status(404).json({ error: 'Enquiry link not found' });
    if (rateLimited(`enquiry:${req.ip}:${token}`, 5, 10 * 60e3)) {
      return res.status(429).json({ error: 'Too many enquiries. Try again later.', code: 'rate_limited' });
    }
    const b = req.body || {};
    if (String(b.website || '').trim()) return res.json({ ok: true });

    const cat = await catalogue(lib.libraryId);
    const form = resolveEnquiryForm(cat.settings, cat);

    const name = String(b.name || '').trim();
    if (!name || name.length > 80) return res.status(400).json({ error: 'Name is required' });
    const mobile = indianMobile91(b.mobile);
    if (!mobile) return res.status(400).json({ error: 'Enter a valid Indian mobile number' });

    const emailRaw = form.fields.email.show ? String(b.email || '').trim().toLowerCase() : '';
    if (form.fields.email.show && form.fields.email.required && !emailRaw) return res.status(400).json({ error: 'Email is required' });
    if (emailRaw && !EMAIL_RE.test(emailRaw)) return res.status(400).json({ error: 'Enter a valid email address' });

    const gender = form.fields.gender.show ? String(b.gender || '').trim().toLowerCase() : '';
    if (form.fields.gender.show && form.fields.gender.required && !GENDERS.includes(gender)) {
      return res.status(400).json({ error: 'Select male, female or other' });
    }
    if (form.fields.gender.show && gender && !GENDERS.includes(gender)) {
      return res.status(400).json({ error: 'Select male, female or other' });
    }

    const message = form.fields.message.show ? String(b.message || '').trim() : '';
    if (form.fields.message.show && form.fields.message.required && !message) return res.status(400).json({ error: 'Message is required' });
    if (message.length > 500) return res.status(400).json({ error: 'Message must be 500 characters or less' });

    const place = resolvePlace(form, b);
    if (place.error) return res.status(400).json({ error: place.error });

    let aadhaar = { data: '' };
    let photo = { data: '' };
    if (form.documents.show) {
      aadhaar = parseEnquiryImage(b.aadhaar, 'Aadhaar');
      if (aadhaar.error) return res.status(400).json({ error: aadhaar.error });
      photo = parseEnquiryImage(b.photo, 'Student photo');
      if (photo.error) return res.status(400).json({ error: photo.error });
      if (form.documents.required && (!aadhaar.data || !photo.data)) {
        return res.status(400).json({ error: 'Please attach the required documents' });
      }
    }

    let preferredPlan = '';
    if (form.plan.show) {
      const rawPlan = String(b.preferredPlan || b.planId || '').trim();
      const chosen = findPlanChoice(cat.plans, rawPlan);
      if (form.plan.required && !chosen) return res.status(400).json({ error: 'Choose a membership plan' });
      if (rawPlan && !chosen) return res.status(400).json({ error: 'Choose a valid membership plan' });
      preferredPlan = chosen ? chosen.id : '';
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await Enquiry.findOne({ tenantId: lib.libraryId, mobile, createdAt: { $gte: since } }).sort({ createdAt: -1 });
    if (existing) {
      existing.name = name;
      existing.email = emailRaw || null;
      existing.gender = gender;
      existing.branchId = place.branchId;
      existing.sectionId = place.sectionId;
      existing.message = message;
      if (form.plan.show) existing.preferredPlan = preferredPlan;
      if (aadhaar.data) existing.aadhaar = aadhaar.data;
      if (photo.data) existing.photo = photo.data;
      await existing.save();
      return res.json({ ok: true });
    }
    await Enquiry.create({
      tenantId: lib.libraryId, name, mobile, email: emailRaw || null, gender,
      branchId: place.branchId, sectionId: place.sectionId,
      aadhaar: aadhaar.data, photo: photo.data, preferredPlan,
      message, status: 'waiting', source: 'qr',
    });
    res.status(201).json({ ok: true });
  }));

  return r;
}

export function createTenantEnquiryRouter() {
  const r = express.Router();
  const owner = requireRole('client_admin', 'superadmin');

  r.get('/enquiries/count', wrap(async (req, res) => {
    const waiting = await Enquiry.countDocuments({ tenantId: req.tenantId, status: 'waiting' });
    res.json({ waiting });
  }));

  r.get('/enquiries/link', owner, wrap(async (req, res) => {
    const token = await ensureEnquiryToken(req.tenantId);
    if (!token) return res.status(404).json({ error: 'Library not found' });
    const settings = await Settings.findOne({ tenantId: req.tenantId }).select('enquiryPoster').lean();
    res.json({ token, url: enquiryPublicUrl(token), poster: normalizeEnquiryPoster(settings?.enquiryPoster || {}) });
  }));

  r.put('/enquiries/poster', owner, wrap(async (req, res) => {
    const poster = normalizeEnquiryPoster(req.body || {});
    await Settings.findOneAndUpdate(
      { tenantId: req.tenantId },
      { $set: { enquiryPoster: poster, tenantId: req.tenantId } },
      { upsert: true, new: true },
    );
    res.json({ poster });
  }));

  r.post('/enquiries/link/regenerate', owner, wrap(async (req, res) => {
    const token = newEnquiryToken();
    const lib = await Library.findOneAndUpdate({ libraryId: req.tenantId }, { $set: { enquiryToken: token } }, { new: true }).lean();
    if (!lib) return res.status(404).json({ error: 'Library not found' });
    res.json({ token, url: enquiryPublicUrl(token) });
  }));

  r.get('/enquiries', wrap(async (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : 'waiting';
    const items = await Enquiry.find({ tenantId: req.tenantId, status }).sort({ createdAt: -1 }).limit(200).lean();
    const waiting = await Enquiry.countDocuments({ tenantId: req.tenantId, status: 'waiting' });
    res.json({ waitingCount: waiting, items: items.map(pub) });
  }));

  r.patch('/enquiries/:id', owner, wrap(async (req, res) => {
    const status = req.body?.status;
    if (!['admitted', 'removed'].includes(status)) return res.status(400).json({ error: 'Status must be admitted or removed' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Enquiry not found' });
    const doc = await Enquiry.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { $set: { status } },
      { new: true },
    ).lean();
    if (!doc) return res.status(404).json({ error: 'Enquiry not found' });
    res.json(pub(doc));
  }));

  return r;
}

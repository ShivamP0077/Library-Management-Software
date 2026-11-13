// Public QR enquiry form. Accepts enquiries even when the library plan is locked.
import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import { Library, models, Settings } from './models.js';
import { requireRole } from './auth.js';
import { rateLimited } from './accounts.js';
import { EMAIL_RE } from './identity.js';
import { indianMobile91 } from './trialUsage.js';
import tenantGuard from './tenantGuard.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const STATUSES = ['waiting', 'admitted', 'removed'];

const enquirySchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  mobile: { type: String, required: true },
  email: { type: String, default: null },
  preferred: { type: String, default: '' },
  message: { type: String, default: '' },
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
    preferred: doc.preferred || '',
    message: doc.message || '',
    status: doc.status,
    source: doc.source || 'qr',
    createdAt: doc.createdAt,
  };
}

async function catalogue(tenantId) {
  const [shifts, plans, settings] = await Promise.all([
    models.shifts.find({ tenantId }).select('name').lean(),
    models.plans.find({ tenantId }).select('name').lean(),
    Settings.findOne({ tenantId }).lean(),
  ]);
  return {
    logo: settings?.logo || null,
    shifts: shifts.map(s => s.name).filter(Boolean),
    plans: plans.map(p => p.name).filter(Boolean),
  };
}

export function createPublicEnquiryRouter() {
  const r = express.Router();

  r.get('/public/enquiry/:token', wrap(async (req, res) => {
    const lib = await Library.findOne({ enquiryToken: req.params.token, status: 'Active' }).select('libraryId name').lean();
    if (!lib) return res.status(404).json({ error: 'Enquiry link not found' });
    const cat = await catalogue(lib.libraryId);
    res.json({ libraryName: lib.name, logo: cat.logo, shifts: cat.shifts, plans: cat.plans });
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

    const name = String(b.name || '').trim();
    if (!name || name.length > 80) return res.status(400).json({ error: 'Name is required' });
    const mobile = indianMobile91(b.mobile);
    if (!mobile) return res.status(400).json({ error: 'Enter a valid Indian mobile number' });
    const emailRaw = String(b.email || '').trim().toLowerCase();
    if (emailRaw && !EMAIL_RE.test(emailRaw)) return res.status(400).json({ error: 'Enter a valid email address' });
    const preferred = String(b.preferred || '').trim();
    if (preferred.length > 120) return res.status(400).json({ error: 'Preferred shift or plan is too long' });
    const message = String(b.message || '').trim();
    if (message.length > 500) return res.status(400).json({ error: 'Message must be 500 characters or less' });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await Enquiry.findOne({ tenantId: lib.libraryId, mobile, createdAt: { $gte: since } }).sort({ createdAt: -1 });
    if (existing) {
      existing.name = name;
      existing.email = emailRaw || null;
      existing.preferred = preferred;
      existing.message = message;
      await existing.save();
      return res.json({ ok: true });
    }
    await Enquiry.create({
      tenantId: lib.libraryId, name, mobile, email: emailRaw || null, preferred, message, status: 'waiting', source: 'qr',
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
    res.json({ token, url: enquiryPublicUrl(token) });
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

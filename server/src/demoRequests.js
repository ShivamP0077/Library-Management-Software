// Public "Book a demo" requests. Stored only. No email or WhatsApp is sent.
import express from 'express';
import mongoose from 'mongoose';
import { rateLimited } from './accounts.js';
import { EMAIL_RE } from './identity.js';
import { indianMobile91 } from './trialUsage.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const DEMO_STATUSES = ['NEW', 'CONTACTED', 'CLOSED'];

const demoRequestSchema = new mongoose.Schema({
  libraryName: { type: String, required: true, trim: true, maxlength: 120 },
  mobile: { type: String, default: '' },
  email: { type: String, default: '' },
  seatCapacity: { type: Number, required: true, min: 1 },
  city: { type: String, required: true, trim: true, maxlength: 80 },
  status: { type: String, enum: DEMO_STATUSES, default: 'NEW', index: true },
  note: { type: String, default: '' },
  source: { type: String, default: 'landing' },
}, { timestamps: true });
demoRequestSchema.index({ createdAt: -1 });

export const DemoRequest = mongoose.models.DemoRequest || mongoose.model('DemoRequest', demoRequestSchema);

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Positive integer only. Rejects 0, negatives, decimals and non-numeric text. */
export function parseSeatCapacity(value) {
  if (typeof value === 'boolean' || value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return value;
  }
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function toDemoRequestJson(doc) {
  const libraryName = doc.libraryName;
  return {
    id: String(doc._id),
    libraryName,
    name: libraryName,
    mobile: doc.mobile || '',
    email: doc.email || '',
    seatCapacity: doc.seatCapacity,
    city: doc.city,
    status: doc.status,
    note: doc.note || '',
    source: doc.source || 'landing',
    createdAt: doc.createdAt,
  };
}

export function createPublicDemoRequestRouter() {
  const r = express.Router();

  r.post('/public/demo-requests', wrap(async (req, res) => {
    if (rateLimited(`demo:${req.ip}`, 5, 10 * 60e3)) {
      return res.status(429).json({ error: 'Too many demo requests. Try again later.', code: 'rate_limited' });
    }
    const b = req.body || {};
    if (String(b.website || '').trim()) return res.json({ ok: true });

    const libraryName = String(b.libraryName || '').trim();
    if (!libraryName || libraryName.length > 120) return res.status(400).json({ error: 'Library name is required' });

    const mobileRaw = String(b.mobile || '').trim();
    const emailRaw = String(b.email || '').trim().toLowerCase();
    const mobile = mobileRaw ? indianMobile91(mobileRaw) : null;
    if (mobileRaw && !mobile) return res.status(400).json({ error: 'Enter a valid Indian mobile number' });
    if (emailRaw && !EMAIL_RE.test(emailRaw)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (!mobile && !emailRaw) return res.status(400).json({ error: 'Enter a mobile number or an email address' });

    const seatCapacity = parseSeatCapacity(b.seatCapacity);
    if (seatCapacity == null) return res.status(400).json({ error: 'Seat capacity must be a whole number greater than 0' });

    const city = String(b.city || '').trim();
    if (!city || city.length > 80) return res.status(400).json({ error: 'City is required' });

    const source = String(b.source || '').trim().slice(0, 40) || 'landing';

    await DemoRequest.create({
      libraryName,
      mobile: mobile || '',
      email: emailRaw,
      seatCapacity,
      city,
      source,
      status: 'NEW',
      note: '',
    });
    res.status(201).json({ ok: true });
  }));

  return r;
}

export function createDemoRequestAdminRouter() {
  const r = express.Router();

  r.get('/demo-requests', wrap(async (req, res) => {
    const q = {};
    const status = String(req.query.status || '').trim();
    if (status) {
      if (!DEMO_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
      q.status = status;
    }
    const term = String(req.query.search || '').trim().slice(0, 120);
    if (term) {
      const safe = escapeRegex(term);
      const rx = { $regex: safe, $options: 'i' };
      q.$or = [{ libraryName: rx }, { mobile: rx }, { email: rx }, { city: rx }];
    }
    const rows = await DemoRequest.find(q).sort({ createdAt: -1, _id: -1 }).lean();
    res.json(rows.map(toDemoRequestJson));
  }));

  r.patch('/demo-requests/:id', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Demo request not found' });
    const b = req.body || {};
    const update = {};
    if (b.status !== undefined) {
      const status = String(b.status || '').trim();
      if (!DEMO_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
      update.status = status;
    }
    if (b.note !== undefined) {
      if (typeof b.note !== 'string') return res.status(400).json({ error: 'Note must be text' });
      const note = b.note.trim();
      if (note.length > 2000) return res.status(400).json({ error: 'Note must be 2000 characters or less' });
      update.note = note;
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
    const doc = await DemoRequest.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'Demo request not found' });
    res.json(toDemoRequestJson(doc));
  }));

  return r;
}

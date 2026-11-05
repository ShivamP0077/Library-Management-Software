/**
 * Issue #17: per-library WhatsApp message templates.
 * Stored on the library's WhatsappConfig (`templates.<type>`). A type with no saved text uses the
 * built-in default, so automatic reminders keep their current wording until the owner edits it.
 * Variables: {name} {amount} {dueDate} {library} {seat} (+ {month} {shift} {receiptNo} where known).
 */
import express from 'express';
import { WhatsappConfig, canManageWhatsapp } from './whatsapp.js';

export const TEMPLATE_TYPES = ['fee_reminder', 'renewal_reminder', 'fee_receipt', 'seat_info'];
export const TEMPLATE_VARS = ['name', 'amount', 'dueDate', 'library', 'seat'];
export const MAX_TEMPLATE_LENGTH = 1000;

/** Replace {var}; unknown or empty variables stay as typed so the owner can see them in the preview. */
export const renderTemplate = (text, vars = {}) =>
  String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : m));

/** Saved templates for a library: { type: text } (only types the owner saved). */
export async function getTemplates(libraryId, Config = WhatsappConfig) {
  const c = (await Config.findOne({ libraryId }).lean()) || {};
  const t = c.templates && typeof c.templates === 'object' ? c.templates : {};
  return Object.fromEntries(TEMPLATE_TYPES.filter(k => typeof t[k] === 'string' && t[k].trim()).map(k => [k, t[k]]));
}

export function validateTemplates(body) {
  const set = {}, unset = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!TEMPLATE_TYPES.includes(k)) throw Object.assign(new Error(`Unknown template type: ${k}`), { status: 400 });
    if (v === null || v === '') { unset[`templates.${k}`] = 1; continue; } // reset to default
    if (typeof v !== 'string') throw Object.assign(new Error('Template text must be text'), { status: 400 });
    const text = v.trim();
    if (text.length > MAX_TEMPLATE_LENGTH) throw Object.assign(new Error(`Template is too long (max ${MAX_TEMPLATE_LENGTH} characters)`), { status: 400 });
    set[`templates.${k}`] = text;
  }
  return { set, unset };
}

export function createTemplateRouter({ Config = WhatsappConfig } = {}) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const guard = wrap(async (req, res, next) => (await canManageWhatsapp(req.user, req.tenantId)) ? next() : res.status(403).json({ error: 'You do not have permission to manage WhatsApp templates' }));
  r.get('/whatsapp-templates', guard, wrap(async (req, res) => res.json(await getTemplates(req.tenantId, Config))));
  r.put('/whatsapp-templates', guard, wrap(async (req, res) => {
    const { set, unset } = validateTemplates(req.body);
    const update = { $set: { ...set, updatedBy: req.user.email } };
    if (Object.keys(unset).length) update.$unset = unset;
    await Config.updateOne({ libraryId: req.tenantId }, update, { upsert: true, strict: false });
    res.json(await getTemplates(req.tenantId, Config));
  }));
  return r;
}

// System WhatsApp sender (Evolution instance `libos-system`). Super-admin connects it;
// sign-up codes and other My Library OS messages go out from that number.
import express from 'express';
import { requireRole } from './auth.js';
import { createEvolutionClient, evolutionConfigured, normalizePhone, SYSTEM_INSTANCE } from './evolution.js';
import { createInstanceController } from './whatsapp.js';

const READY_TTL_MS = 60 * 1000;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

let clientOverride = null;
let readyCache = null; // { at, value }
let session = null;

export function setSystemEvolutionClient(client) {
  clientOverride = client || null;
  readyCache = null;
  session = null;
}

export function clearSystemWhatsappCache() {
  readyCache = null;
}

export function getSystemEvolutionClient() {
  if (clientOverride) return clientOverride;
  return createEvolutionClient();
}

/** True when a test client is injected or Evolution env vars are set. */
export function systemWhatsappConfigured() {
  return Boolean(clientOverride) || evolutionConfigured();
}

function sessionFor(client) {
  const c = client || getSystemEvolutionClient();
  if (!session || session.client !== c) session = { client: c, api: createInstanceController({ client: c, statusTtlMs: 10000 }) };
  return session.api;
}

/**
 * Whether `libos-system` is connected. The answer is cached for about 60s so
 * signup config does not call Evolution on every page load. Pass `client` to bypass the cache (tests).
 * Never throws.
 */
export async function systemWhatsappReady({ client, now = () => Date.now(), ttlMs = READY_TTL_MS } = {}) {
  const t = now();
  if (!client && readyCache && t - readyCache.at < ttlMs) return readyCache.value;
  const c = client || (systemWhatsappConfigured() ? getSystemEvolutionClient() : null);
  if (!c) {
    if (!client) readyCache = { at: t, value: false };
    return false;
  }
  let value = false;
  try {
    const inst = await c.findInstance(SYSTEM_INSTANCE);
    if (inst) {
      let raw = inst.connectionStatus;
      try { raw = (await c.connectionState(SYSTEM_INSTANCE))?.instance?.state || raw; } catch { /* list status is enough */ }
      value = raw === 'open';
    }
  } catch {
    value = false;
  }
  if (!client) readyCache = { at: t, value };
  return value;
}

/** Send one text from the system instance. Never throws. */
export async function sendSystemWhatsapp({ to, text }, deps = {}) {
  try {
    const c = deps.client || (systemWhatsappConfigured() ? getSystemEvolutionClient() : null);
    if (!c?.sendText) return { sent: false, reason: 'not_configured' };
    const number = normalizePhone(to);
    if (!number) return { sent: false, reason: 'invalid_number' };
    const body = String(text || '').trim();
    if (!body) return { sent: false, reason: 'empty_text' };
    await c.sendText(SYSTEM_INSTANCE, number, body);
    return { sent: true, reason: null };
  } catch (e) {
    return { sent: false, reason: String(e?.message || 'send_failed').slice(0, 200) };
  }
}

/** Super-admin only. Mounted under /api/admin. */
export function createSystemWhatsappRouter() {
  const r = express.Router();
  r.use(requireRole('superadmin'));

  const guard = (req, res, next) => {
    if (!systemWhatsappConfigured()) return res.status(503).json({ error: 'WhatsApp integration is not configured on the server' });
    next();
  };

  r.get('/system-whatsapp/status', guard, wrap(async (req, res) => {
    const s = await sessionFor().status(SYSTEM_INSTANCE, { fresh: req.query.fresh === 'true' });
    readyCache = { at: Date.now(), value: s.state === 'connected' };
    res.json({ ...s, instance: SYSTEM_INSTANCE });
  }));

  r.post('/system-whatsapp/connect', guard, wrap(async (req, res) => {
    clearSystemWhatsappCache();
    const out = await sessionFor().connect(SYSTEM_INSTANCE);
    readyCache = { at: Date.now(), value: out.state === 'connected' };
    res.json({ ...out, instance: SYSTEM_INSTANCE });
  }));

  r.post('/system-whatsapp/disconnect', guard, wrap(async (req, res) => {
    clearSystemWhatsappCache();
    const out = await sessionFor().disconnect(SYSTEM_INSTANCE);
    readyCache = { at: Date.now(), value: false };
    res.json({ ...out, instance: SYSTEM_INSTANCE });
  }));

  return r;
}

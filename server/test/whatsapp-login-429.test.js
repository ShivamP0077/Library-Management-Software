// Issue #18: WhatsApp Login (status/connect) wakes Evolution and retries on 429; no raw HTML ever reaches the UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createEvolutionClient, upstreamReason, looksLikeHtml } from '../src/evolution.js';
import { createWhatsappRouter, WhatsappConfig } from '../src/whatsapp.js';

const HTML_429 = '<!DOCTYPE html><html><head><style>body{font-family:sans-serif;color:#333}</style></head><body><h1>429 Too Many Requests</h1></body></html>';
const lean = (v) => ({ lean: async () => v });

test('upstreamReason drops an HTML/CSS page body', () => {
  assert.equal(looksLikeHtml(HTML_429), true);
  const r = upstreamReason(429, { raw: HTML_429 });
  assert.equal(r, 'HTTP 429: service is busy or still starting up');
  assert.doesNotMatch(r, /font-family|<|\{/);
});

test('client: an HTML 429 becomes a plain 503 error with upstreamStatus', async () => {
  const c = createEvolutionClient({ baseUrl: 'https://evo.test', apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 429, text: async () => HTML_429 }) });
  await assert.rejects(c.connect('libos-a'), (e) => {
    assert.equal(e.status, 503); assert.equal(e.upstreamStatus, 429);
    assert.equal(e.message, 'WhatsApp service is starting up. Please try again in a minute.');
    return true;
  });
});

async function withApp(client, fn) {
  const orig = { findOne: WhatsappConfig.findOne, updateOne: WhatsappConfig.updateOne };
  WhatsappConfig.findOne = () => lean(null); WhatsappConfig.updateOne = async () => ({});
  const app = express(); app.use(express.json());
  app.use((req, _r, next) => { req.user = { role: 'client_admin', email: 'o@x' }; req.libraryId = 'lib-a'; next(); });
  app.use('/wa', createWhatsappRouter({ client, isConfigured: () => true, wakeDelaysMs: [1, 1, 1] }));
  app.use((err, _q, res, _n) => res.status(err.status || 500).json({ error: err.message }));
  const s = app.listen(0);
  try { await fn(`http://127.0.0.1:${s.address().port}/wa`); } finally { s.close(); Object.assign(WhatsappConfig, orig); }
}
const busy = () => Object.assign(new Error('WhatsApp service is starting up. Please try again in a minute.'), { status: 503, upstreamStatus: 429 });

test('/status wakes and retries through 429s, then succeeds', async () => {
  let n = 0, woke = 0;
  const client = { findInstance: async () => { if (n++ < 2) throw busy(); return { name: 'libos-lib-a', connectionStatus: 'open', ownerJid: '919876543210@s' }; },
    connectionState: async () => ({ instance: { state: 'open' } }), wake: async () => { woke++; } };
  await withApp(client, async (b) => {
    const r = await (await fetch(b + '/status')).json();
    assert.equal(r.state, 'connected'); assert.equal(n, 3); assert.equal(woke, 1);
  });
});

test('/connect retries connect on 429 and returns the QR', async () => {
  let c = 0;
  const client = { findInstance: async () => ({ name: 'libos-lib-a', connectionStatus: 'close' }), connectionState: async () => ({ instance: { state: 'close' } }),
    connect: async () => { if (c++ < 1) throw busy(); return { base64: 'QR' }; }, wake: async () => {}, setWebhook: async () => {} };
  await withApp(client, async (b) => {
    const r = await (await fetch(b + '/connect', { method: 'POST' })).json();
    assert.equal(r.qr, 'QR'); assert.equal(c, 2);
  });
});

test('/status gives up after retries with a plain message, no HTML', async () => {
  const client = { findInstance: async () => { throw busy(); }, wake: async () => {} };
  await withApp(client, async (b) => {
    const res = await fetch(b + '/status');
    assert.equal(res.status, 503);
    const j = await res.json();
    assert.match(j.error, /starting up/); assert.doesNotMatch(j.error, /</);
  });
});

test('non-transient errors are not retried', async () => {
  let n = 0;
  const client = { findInstance: async () => { n++; throw Object.assign(new Error('bad key'), { status: 502, upstreamStatus: 401 }); }, wake: async () => {} };
  await withApp(client, async (b) => { await fetch(b + '/status'); assert.equal(n, 1); });
});

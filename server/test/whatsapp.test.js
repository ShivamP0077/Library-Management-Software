// Unit tests for the WhatsApp (Evolution API) integration. No network, no database: everything is mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createEvolutionClient, instanceNameFor, normalizePhone } from '../src/evolution.js';
import { sendWhatsappMessage, canManageWhatsapp, buildReceiptText, createWhatsappRouter, WhatsappConfig } from '../src/whatsapp.js';

const lean = (v) => ({ lean: async () => v });

test('instance name is derived from libraryId and URL safe', () => {
  assert.equal(instanceNameFor('Lib A/../x'), 'libos-lib-a-x');
  assert.notEqual(instanceNameFor('lib-a'), instanceNameFor('lib-b'));
  assert.throws(() => instanceNameFor(''));
});

test('normalizePhone handles Indian numbers', () => {
  assert.equal(normalizePhone('98765 43210'), '919876543210');
  assert.equal(normalizePhone('+91-98765-43210'), '919876543210');
  assert.equal(normalizePhone('09876543210'), '919876543210');
  assert.equal(normalizePhone('123'), null);
});

test('client sends apikey header server-side and maps errors', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, text: async () => JSON.stringify({ key: { id: 'm1' } }) }; };
  const c = createEvolutionClient({ baseUrl: 'https://evo.test/', apiKey: 'k', fetchImpl });
  await c.sendText('libos-a', '919876543210', 'hi');
  assert.equal(calls[0].url, 'https://evo.test/message/sendText/libos-a');
  assert.equal(calls[0].opts.headers.apikey, 'k');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { number: '919876543210', text: 'hi' });
  const bad = createEvolutionClient({ baseUrl: 'https://evo.test', apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{"error":"Unauthorized"}' }) });
  await assert.rejects(bad.connect('x'), (e) => e.status === 502 && !/k/.test(e.message.replace(/[A-Za-z ]+/, '')));
  await assert.rejects(createEvolutionClient({ baseUrl: '', apiKey: '' }).connect('x'), (e) => e.status === 503);
});

function deps({ cfg = null, existing = null, sendFails = false } = {}) {
  const sent = []; const updates = [];
  return {
    sent, updates,
    client: { sendText: async (...a) => { if (sendFails) throw new Error('boom'); sent.push(a); return { key: { id: 'p1' } }; } },
    Config: { findOne: () => lean(cfg) },
    Lib: { findOne: () => lean({ name: 'Sunrise Library' }) },
    Message: {
      findOne: () => lean(existing),
      findOneAndUpdate: async (_f, u) => ({ _id: 'log1', ...u.$set }),
      updateOne: async (_f, u) => { updates.push(u.$set); },
    },
  };
}
const msg = { libraryId: 'lib-a', type: 'admission_receipt', to: '9876543210', text: 'Paid', dedupeKey: 'receipt:R1' };

test('send: prefixes library name, logs sent status', async () => {
  const d = deps();
  const r = await sendWhatsappMessage(msg, d);
  assert.equal(r.status, 'sent');
  assert.equal(d.sent[0][0], 'libos-lib-a');
  assert.equal(d.sent[0][1], '919876543210');
  assert.match(d.sent[0][2], /^\*Sunrise Library\*\nPaid$/);
  assert.equal(d.updates[0].status, 'sent');
});

test('send: honors opt-out, per-type toggles, consent and duplicates', async () => {
  assert.equal((await sendWhatsappMessage(msg, deps({ cfg: { enabled: false } }))).reason, 'disabled');
  assert.equal((await sendWhatsappMessage(msg, deps({ cfg: { receipts: false } }))).reason, 'disabled');
  assert.equal((await sendWhatsappMessage({ ...msg, type: 'fee_reminder' }, deps())).reason, 'disabled'); // off by default
  assert.equal((await sendWhatsappMessage({ ...msg, consent: false }, deps())).reason, 'no_consent');
  assert.equal((await sendWhatsappMessage({ ...msg, to: '12' }, deps())).reason, 'invalid_number');
  const dup = deps({ existing: { _id: 'x', status: 'sent' } });
  assert.equal((await sendWhatsappMessage(msg, dup)).status, 'duplicate');
  assert.equal(dup.sent.length, 0);
});

test('send: provider failure is recorded, not thrown', async () => {
  const d = deps({ sendFails: true });
  const r = await sendWhatsappMessage(msg, d);
  assert.equal(r.status, 'failed');
  assert.equal(d.updates[0].status, 'failed');
});

test('permissions: owner/superadmin yes; staff only with settings rights', async () => {
  const Staff = (rec) => ({ findOne: () => lean(rec) });
  assert.equal(await canManageWhatsapp({ role: 'client_admin' }, 'lib-a'), true);
  assert.equal(await canManageWhatsapp({ role: 'superadmin' }, 'lib-a'), true);
  assert.equal(await canManageWhatsapp({ role: 'staff' }, 'lib-a'), false);
  assert.equal(await canManageWhatsapp({ role: 'staff', staffId: 's1' }, 'lib-a', { Staff: Staff({ role: 'Librarian', status: 'Active' }) }), false);
  assert.equal(await canManageWhatsapp({ role: 'staff', staffId: 's1' }, 'lib-a', { Staff: Staff({ role: 'Manager', status: 'Active' }) }), true);
  assert.equal(await canManageWhatsapp({ role: 'staff', staffId: 's1' }, 'lib-a', { Staff: Staff({ role: 'Manager', status: 'Inactive' }) }), false);
  assert.equal(await canManageWhatsapp({ role: 'staff', staffId: 's1' }, 'lib-a', { Staff: Staff({ role: 'Custom', status: 'Active', permissions: { settings: { manage: true } } }) }), true);
});

test('receipt text', () => {
  const t = buildReceiptText({ receiptNo: 'R1', netTotal: 1500, date: '2026-11-01' }, { name: 'Asha' });
  assert.match(t, /Asha/); assert.match(t, /R1/); assert.match(t, /1,500/);
});

// Route-level tests with a mocked Evolution client and stubbed config model
async function withApp(user, client, fn) {
  const orig = { findOne: WhatsappConfig.findOne, updateOne: WhatsappConfig.updateOne };
  WhatsappConfig.findOne = () => lean(null);
  WhatsappConfig.updateOne = async () => ({});
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; req.libraryId = 'lib-a'; next(); });
  app.use('/wa', createWhatsappRouter({ client, isConfigured: () => true }));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/wa`;
  try { await fn(base); } finally { server.close(); Object.assign(WhatsappConfig, orig); }
}

test('routes: connect creates per-library instance and returns QR; status reports connected number; logout', async () => {
  const log = [];
  let inst = null;
  const client = {
    findInstance: async (n) => { log.push(['find', n]); return inst; },
    createInstance: async (n) => { log.push(['create', n]); inst = { name: n, connectionStatus: 'connecting' }; return { qrcode: { base64: 'data:image/png;base64,AAA' } }; },
    connectionState: async () => ({ instance: { state: inst.connectionStatus } }),
    connect: async () => ({ base64: 'data:image/png;base64,QR', pairingCode: null }),
    logout: async (n) => { log.push(['logout', n]); inst.connectionStatus = 'close'; },
  };
  await withApp({ role: 'client_admin', email: 'o@x' }, client, async (base) => {
    let r = await (await fetch(base + '/status')).json();
    assert.equal(r.state, 'not_created');
    r = await (await fetch(base + '/connect', { method: 'POST' })).json();
    assert.equal(r.qr, 'data:image/png;base64,QR');
    assert.deepEqual(log.find(l => l[0] === 'create'), ['create', 'libos-lib-a']);
    inst.connectionStatus = 'open'; inst.ownerJid = '919876543210@s.whatsapp.net'; inst.profileName = 'Sunrise';
    r = await (await fetch(base + '/status')).json();
    assert.equal(r.state, 'connected'); assert.equal(r.number, '+919876543210');
    assert.equal(JSON.stringify(r).includes('apikey'), false);
    r = await (await fetch(base + '/logout', { method: 'POST' })).json();
    assert.equal(r.state, 'disconnected');
  });
});

test('routes: staff without permission gets 403 and Evolution is never called', async () => {
  let called = false;
  const client = new Proxy({}, { get: () => async () => { called = true; } });
  await withApp({ role: 'staff' }, client, async (base) => {
    const res = await fetch(base + '/connect', { method: 'POST' });
    assert.equal(res.status, 403);
  });
  assert.equal(called, false);
});

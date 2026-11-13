// Unit tests for the WhatsApp (Evolution API) integration. No network, no database: everything is mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createEvolutionClient, instanceNameFor, normalizePhone } from '../src/evolution.js';
import { sendWhatsappMessage, canManageWhatsapp, buildReceiptText, createWhatsappRouter, WhatsappConfig, paymentReceiptsEnabled, publicWhatsappSettings } from '../src/whatsapp.js';

const lean = (v) => ({ lean: async () => v });

test('instance name is derived from libraryId and URL safe', () => {
  assert.equal(instanceNameFor('Lib A/../x'), 'libos-lib-a-x');
  assert.notEqual(instanceNameFor('lib-a'), instanceNameFor('lib-b'));
  assert.throws(() => instanceNameFor(''));
  // The system sender owns this name. No library id may map to it.
  for (const id of ['system', 'SYSTEM', 'System', 'system!!!']) {
    assert.throws(() => instanceNameFor(id), /reserved/i);
  }
  assert.notEqual(instanceNameFor('lib-system'), 'libos-system');
  assert.notEqual(instanceNameFor('libos-system'), 'libos-system');
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
  assert.match(t, /Paid on 2026-11-01/);
  const backdated = buildReceiptText({
    receiptNo: 'R2', netTotal: 900, paidOn: '2026-12-07', date: '2026-12-10',
    periodStart: '2026-12-01', periodEnd: '2026-12-31',
  }, { name: 'Ravi', expiryDate: '2027-01-31' });
  assert.match(backdated, /Paid on 2026-12-07/);
  assert.match(backdated, /Period: 2026-12-01 to 2026-12-31/);
  assert.doesNotMatch(t, /Ref:/);
  const withRef = buildReceiptText({ receiptNo: 'R3', netTotal: 400, method: 'UPI', referenceNo: 'UTR99', date: '2026-11-02' }, { name: 'Meera' });
  assert.match(withRef, /Ref: UTR99/);
  const split = buildReceiptText({
    receiptNo: 'R4', netTotal: 1000, method: 'Split', date: '2026-11-02',
    breakdown: [{ method: 'UPI', amount: 600, referenceNo: 'U1' }, { method: 'Cash', amount: 400 }],
  }, { name: 'Meera' });
  assert.match(split, /Ref: UPI U1/);
});

test('payment receipts follow the admission toggle until the library sets them', () => {
  assert.equal(paymentReceiptsEnabled(undefined), true);
  assert.equal(paymentReceiptsEnabled({}), true);
  assert.equal(paymentReceiptsEnabled({ receipts: true }), true);
  assert.equal(paymentReceiptsEnabled({ receipts: false }), false);
  assert.equal(paymentReceiptsEnabled({ receipts: false, paymentReceipts: true }), true);
  assert.equal(paymentReceiptsEnabled({ receipts: true, paymentReceipts: false }), false);
  const inherited = publicWhatsappSettings({ receipts: false });
  assert.equal(inherited.paymentReceiptsEffective, false);
  assert.equal(inherited.paymentReceipts, undefined);
  const explicit = publicWhatsappSettings({ receipts: true, paymentReceipts: false });
  assert.equal(explicit.paymentReceipts, false);
  assert.equal(explicit.paymentReceiptsEffective, false);
});

test('payment receipt sends use the effective toggle, not the admission toggle alone', async () => {
  const off = deps({ cfg: { receipts: true, paymentReceipts: false } });
  assert.equal((await sendWhatsappMessage(msg, off)).reason, 'disabled');
  assert.equal(off.sent.length, 0);
  const renewOff = deps({ cfg: { receipts: true, paymentReceipts: false } });
  assert.equal((await sendWhatsappMessage({ ...msg, type: 'renewal_receipt', dedupeKey: 'receipt:R2' }, renewOff)).reason, 'disabled');
  assert.equal(renewOff.sent.length, 0);
  const on = deps({ cfg: { receipts: false, paymentReceipts: true } });
  assert.equal((await sendWhatsappMessage(msg, on)).status, 'sent');
  assert.equal(on.sent.length, 1);
  const inheritedOff = deps({ cfg: { receipts: false } });
  assert.equal((await sendWhatsappMessage({ ...msg, dedupeKey: 'receipt:R3' }, inheritedOff)).reason, 'disabled');
  assert.equal(inheritedOff.sent.length, 0);
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

/* ---------------------------------------------------------------- Messages screen + delivery webhook */
import { WhatsappMessage, mapAckStatus, applyStatusUpdate, createWhatsappWebhookRouter, registerWebhook, webhookUrlFor } from '../src/whatsapp.js';
import { webhookTokenFor } from '../src/evolution.js';

test('send: stores student, name and message text on the log row', async () => {
  const d = deps(); let claimed;
  d.Message.findOneAndUpdate = async (_f, u) => { claimed = u.$set; return { _id: 'log1' }; };
  await sendWhatsappMessage({ ...msg, studentId: 7, studentName: 'Asha' }, d);
  assert.equal(claimed.studentId, '7'); assert.equal(claimed.studentName, 'Asha');
  assert.match(claimed.text, /Sunrise Library\*\nPaid/);
});

test('send: delivered/read rows count as already sent; failed/skipped rows can be resent', async () => {
  for (const status of ['delivered', 'read']) assert.equal((await sendWhatsappMessage(msg, deps({ existing: { _id: 'x', status } }))).status, 'duplicate');
  for (const status of ['failed', 'skipped']) assert.equal((await sendWhatsappMessage(msg, deps({ existing: { _id: 'x', status } }))).status, 'sent');
});

test('webhook: ack mapping to sent, delivered, read, failed', () => {
  assert.equal(mapAckStatus('SERVER_ACK'), 'sent');
  assert.equal(mapAckStatus('DELIVERY_ACK'), 'delivered');
  assert.equal(mapAckStatus('READ'), 'read');
  assert.equal(mapAckStatus('PLAYED'), 'read');
  assert.equal(mapAckStatus('ERROR'), 'failed');
  assert.equal(mapAckStatus(3), 'delivered');
  assert.equal(mapAckStatus('weird'), null);
});

function memMessages(rows) {
  return {
    rows,
    findOne: (q) => lean(rows.find(r => r.providerMessageId === q.providerMessageId) || null),
    updateOne: async (q, u) => { const r = rows.find(x => x._id === q._id); Object.assign(r, u.$set); },
  };
}

test('webhook: libos-system events do not crash and are not applied to a library log', async () => {
  const M = memMessages([{ _id: 'sys', libraryId: 'system', providerMessageId: 'PS', status: 'sent' }]);
  assert.equal(await applyStatusUpdate('libos-system', { keyId: 'PS', status: 'READ' }, M), false);
  assert.equal(M.rows[0].status, 'sent');
});

test('webhook: status only moves forward and is tenant-checked by instance', async () => {
  const M = memMessages([{ _id: 'a', libraryId: 'lib-a', providerMessageId: 'P1', status: 'sent' }]);
  assert.equal(await applyStatusUpdate('libos-lib-b', { keyId: 'P1', status: 'READ' }, M), false); // other library's instance
  assert.equal(await applyStatusUpdate('libos-lib-a', { keyId: 'P1', status: 'DELIVERY_ACK' }, M), true);
  assert.equal(M.rows[0].status, 'delivered');
  assert.equal(await applyStatusUpdate('libos-lib-a', { key: { id: 'P1' }, status: 'READ' }, M), true);
  assert.equal(M.rows[0].status, 'read');
  assert.equal(await applyStatusUpdate('libos-lib-a', { keyId: 'P1', status: 'DELIVERY_ACK' }, M), false);
  assert.equal(await applyStatusUpdate('libos-lib-a', { keyId: 'P1', status: 'ERROR' }, M), false); // already read
  assert.equal(M.rows[0].status, 'read');
});

test('webhook route: rejects bad tokens, accepts the derived token', async () => {
  const prev = process.env.EVOLUTION_API_KEY; process.env.EVOLUTION_API_KEY = 'test-key';
  const M = memMessages([{ _id: 'a', libraryId: 'lib-a', providerMessageId: 'P1', status: 'sent' }]);
  const app = express(); app.use(express.json()); app.use('/wa', createWhatsappWebhookRouter({ Message: M }));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/wa/webhook/libos-lib-a`;
  const post = (q, body) => fetch(base + q, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const body = { event: 'messages.update', instance: 'libos-lib-a', data: { keyId: 'P1', status: 'DELIVERY_ACK' } };
    assert.equal((await post('', body)).status, 401);
    assert.equal((await post('?token=nope', body)).status, 401);
    assert.equal((await post(`?token=${webhookTokenFor('libos-lib-b')}`, body)).status, 401);
    const ok = await post(`?token=${webhookTokenFor('libos-lib-a')}`, body);
    assert.equal(ok.status, 200); assert.equal((await ok.json()).updated, 1);
    assert.equal(M.rows[0].status, 'delivered');
    const sys = await fetch(`http://127.0.0.1:${server.address().port}/wa/webhook/libos-system?token=${webhookTokenFor('libos-system')}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'messages.update', data: { keyId: 'P1', status: 'READ' } }),
    });
    assert.equal(sys.status, 200);
    assert.equal((await sys.json()).ignored, true);
    assert.equal(M.rows[0].status, 'delivered');
  } finally { server.close(); process.env.EVOLUTION_API_KEY = prev; }
});

test('registerWebhook points MESSAGES_UPDATE at our route and never throws', async () => {
  const prev = process.env.EVOLUTION_API_KEY; process.env.EVOLUTION_API_KEY = 'test-key';
  try {
    const calls = [];
    assert.equal(await registerWebhook({ setWebhook: async (...a) => calls.push(a) }, 'libos-lib-a', 'https://api.test'), true);
    assert.equal(calls[0][1], webhookUrlFor('https://api.test', 'libos-lib-a'));
    assert.match(calls[0][1], /^https:\/\/api\.test\/api\/whatsapp\/webhook\/libos-lib-a\?token=[0-9a-f]{40}$/);
    assert.equal(await registerWebhook({ setWebhook: async () => { throw new Error('x'); } }, 'libos-lib-a', 'https://api.test'), false);
  } finally { process.env.EVOLUTION_API_KEY = prev; }
});

test('routes: messages list is tenant-scoped and filtered; resend only for failed/skipped', async () => {
  const orig = { find: WhatsappMessage.find, countDocuments: WhatsappMessage.countDocuments, findOne: WhatsappMessage.findOne };
  let lastQuery;
  WhatsappMessage.find = (q) => { lastQuery = q; const c = { sort: () => c, skip: () => c, limit: () => c, lean: async () => [{ _id: 'm1', type: 'admission_receipt', status: 'failed', studentId: 's1', studentName: 'Asha', text: 'hi', dedupeKey: 'receipt:R1' }] }; return c; };
  WhatsappMessage.countDocuments = async () => 1;
  WhatsappMessage.findOne = () => lean({ _id: '507f1f77bcf86cd799439011', libraryId: 'lib-a', status: 'sent', dedupeKey: 'receipt:R1' });
  try {
    await withApp({ role: 'client_admin', email: 'o@x' }, {}, async (base) => {
      const r = await (await fetch(base + '/messages?studentId=s1&status=failed&type=bogus&libraryId=lib-b')).json();
      assert.deepEqual(lastQuery, { libraryId: 'lib-a', studentId: 's1', status: 'failed' });
      assert.equal(r.total, 1); assert.equal(r.items[0].canResend, true); assert.equal(r.items[0].studentName, 'Asha');
      const res = await fetch(base + '/messages/507f1f77bcf86cd799439011/resend', { method: 'POST' });
      assert.equal(res.status, 409); // already sent
      assert.equal((await fetch(base + '/messages/not-an-id/resend', { method: 'POST' })).status, 404);
    });
    await withApp({ role: 'staff' }, {}, async (base) => assert.equal((await fetch(base + '/messages')).status, 403));
  } finally { Object.assign(WhatsappMessage, orig); }
});

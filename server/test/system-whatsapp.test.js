// System WhatsApp sender (libos-system) and mobile sign-up codes. Fake Evolution client only.
import crypto from 'crypto';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, call, ctx } from './helpers.js';
import { resetRateLimits } from '../src/accounts.js';
import { setSmsProvider } from '../src/messaging.js';
import { SignupOtp } from '../src/signup.js';
import { SYSTEM_INSTANCE, instanceNameFor } from '../src/evolution.js';
import { sendSystemWhatsapp, systemWhatsappReady, setSystemEvolutionClient, clearSystemWhatsappCache } from '../src/systemWhatsapp.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sent = [];
let inst = null;
let failSend = false;
let findCalls = 0;

const fake = {
  findInstance: async (name) => { findCalls += 1; assert.equal(name, SYSTEM_INSTANCE); return inst; },
  createInstance: async (name) => {
    assert.equal(name, SYSTEM_INSTANCE);
    inst = { name, connectionStatus: 'connecting' };
    return { qrcode: { base64: 'data:image/png;base64,NEW' } };
  },
  connectionState: async (name) => { assert.equal(name, SYSTEM_INSTANCE); return { instance: { state: inst?.connectionStatus || 'close' } }; },
  connect: async (name) => { assert.equal(name, SYSTEM_INSTANCE); return { base64: 'data:image/png;base64,QR', pairingCode: null }; },
  logout: async (name) => { assert.equal(name, SYSTEM_INSTANCE); if (inst) inst.connectionStatus = 'close'; },
  sendText: async (name, number, text) => {
    assert.equal(name, SYSTEM_INSTANCE);
    if (failSend) throw new Error('provider down');
    sent.push({ name, number, text });
    return { key: { id: 'sys1' } };
  },
};

before(async () => {
  await setup('system-wa');
  setSmsProvider(null);
  setSystemEvolutionClient(fake);
});
after(async () => {
  delete process.env.OWNER_SIGNUP_ENABLED;
  setSmsProvider(null);
  setSystemEvolutionClient(null);
  await teardown();
});
beforeEach(() => { resetRateLimits(); sent.length = 0; failSend = false; });

test('no library id can be named libos-system', () => {
  assert.equal(SYSTEM_INSTANCE, 'libos-system');
  assert.throws(() => instanceNameFor('system'));
  assert.throws(() => instanceNameFor('SYSTEM'));
  assert.notEqual(instanceNameFor('my-system'), SYSTEM_INSTANCE);
});

test('sendSystemWhatsapp uses libos-system and never throws', async () => {
  const ok = await sendSystemWhatsapp({ to: '9876500001', text: 'Hello' });
  assert.equal(ok.sent, true);
  assert.equal(sent.at(-1).name, 'libos-system');
  assert.equal(sent.at(-1).number, '919876500001');
  assert.equal(sent.at(-1).text, 'Hello');
  const bad = await sendSystemWhatsapp({ to: '12', text: 'Hello' });
  assert.equal(bad.sent, false);
  assert.equal(bad.reason, 'invalid_number');
  const down = await sendSystemWhatsapp({ to: '9876500001', text: 'Hello' }, { client: { sendText: async () => { throw new Error('nope'); } } });
  assert.equal(down.sent, false);
  assert.equal(down.reason, 'nope');
});

test('systemWhatsappReady is cached for about 60s', async () => {
  inst = { connectionStatus: 'open' };
  clearSystemWhatsappCache();
  findCalls = 0;
  assert.equal(await systemWhatsappReady(), true);
  const afterFirst = findCalls;
  assert.ok(afterFirst >= 1);
  inst = { connectionStatus: 'close' };
  assert.equal(await systemWhatsappReady(), true, 'cached open state');
  assert.equal(findCalls, afterFirst);
  clearSystemWhatsappCache();
  assert.equal(await systemWhatsappReady(), false);
});

test('system whatsapp routes are superadmin only', async () => {
  inst = null;
  clearSystemWhatsappCache();
  const owner = await call('GET', '/api/admin/system-whatsapp/status', { token: ctx.tokens.a });
  assert.equal(owner.status, 403);
  const ownerConnect = await call('POST', '/api/admin/system-whatsapp/connect', { token: ctx.tokens.a });
  assert.equal(ownerConnect.status, 403);
  assert.equal(inst, null, 'library owner must not create the system instance');

  let status = await call('GET', '/api/admin/system-whatsapp/status', { token: ctx.tokens.sa });
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.state, 'not_created');
  assert.equal(status.body.instance, 'libos-system');
  assert.equal(JSON.stringify(status.body).includes('apikey'), false);

  const connect = await call('POST', '/api/admin/system-whatsapp/connect', { token: ctx.tokens.sa });
  assert.equal(connect.status, 200, JSON.stringify(connect.body));
  assert.equal(connect.body.state, 'connecting');
  assert.equal(connect.body.qr, 'data:image/png;base64,QR');
  assert.equal(inst.name, 'libos-system');

  inst.connectionStatus = 'open';
  inst.ownerJid = '919876543210@s.whatsapp.net';
  inst.profileName = 'Library OS';
  clearSystemWhatsappCache();
  status = await call('GET', '/api/admin/system-whatsapp/status?fresh=true', { token: ctx.tokens.sa });
  assert.equal(status.body.state, 'connected');
  assert.equal(status.body.number, '+919876543210');

  const off = await call('POST', '/api/admin/system-whatsapp/disconnect', { token: ctx.tokens.sa });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.state, 'disconnected');
  const ownerOff = await call('POST', '/api/admin/system-whatsapp/disconnect', { token: ctx.tokens.a });
  assert.equal(ownerOff.status, 403);
});

test('signup config follows system WhatsApp, and start-mobile sends a hashed code', async () => {
  setSmsProvider(null);
  inst = { connectionStatus: 'close' };
  clearSystemWhatsappCache();
  delete process.env.OWNER_SIGNUP_ENABLED;
  let cfg = (await call('GET', '/api/auth/signup/config')).body;
  assert.equal(cfg.mobileSignup, false);
  assert.equal(cfg.mobileSignupAvailable, false);

  process.env.OWNER_SIGNUP_ENABLED = 'true';
  clearSystemWhatsappCache();
  cfg = (await call('GET', '/api/auth/signup/config')).body;
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.mobileSignup, false);
  assert.equal(cfg.mobileSignupAvailable, false);

  inst = { connectionStatus: 'open' };
  clearSystemWhatsappCache();
  cfg = (await call('GET', '/api/auth/signup/config')).body;
  assert.equal(cfg.mobileSignup, true);
  assert.equal(cfg.mobileSignupAvailable, true);

  const mobile = '9876501234';
  const start = await call('POST', '/api/auth/signup/start-mobile', { body: { mobile } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const text = sent.at(-1)?.text || '';
  assert.match(text, /^Your My Library OS sign-up code is \d{6}\. It expires in 15 minutes\. Do not share it\.$/);
  assert.equal(sent.at(-1).name, 'libos-system');
  assert.equal(sent.at(-1).number, '919876501234');
  const code = text.match(/(\d{6})/)[1];
  const rec = await SignupOtp.findOne({ mobile, channel: 'mobile', usedAt: null }).lean();
  assert.ok(rec);
  assert.equal(rec.codeHash, sha(`mobile:${mobile}:${code}`));
  assert.ok(rec.expiresAt > new Date());
});

test('start-mobile returns 503 and leaves no usable code when WhatsApp send fails', async () => {
  process.env.OWNER_SIGNUP_ENABLED = 'true';
  setSmsProvider(null);
  inst = { connectionStatus: 'open' };
  clearSystemWhatsappCache();
  failSend = true;
  const mobile = '9876509999';
  const start = await call('POST', '/api/auth/signup/start-mobile', { body: { mobile } });
  assert.equal(start.status, 503);
  assert.equal(start.body.error, 'Could not send the code on WhatsApp. Try email sign-up.');
  assert.equal(await SignupOtp.countDocuments({ mobile, channel: 'mobile', usedAt: null }), 0);
});

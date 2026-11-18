// Evolution cold-start handling: wake + backoff in the send path, and the receipt retry job. All mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvolutionError } from '../src/evolution.js';
import { sendWhatsappMessage, retryFailedReceipts, isTransientError, deliver, whatsappBackoff, isLoggedOutState } from '../src/whatsapp.js';

const lean = (v) => ({ lean: async () => v });
const asleep = () => Object.assign(new EvolutionError('WhatsApp service request failed', 502), { upstreamStatus: 503 });

test('transient errors are recognised', () => {
  assert.ok(isTransientError(asleep()));
  assert.ok(isTransientError(new EvolutionError('WhatsApp service is unreachable', 503)));
  assert.ok(!isTransientError(Object.assign(new EvolutionError('x', 502), { upstreamStatus: 400 })));
});

test('send: wakes Evolution, 503 once then success -> receipt sent', async () => {
  let n = 0; const woke = []; const updates = [];
  const d = {
    retryDelaysMs: [1, 1],
    client: { wake: async (i) => { woke.push(i); }, sendText: async () => { if (n++ === 0) throw asleep(); return { key: { id: 'p1' } }; } },
    Config: { findOne: () => lean(null) }, Lib: { findOne: () => lean({ name: 'L' }) },
    Message: { findOne: () => lean(null), findOneAndUpdate: async (_f, u) => ({ _id: 'log1', attempts: 1, ...u.$set }), updateOne: async (_f, u) => { updates.push(u.$set); } },
  };
  const r = await sendWhatsappMessage({ libraryId: 'lib-a', type: 'renewal_receipt', to: '9876543210', text: 'Paid', dedupeKey: 'receipt:R1' }, d);
  assert.equal(r.status, 'sent');
  assert.deepEqual(woke, ['libos-lib-a']);
  assert.equal(n, 2);
  assert.equal(updates.at(-1).status, 'sent');
});

test('send: still asleep after backoff -> failed, transient, not permanent', async () => {
  const updates = [];
  const d = {
    retryDelaysMs: [1],
    client: { sendText: async () => { throw asleep(); } },
    Config: { findOne: () => lean(null) }, Lib: { findOne: () => lean({ name: 'L' }) },
    Message: { findOne: () => lean(null), findOneAndUpdate: async (_f, u) => ({ _id: 'log1', attempts: 1, ...u.$set }), updateOne: async (_f, u) => { updates.push(u.$set); } },
  };
  const r = await sendWhatsappMessage({ libraryId: 'lib-a', type: 'renewal_receipt', to: '9876543210', text: 'Paid', dedupeKey: 'receipt:R1' }, d);
  assert.equal(r.status, 'failed');
  assert.equal(updates.at(-1).transient, true);
  assert.equal(updates.at(-1).permanent, false);
});

test('retry job picks up a transient failure and sends it with the same row', async () => {
  const row = { _id: 'm1', libraryId: 'lib-a', type: 'renewal_receipt', status: 'failed', attempts: 1, to: '919876543210', text: '*L*\nPaid', error: 'WhatsApp service is unreachable' };
  const sent = []; const updates = []; let query; let claim;
  const Message = {
    find: (q) => { query = q; return { limit: () => lean([row]) }; },
    findOneAndUpdate: async (f, u) => { claim = { f, u }; return { ...row, status: 'queued', attempts: row.attempts + 1 }; },
    updateOne: async (_f, u) => { updates.push(u.$set); },
    updateMany: async () => ({}),
  };
  const out = await retryFailedReceipts({ Message, retryDelaysMs: [], client: { sendText: async (...a) => { sent.push(a); return { key: { id: 'p2' } }; } } });
  assert.deepEqual(out, { retried: 1, sent: 1, failed: 0, skipped: 0 });
  assert.deepEqual(query.attempts, { $lt: 3 });
  assert.deepEqual(claim.u.$inc, { attempts: 1 });
  assert.deepEqual(sent[0], ['libos-lib-a', '919876543210', '*L*\nPaid']);
  assert.equal(updates.at(-1).status, 'sent');
});

test('retry job: third failed attempt is marked permanent', async () => {
  const row = { _id: 'm1', libraryId: 'lib-a', type: 'admission_receipt', status: 'failed', attempts: 2, to: '919876543210', text: 'x', transient: true };
  const updates = [];
  const Message = {
    find: () => ({ limit: () => lean([row]) }),
    findOneAndUpdate: async () => ({ ...row, status: 'queued', attempts: 3 }),
    updateOne: async (_f, u) => { updates.push(u.$set); }, updateMany: async () => ({}),
  };
  const out = await retryFailedReceipts({ Message, retryDelaysMs: [], client: { sendText: async () => { throw asleep(); } } });
  assert.equal(out.failed, 1);
  assert.equal(updates.at(-1).permanent, true);
});

const logRow = { _id: 'log1', attempts: 1 };
const messageSink = () => {
  const updates = [];
  return { updates, Message: { updateOne: async (_f, u) => { updates.push(u.$set); } } };
};

test('deliver wait-loop: failed wake keeps retryAfterMs in scope and stays bounded', async () => {
  const sleeps = [];
  const wakes = [];
  const err = Object.assign(new Error('rate limited'), { status: 429, retryAfterMs: 42 });
  let sends = 0;
  const { updates, Message } = messageSink();
  const r = await deliver(logRow, { libraryId: 'lib-a', number: '9198', body: 'hi' }, {
    delaysMs: [1],
    sleep: async (ms) => { sleeps.push(ms); },
    Message,
    client: {
      wake: async (name) => { wakes.push(name); throw err; },
      sendText: async () => { sends++; return { key: { id: 'ok' } }; },
    },
  });
  assert.equal(r.status, 'sent');
  assert.equal(sends, 1);
  assert.equal(wakes.length, 6);
  assert.deepEqual(sleeps, Array.from({ length: 6 }, (_, w) => whatsappBackoff(w, { retryAfterMs: 42 })));
  assert.equal(sleeps[0], 42);
  assert.equal(updates.at(-1).status, 'sent');
});

test('deliver wait-loop: open state stops waiting', async () => {
  const states = ['connecting', 'open'];
  const sleeps = [];
  let sends = 0;
  const { Message } = messageSink();
  const r = await deliver(logRow, { libraryId: 'lib-a', number: '9198', body: 'hi' }, {
    delaysMs: [5, 5],
    sleep: async (ms) => { sleeps.push(ms); },
    Message,
    client: {
      wake: async () => ({ instance: { state: states.shift() } }),
      sendText: async () => { sends++; return { key: { id: 'ok' } }; },
    },
  });
  assert.equal(r.status, 'sent');
  assert.equal(sends, 1);
  assert.equal(states.length, 0);
  assert.equal(sleeps.length, 1);
});

test('deliver does not send when the library session is logged out', async () => {
  assert.equal(isLoggedOutState('close'), true);
  assert.equal(isLoggedOutState('open'), false);
  let sends = 0;
  const { updates, Message } = messageSink();
  const r = await deliver(logRow, { libraryId: 'lib-a', number: '9198', body: 'hi' }, {
    delaysMs: [1, 1, 1],
    sleep: async () => { throw new Error('should not wait on a logged-out session'); },
    Message,
    client: {
      wake: async () => ({ instance: { state: 'close' } }),
      sendText: async () => { sends++; return { key: { id: 'no' } }; },
    },
  });
  assert.equal(sends, 0);
  assert.equal(r.status, 'skipped');
  assert.equal(r.reason, 'disconnected');
  assert.equal(updates.at(-1).status, 'skipped');
  assert.equal(updates.at(-1).reason, 'disconnected');
});

test('send and receipt retry skip a disconnected session without calling the provider', async () => {
  let sends = 0;
  const client = {
    connectionState: async () => ({ instance: { state: 'close' } }),
    sendText: async () => { sends++; return { key: { id: 'no' } }; },
  };
  const d = {
    retryDelaysMs: [],
    client,
    Config: { findOne: () => lean(null) }, Lib: { findOne: () => lean({ name: 'L' }) },
    Message: { findOne: () => lean(null), findOneAndUpdate: async (_f, u) => ({ _id: 'log1', attempts: 1, ...u.$set }), updateOne: async () => {} },
  };
  const sent = await sendWhatsappMessage({ libraryId: 'lib-a', type: 'renewal_receipt', to: '9876543210', text: 'Paid', dedupeKey: 'receipt:R9' }, d);
  assert.equal(sent.status, 'skipped');
  assert.equal(sent.reason, 'disconnected');
  assert.equal(sends, 0);

  const row = { _id: 'm1', libraryId: 'lib-a', type: 'renewal_receipt', status: 'failed', attempts: 1, to: '919876543210', text: 'x', transient: true };
  let claimed = false;
  const Message = {
    find: () => ({ limit: () => lean([row]) }),
    findOneAndUpdate: async () => { claimed = true; return null; },
    updateOne: async () => {},
    updateMany: async () => ({}),
  };
  const out = await retryFailedReceipts({ Message, retryDelaysMs: [], client });
  assert.equal(claimed, false);
  assert.deepEqual(out, { retried: 0, sent: 0, failed: 0, skipped: 1 });
  assert.equal(sends, 0);
});

// Evolution cold-start handling: wake + backoff in the send path, and the receipt retry job. All mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvolutionError } from '../src/evolution.js';
import { sendWhatsappMessage, retryFailedReceipts, isTransientError } from '../src/whatsapp.js';

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
  assert.deepEqual(out, { retried: 1, sent: 1, failed: 0 });
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

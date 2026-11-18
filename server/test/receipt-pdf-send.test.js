import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendReceipt, sendWhatsappMessage } from '../src/whatsapp.js';

const lean = (v) => ({ lean: async () => v });
const payment = { _key: 'R1', receiptNo: 'R1', studentId: 'S1', netTotal: 800, method: 'UPI', referenceNo: 'UTR1', date: '2026-11-18' };
const student = { _key: 'S1', name: 'Asha', phone: '9876543210' };

function messageStore() {
  const rows = [];
  let creates = 0;
  const Message = {
    rows,
    findOne: (q) => lean(rows.find(r => r.libraryId === q.libraryId && r.dedupeKey === q.dedupeKey) || null),
    findOneAndUpdate: async (filter, update) => {
      let row = rows.find(r => r.libraryId === filter.libraryId && r.dedupeKey === filter.dedupeKey);
      if (!row) {
        row = { _id: 'log1', libraryId: filter.libraryId, dedupeKey: filter.dedupeKey, attempts: 0 };
        rows.push(row);
      }
      Object.assign(row, update.$set);
      row.attempts = (row.attempts || 0) + (update.$inc?.attempts || 0);
      return row;
    },
    updateOne: async (filter, update) => {
      const row = rows.find(r => String(r._id) === String(filter._id)) || rows[0];
      if (row) Object.assign(row, update.$set);
    },
  };
  const Payments = {
    findOne: () => lean(payment),
    create: async () => { creates += 1; },
    insertMany: async () => { creates += 1; },
  };
  return { Message, Payments, rows, get creates() { return creates; } };
}

function client({ fail = false, state = 'open' } = {}) {
  const media = [];
  return {
    media,
    wake: async () => ({ instance: { state } }),
    sendText: async () => { throw new Error('receipts must not use sendText'); },
    sendMedia: async (instance, payload) => {
      if (fail) throw new Error('provider down');
      media.push({ instance, payload });
      return { key: { id: 'pdf1' } };
    },
  };
}

const depsFor = (store, c) => ({
  Payments: store.Payments,
  Students: { findOne: () => lean(student) },
  messageDeps: {
    Message: store.Message,
    Config: { findOne: () => lean({ enabled: true, receipts: true, paymentReceipts: true }) },
    Lib: { findOne: () => lean({ name: 'Sunrise Library' }) },
    retryDelaysMs: [],
  },
});

test('sendReceipt attaches a PDF document and does not create a payment', async () => {
  const store = messageStore();
  const c = client();
  const r = await sendReceipt({ tenantId: 'lib-a', libraryId: 'lib-a', receiptNo: 'R1', type: 'admission_receipt', client: c }, depsFor(store, c));
  assert.equal(r.status, 'sent');
  assert.equal(store.creates, 0);
  assert.equal(c.media.length, 1);
  const payload = c.media[0].payload;
  assert.equal(payload.mediatype, 'document');
  assert.equal(payload.mimetype, 'application/pdf');
  assert.equal(payload.fileName, 'R1.pdf');
  assert.match(payload.caption, /R1/);
  const bytes = Buffer.from(payload.media, 'base64');
  assert.equal(bytes.subarray(0, 4).toString('ascii'), '%PDF');
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].dedupeKey, 'receipt:R1');
  assert.equal(store.rows[0].status, 'sent');
});

test('a failed PDF send stays failed', async () => {
  const store = messageStore();
  const c = client({ fail: true });
  const r = await sendReceipt({ tenantId: 'lib-a', libraryId: 'lib-a', receiptNo: 'R1', client: c }, depsFor(store, c));
  assert.equal(r.status, 'failed');
  assert.equal(store.rows[0].status, 'failed');
  assert.equal(c.media.length, 0);
  assert.equal(store.creates, 0);
});

test('resend reuses the same log row and does not insert another payment', async () => {
  const store = messageStore();
  const c = client({ fail: true });
  await sendReceipt({ tenantId: 'lib-a', libraryId: 'lib-a', receiptNo: 'R1', client: c }, depsFor(store, c));
  assert.equal(store.rows[0].status, 'failed');
  const again = client();
  const r = await sendReceipt({ tenantId: 'lib-a', libraryId: 'lib-a', receiptNo: 'R1', type: 'renewal_receipt', client: again }, depsFor(store, again));
  assert.equal(r.status, 'sent');
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].dedupeKey, 'receipt:R1');
  assert.equal(store.rows[0].status, 'sent');
  assert.equal(store.creates, 0);
  assert.equal(Buffer.from(again.media[0].payload.media, 'base64').subarray(0, 4).toString('ascii'), '%PDF');
});

test('disconnected WhatsApp does not send the PDF', async () => {
  const store = messageStore();
  const c = client({ state: 'close' });
  const r = await sendReceipt({ tenantId: 'lib-a', libraryId: 'lib-a', receiptNo: 'R1', client: c }, depsFor(store, c));
  assert.equal(r.status, 'failed');
  assert.match(r.error, /disconnected/i);
  assert.equal(c.media.length, 0);
  assert.equal(store.rows[0].status, 'failed');
});

test('deliver uses sendMedia when a document is passed', async () => {
  const sent = [];
  const updates = [];
  const pdf = Buffer.from('%PDF-1.4\n');
  const r = await sendWhatsappMessage({
    libraryId: 'lib-a', type: 'admission_receipt', to: '9876543210', text: 'Paid', dedupeKey: 'receipt:R9',
    document: { base64: pdf.toString('base64'), fileName: 'R9.pdf', mimetype: 'application/pdf' },
  }, {
    retryDelaysMs: [],
    client: {
      wake: async () => ({ instance: { state: 'open' } }),
      sendMedia: async (...a) => { sent.push(a); return { key: { id: 'm' } }; },
    },
    Config: { findOne: () => lean({ enabled: true, paymentReceipts: true }) },
    Lib: { findOne: () => lean({ name: 'Sunrise' }) },
    Message: {
      findOne: () => lean(null),
      findOneAndUpdate: async (_f, u) => ({ _id: 'log1', attempts: 1, ...u.$set }),
      updateOne: async (_f, u) => { updates.push(u.$set); },
    },
  });
  assert.equal(r.status, 'sent');
  assert.equal(sent[0][1].fileName, 'R9.pdf');
  assert.equal(sent[0][1].mimetype, 'application/pdf');
  assert.equal(Buffer.from(sent[0][1].media, 'base64').subarray(0, 4).toString('ascii'), '%PDF');
  assert.equal(updates.at(-1).status, 'sent');
});

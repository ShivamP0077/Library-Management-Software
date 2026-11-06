// Issue #20: global ticket numbering migration. Builds a legacy fixture with duplicate per-library
// numbers, proves the default is a no-write dry run, then applies the migration and verifies
// chronological global numbers, legacy aliases, preserved attachment bytes, and counter continuation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  SupportTicket,
  SupportTicketCounter,
  SUPPORT_NUMBERING_VERSION,
  SUPPORT_COUNTER_ID,
  nextSupportTicketNumber,
  detectSupportNumberDuplicates,
} from '../src/support.js';
import { migrateSupportNumbering } from '../scripts/support-global-numbering.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let mongod;
let original; // pre-migration snapshot of every legacy document

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'lms_support_numbering_test' });
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));

  const now = Date.now();
  await SupportTicket.collection.insertMany([
    {
      _id: new mongoose.Types.ObjectId(), tenantId: 'lib-a', number: 1, subject: 'Oldest A', createdAt: new Date(now - 5000),
      messages: [{ body: 'keep this body', attachments: [{ name: 'shot.png', type: 'image/png', size: 100, data: PNG }] }],
    },
    { _id: new mongoose.Types.ObjectId(), tenantId: 'lib-b', number: 1, subject: 'Second B', createdAt: new Date(now - 4000), messages: [{ body: 'b' }] },
    { _id: new mongoose.Types.ObjectId(), tenantId: 'lib-a', number: 2, subject: 'Third A', createdAt: new Date(now - 3000), messages: [{ body: 'a2' }] },
    { _id: new mongoose.Types.ObjectId(), tenantId: 'lib-b', number: 3, subject: 'Fourth B', createdAt: new Date(now - 2000), messages: [{ body: 'b3' }] },
  ]);
  // This legacy index is valid for the old per-library numbering, but is wrong for global numbers.
  await SupportTicket.collection.createIndex({ tenantId: 1, number: 1 }, { unique: true, name: 'tenantId_1_number_1' });
  original = await SupportTicket.collection.find().sort({ _id: 1 }).toArray();
});

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

test('dry run reports duplicate old numbering but writes nothing', async () => {
  const before = await SupportTicket.collection.find().sort({ _id: 1 }).toArray();
  const summary = await migrateSupportNumbering({ apply: false, log: () => {} });
  const after = await SupportTicket.collection.find().sort({ _id: 1 }).toArray();
  assert.deepEqual(after, before, 'dry run must not change documents');
  assert.equal(summary.ticketCount, 4);
  assert.deepEqual(summary.duplicatesBefore, [{ number: 1, count: 2 }]);
  assert.equal(summary.wouldCreateGlobalIndex, true);
  assert.ok(summary.wouldDropLegacyIndexes.includes('tenantId_1_number_1'));
  const indexes = await SupportTicket.collection.indexes();
  assert.ok(indexes.some(ix => ix.name === 'tenantId_1_number_1'), 'legacy index stays in dry run');
  assert.ok(!indexes.some(ix => ix.unique && Object.keys(ix.key).length === 1 && ix.key.number === 1), 'no global index yet');
  assert.equal(await SupportTicketCounter.countDocuments({}), 0, 'counter untouched in dry run');
});

test('apply renumbers chronological globally, keeps blobs byte-for-byte and creates aliases', async () => {
  const summary = await migrateSupportNumbering({ apply: true, log: () => {} });
  const docs = await SupportTicket.collection.find().sort({ number: 1 }).toArray();
  assert.deepEqual(docs.map(d => d.number), [1, 2, 3, 4], 'number 1 + 1, last = max');
  assert.deepEqual(docs.map(d => d.subject), ['Oldest A', 'Second B', 'Third A', 'Fourth B'], 'chronology by createdAt');
  assert.equal(docs[docs.length - 1].number, summary.lastNumber);
  assert.ok(docs.every(d => d.migrationVersion === SUPPORT_NUMBERING_VERSION));

  // Original tenant/number is searchable as an alias.
  const alias = await SupportTicket.collection.findOne({ 'legacyAliases': { $elemMatch: { tenantId: 'lib-b', number: 1 } } });
  assert.equal(alias.subject, 'Second B');
  assert.equal(alias.legacyAliases[0].label, '#1');

  // Message body and attachment data URL survive exactly (no document replacement).
  const oldest = docs.find(d => d.subject === 'Oldest A');
  assert.equal(oldest.messages[0].body, 'keep this body');
  assert.equal(oldest.messages[0].attachments[0].data, PNG);

  assert.equal((await detectSupportNumberDuplicates()).length, 0);
  const indexes = await SupportTicket.collection.indexes();
  assert.ok(!indexes.some(ix => ix.unique && ix.key.tenantId === 1 && ix.key.number === 1), 'legacy unique index dropped');
  assert.ok(indexes.some(ix => ix.unique && ix.key.number === 1), 'global unique number index exists');

  // Same documents (same _ids), same messages/attachments, only number/aliases/version changed.
  const migrated = await SupportTicket.collection.find().sort({ _id: 1 }).toArray();
  assert.deepEqual(migrated.map(d => String(d._id)), original.map(d => String(d._id)), 'ticket ids intact');
  for (let i = 0; i < original.length; i++) {
    const { number: _n0, legacyAliases: _a0, migrationVersion: _v0, ...restBefore } = original[i];
    const { number: _n1, legacyAliases: aliases, migrationVersion: _v1, ...restAfter } = migrated[i];
    assert.deepEqual(restAfter, restBefore, `ticket ${original[i].subject}: every other field incl. messages unchanged`);
    // Every historical tenant/number is aliased, including ones whose number did not change.
    assert.deepEqual(aliases.map(a => [a.tenantId, a.number]), [[original[i].tenantId, original[i].number]]);
  }

  const counter = await SupportTicketCounter.findById(SUPPORT_COUNTER_ID).lean();
  assert.equal(counter.value, 4);
  assert.equal(await nextSupportTicketNumber(), 5, 'next number is last + 1');
});

test('applying twice is idempotent', async () => {
  const before = await SupportTicket.collection.find().sort({ number: 1 }).toArray();
  await migrateSupportNumbering({ apply: true, log: () => {} });
  const after = await SupportTicket.collection.find().sort({ number: 1 }).toArray();
  assert.deepEqual(after, before, 'second apply changes nothing at all');
  assert.deepEqual(after.map(d => d.number), before.map(d => d.number));
  assert.deepEqual(after.map(d => d.legacyAliases), before.map(d => d.legacyAliases), 'no duplicate aliases');
  assert.equal(await SupportTicketCounter.findById(SUPPORT_COUNTER_ID).lean().then(c => c.value), 4, 'counter not advanced by re-run');
});

// ---- CLI safety: explicit fixture URI only, never production, dry run creates nothing ----
const SCRIPT = fileURLToPath(new URL('../scripts/support-global-numbering.mjs', import.meta.url));
const runCli = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 60000,
  env: { PATH: process.env.PATH, NODE_ENV: 'test', ...env },
});

test('CLI refuses without an explicit --uri, even when MONGO_URI is set', () => {
  const r = runCli([], { MONGO_URI: mongod.getUri() + 'should_not_be_used' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pass the target explicitly with --uri/);
});

test('CLI refuses NODE_ENV=production', () => {
  const r = runCli(['--uri', mongod.getUri(), '--db', 'cli_prod_guard'], { NODE_ENV: 'production' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /NODE_ENV=production/);
});

test('CLI dry run against a legacy fixture writes nothing and auto-creates no collection or index', async () => {
  const db = mongoose.connection.client.db('cli_fixture');
  const docs = [
    { tenantId: 'lib-x', number: 1, subject: 'X1', createdAt: new Date(1000), messages: [{ _id: new mongoose.Types.ObjectId(), body: 'x' }] },
    { tenantId: 'lib-y', number: 1, subject: 'Y1', createdAt: new Date(2000), messages: [{ _id: new mongoose.Types.ObjectId(), body: 'y' }] },
  ];
  await db.collection('supporttickets').insertMany(docs);
  const snap = async () => ({
    collections: (await db.listCollections().toArray()).map(c => c.name).sort(),
    indexes: await db.collection('supporttickets').indexes(),
    docs: await db.collection('supporttickets').find().sort({ _id: 1 }).toArray(),
  });
  const before = await snap();
  const r = runCli(['--uri', mongod.getUri(), '--db', 'cli_fixture']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN complete\. Nothing was written/);
  assert.match(r.stdout, /duplicate number groups=1/);
  assert.deepEqual(await snap(), before, 'no documents, indexes or collections (e.g. counters) created');

  const applied = runCli(['--uri', mongod.getUri(), '--db', 'cli_fixture', '--apply']);
  assert.equal(applied.status, 0, applied.stderr);
  const after = await db.collection('supporttickets').find().sort({ _id: 1 }).toArray();
  assert.deepEqual(after.map(d => d.number), [1, 2]);
  assert.deepEqual(after.map(d => d.messages), before.docs.map(d => d.messages), 'message ids/bodies intact');
  assert.deepEqual(after.map(d => d.legacyAliases.map(a => `${a.tenantId}#${a.number}`)), [['lib-x#1'], ['lib-y#1']]);
  const again = runCli(['--uri', mongod.getUri(), '--db', 'cli_fixture', '--apply']);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(await db.collection('supporttickets').find().sort({ _id: 1 }).toArray(), after, 'CLI re-apply is idempotent');
});

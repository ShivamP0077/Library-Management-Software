// Tests for the legacy -> tenantId migration.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { migrateTenants } from '../src/migrate-tenants.js';
import { models, Library, User, Settings, StudentDocument } from '../src/models.js';

const Student = models.students;
const Payment = models.payments;
let mongod;

// Build the legacy schema by hand; don't let mongoose auto-create the new indexes.
mongoose.set('autoIndex', false);

const ignoreNs = (e) => { if (e.code === 26 || /ns does not exist/i.test(e.message)) return; throw e; };

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'lms_migration_test' });

  // Simulate a legacy database: old libraryId indexes, no tenantId indexes.
  for (const Model of [Student, Payment, Settings, StudentDocument]) {
    try { await Model.collection.dropIndexes(); } catch (e) { ignoreNs(e); }
  }
  await Student.collection.createIndex({ libraryId: 1, _key: 1 }, { unique: true });
  await Payment.collection.createIndex({ libraryId: 1, _key: 1 }, { unique: true });
  await Settings.collection.createIndex({ libraryId: 1 }, { unique: true });
  await StudentDocument.collection.createIndex({ libraryId: 1, storageKey: 1 }, { unique: true });

  await Student.collection.insertMany([
    { libraryId: 'lib-a', _key: 'S1', name: 'Alice' },
    { libraryId: 'lib-b', _key: 'S1', name: 'Bob' },
    { _key: 'S-ORPHAN', name: 'Orphan' }, // neither tenantId nor libraryId
  ]);
  await Payment.collection.insertMany([
    { libraryId: 'lib-a', _key: 'P1', receiptNo: 'P1', netTotal: 100 },
  ]);
  await Settings.collection.insertOne({ libraryId: 'lib-a', name: 'A Settings' });
  await StudentDocument.collection.insertMany([
    { libraryId: 'lib-a', storageKey: 'doc-a', data: 'a' },
    { storageKey: 'doc-orphan', data: 'o' },
  ]);
  await User.collection.insertMany([
    { email: 'legacy-a@test.local', role: 'client_admin', libraryId: 'lib-a', name: 'Legacy A', status: 'Active' },
    { email: 'legacy-b@test.local', role: 'staff', libraryId: 'lib-b', name: 'Legacy B', status: 'Active' },
    { email: 'sa@test.local', role: 'superadmin', name: 'SA', status: 'Active' },
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

test('dry run reports counts but writes nothing', async () => {
  const logs = [];
  const summary = await migrateTenants({ apply: false, log: (...a) => logs.push(a.join(' ')) });

  assert.equal(summary.apply, false);
  assert.equal(summary.defaultLibraryCreated, false);
  assert.equal(summary.defaultLibraryWouldCreate, true);
  assert.equal(await Library.countDocuments({}), 0, 'default library must not be created in dry run');
  assert.equal((await Student.collection.findOne({ libraryId: 'lib-a' })).tenantId, undefined);
  assert.equal((await Student.collection.findOne({ _key: 'S-ORPHAN' })).tenantId, undefined);
  assert.equal((await User.collection.findOne({ email: 'legacy-a@test.local' })).tenantId, undefined);
  assert.equal(summary.collections.students.fromLibraryId, 2);
  assert.equal(summary.collections.students.defaulted, 1);
  assert.equal(summary.collections.users.fromLibraryId, 2);
  assert.ok(logs.some(l => l.includes('DRY RUN')));

  // legacy indexes still present (dry run made no structural changes)
  const idx = await Student.collection.indexes();
  assert.ok(idx.some(ix => 'libraryId' in ix.key));
});

test('apply backfills tenantId, creates the default tenant and rebuilds indexes', async () => {
  const summary = await migrateTenants({ apply: true, log: () => {} });

  assert.equal(summary.defaultLibraryCreated, true);
  const lib = await Library.findOne({ libraryId: 'lib-default' }).lean();
  assert.ok(lib);
  assert.equal(lib.isDefault, true);
  assert.equal(lib.name, 'Default Library');

  const a = await Student.findOne({ tenantId: 'lib-a', _key: 'S1' }).lean();
  const b = await Student.findOne({ tenantId: 'lib-b', _key: 'S1' }).lean();
  const orphan = await Student.findOne({ tenantId: 'lib-default', _key: 'S-ORPHAN' }).lean();
  assert.equal(a.name, 'Alice');
  assert.equal(b.name, 'Bob');
  assert.equal(orphan.name, 'Orphan');
  // legacy field kept for rollback
  assert.equal(a.libraryId, 'lib-a');
  assert.equal(orphan.libraryId, undefined);

  assert.equal((await Payment.findOne({ tenantId: 'lib-a', _key: 'P1' })).netTotal, 100);
  assert.equal((await Settings.findOne({ tenantId: 'lib-a' })).name, 'A Settings');
  assert.equal((await StudentDocument.findOne({ tenantId: 'lib-a', storageKey: 'doc-a' })).data, 'a');
  assert.equal((await StudentDocument.findOne({ tenantId: 'lib-default', storageKey: 'doc-orphan' })).data, 'o');

  const ua = await User.findOne({ email: 'legacy-a@test.local' }).lean();
  assert.equal(ua.tenantId, 'lib-a');
  assert.equal(ua.libraryId, 'lib-a');
  const sa = await User.findOne({ email: 'sa@test.local' }).lean();
  assert.equal(sa.tenantId, undefined, 'superadmin stays tenant-less');

  assert.ok(summary.collections.students.updatedFromLibraryId >= 2);
  assert.ok(summary.collections.students.defaulted >= 1);

  // Old indexes are gone, new per-tenant unique indexes exist.
  const studentIdx = await Student.collection.indexes();
  assert.ok(!studentIdx.some(ix => 'libraryId' in ix.key));
  assert.ok(studentIdx.some(ix => ix.unique && ix.key.tenantId === 1 && ix.key._key === 1));
  const settingsIdx = await Settings.collection.indexes();
  assert.ok(!settingsIdx.some(ix => 'libraryId' in ix.key));
  assert.ok(settingsIdx.some(ix => ix.unique && ix.key.tenantId === 1));
  const docIdx = await StudentDocument.collection.indexes();
  assert.ok(!docIdx.some(ix => 'libraryId' in ix.key));
  assert.ok(docIdx.some(ix => ix.unique && ix.key.tenantId === 1 && ix.key.storageKey === 1));
});

test('applying twice is idempotent', async () => {
  const before = await Student.collection.find().sort({ _id: 1 }).toArray();
  const summary = await migrateTenants({ apply: true, log: () => {} });
  const after = await Student.collection.find().sort({ _id: 1 }).toArray();
  assert.deepEqual(after, before);
  assert.equal(summary.collections.students.fromLibraryId, 0);
  assert.equal(summary.collections.students.defaulted, 0);
  assert.equal(await Library.countDocuments({ libraryId: 'lib-default' }), 1);
});

test('isolation holds after migration', async () => {
  assert.equal(await Student.countDocuments({ tenantId: 'lib-a' }), 1);
  assert.equal((await Student.find({ tenantId: 'lib-a', _key: 'S1' })).length, 1);
  assert.equal((await Student.find({ tenantId: 'lib-b', _key: 'S1' })).length, 1);
  assert.equal((await Student.find({ tenantId: 'lib-a', _key: 'S1' }))[0].name, 'Alice');
  assert.equal((await Student.find({ tenantId: 'lib-b', _key: 'S1' }))[0].name, 'Bob');
  assert.equal(await Student.countDocuments({ tenantId: 'lib-b' }), 1);
  assert.equal(await StudentDocument.countDocuments({ tenantId: 'lib-a' }), 1);
  assert.equal(await StudentDocument.countDocuments({ tenantId: 'lib-default' }), 1);
});

test('refuses to apply when legacy docs would collide on the new unique key', async () => {
  try { await Student.collection.dropIndex('tenantId_1__key_1'); } catch (e) { ignoreNs(e); }
  await Student.collection.insertMany([
    { libraryId: 'lib-c', _key: 'DUP', name: 'C1' },
    { libraryId: 'lib-c', _key: 'DUP', name: 'C2' },
  ]);
  await assert.rejects(
    migrateTenants({ apply: true, log: () => {} }),
    (err) => err.code === 'TENANT_COLLISION'
  );
});

// Unit/integration tests for the tenant guard plugin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { models, Settings, StudentDocument } from '../src/models.js';

const Student = models.students;
let mongod;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'lms_guard_test' });
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
});

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

const isGuardError = (model) => (err) => {
  assert.equal(err.status, 500);
  assert.match(err.message, new RegExp(`Tenant guard: query on ${model} without tenantId`));
  return true;
};

test('every query operation without tenantId throws', async () => {
  const ops = {
    find: () => Student.find({}),
    findOne: () => Student.findOne({}),
    findOneAndUpdate: () => Student.findOneAndUpdate({}, { $set: { name: 'x' } }),
    findOneAndReplace: () => Student.findOneAndReplace({}, { name: 'x' }),
    findOneAndDelete: () => Student.findOneAndDelete({}),
    updateOne: () => Student.updateOne({}, { $set: { name: 'x' } }),
    updateMany: () => Student.updateMany({}, { $set: { name: 'x' } }),
    replaceOne: () => Student.replaceOne({}, { name: 'x' }),
    deleteOne: () => Student.deleteOne({}),
    deleteMany: () => Student.deleteMany({}),
    countDocuments: () => Student.countDocuments({}),
    // Model.exists() is implemented on top of findOne
    exists: () => Student.exists({}),
  };
  for (const [name, run] of Object.entries(ops)) {
    await assert.rejects(run(), isGuardError('Student'), `${name} should be guarded`);
  }
});

test('aggregate without a tenantId $match throws, including when there is no $match at all', async () => {
  await assert.rejects(Student.aggregate([{ $match: { status: 'Active' } }]), isGuardError('Student'));
  await assert.rejects(Student.aggregate([{ $group: { _id: '$status' } }]), isGuardError('Student'));
  // A first $match without a tenant is still rejected even if a later stage scopes
  await assert.rejects(Student.aggregate([{ $match: { status: 'x' } }, { $match: { tenantId: 'guard-a' } }]), isGuardError('Student'));
});

test('scoped queries pass for every tenant-owned model', async () => {
  const student = await Student.create({ tenantId: 'guard-a', _key: 'S-1', name: 'Alice' });
  assert.equal(student.tenantId, 'guard-a');
  assert.equal((await Student.find({ tenantId: 'guard-a' })).length, 1);
  assert.equal((await Student.findOne({ tenantId: 'guard-a', _key: 'S-1' })).name, 'Alice');
  assert.ok(await Student.exists({ tenantId: 'guard-a', _key: 'S-1' }));
  assert.equal(await Student.countDocuments({ tenantId: 'guard-a' }), 1);
  assert.equal((await Student.findOneAndUpdate({ tenantId: 'guard-a', _key: 'S-1' }, { $set: { name: 'Alice2' } }, { new: true })).name, 'Alice2');
  assert.equal((await Student.aggregate([{ $match: { tenantId: 'guard-a' } }, { $count: 'n' }]))[0].n, 1);

  await Settings.create({ tenantId: 'guard-a', name: 'Settings A' });
  assert.equal((await Settings.findOne({ tenantId: 'guard-a' })).name, 'Settings A');
  await StudentDocument.create({ tenantId: 'guard-a', storageKey: 'doc-1', data: 'abc' });
  assert.equal((await StudentDocument.findOne({ tenantId: 'guard-a', storageKey: 'doc-1' })).data, 'abc');
});

test('skipTenantGuard works for trusted platform queries', async () => {
  const all = await Student.find({}).setOptions({ skipTenantGuard: true });
  assert.ok(all.length >= 1);
  const agg = await Student.aggregate([{ $match: {} }, { $count: 'n' }]).option({ skipTenantGuard: true });
  assert.ok(agg[0].n >= 1);
});

test('documents without tenantId are rejected on validate/save', async () => {
  await assert.rejects(new Student({ _key: 'no-tenant' }).validate(), isGuardError('Student'));
  await assert.rejects(Student.create({ _key: 'no-tenant' }), isGuardError('Student'));
});

test('bulkWrite verifies tenantId on every operation filter', async () => {
  await assert.rejects(
    Student.bulkWrite([{ updateOne: { filter: { _key: 'S-1' }, update: { $set: { name: 'x' } } } }]),
    isGuardError('Student')
  );
  await assert.rejects(
    Student.bulkWrite([
      { updateOne: { filter: { tenantId: 'guard-a', _key: 'S-1' }, update: { $set: { name: 'ok' } } } },
      { deleteOne: { filter: { _key: 'S-1' } } },
    ]),
    isGuardError('Student')
  );
  const r = await Student.bulkWrite([
    { updateOne: { filter: { tenantId: 'guard-a', _key: 'S-1' }, update: { $set: { name: 'bulk-ok' } } } },
    { insertOne: { document: { tenantId: 'guard-b', _key: 'S-BULK', name: 'Bulk B' } } },
  ]);
  assert.equal(r.modifiedCount, 1);
  assert.equal((await Student.findOne({ tenantId: 'guard-a', _key: 'S-1' })).name, 'bulk-ok');
});

test('tenant isolation holds for reads, writes and deletes', async () => {
  await Student.create({ tenantId: 'guard-b', _key: 'S-1', name: 'Bob' });
  assert.equal((await Student.find({ tenantId: 'guard-b', _key: 'S-1' })).length, 1);
  assert.equal((await Student.findOne({ tenantId: 'guard-a', _key: 'S-1' })).name, 'bulk-ok');

  // B updating/deleting A's key is a no-op
  const upd = await Student.updateOne({ tenantId: 'guard-b', _key: 'S-1' }, { $set: { name: 'B only' } });
  assert.equal(upd.matchedCount, 1);
  assert.equal((await Student.findOne({ tenantId: 'guard-a', _key: 'S-1' })).name, 'bulk-ok');
  const del = await Student.deleteOne({ tenantId: 'guard-b', _key: 'S-NOPE' });
  assert.equal(del.deletedCount, 0);
  assert.ok(await Student.exists({ tenantId: 'guard-a', _key: 'S-1' }));
});

/**
 * TEMPORARY maintenance routes (remove after the multi-tenant rollout).
 * Mounted only when MAINT_TOKEN is set; every request must send
 * `x-maint-token: <MAINT_TOKEN>`. Responses contain counts/metadata only,
 * never document contents.
 */
import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { COLLECTIONS, models, Library, User, Settings, StudentDocument } from './models.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'lib-default';
const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME || 'Default Library';

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const db = () => {
  if (mongoose.connection.readyState !== 1) { const e = new Error('Database not connected'); e.status = 503; throw e; }
  return mongoose.connection.db;
};

/* ------------------------------- backup -------------------------------- */
async function backup() {
  const src = db();
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const targetName = `lm_backup_${ts}`; // Atlas caps database names at 38 bytes
  const dst = mongoose.connection.getClient().db(targetName);
  const result = { source: src.databaseName, target: targetName, collections: {}, ok: true };
  const cols = (await src.listCollections({}, { nameOnly: false }).toArray()).filter(c => c.type !== 'view' && !c.name.startsWith('system.'));
  for (const c of cols) {
    const s = src.collection(c.name);
    const opts = c.options && c.options.validator ? { validator: c.options.validator, validationLevel: c.options.validationLevel, validationAction: c.options.validationAction } : {};
    await dst.createCollection(c.name, opts).catch(e => { if (e.codeName !== 'NamespaceExists') throw e; });
    const d = dst.collection(c.name);
    let batch = []; let copied = 0;
    for await (const doc of s.find({}, { batchSize: 500 })) {
      batch.push(doc);
      if (batch.length >= 500) { await d.insertMany(batch, { ordered: false }); copied += batch.length; batch = []; }
    }
    if (batch.length) { await d.insertMany(batch, { ordered: false }); copied += batch.length; }
    const indexes = (await s.indexes()).filter(ix => ix.name !== '_id_');
    let indexesCopied = 0;
    for (const ix of indexes) {
      const { key, v, ns, ...o } = ix; // eslint-disable-line no-unused-vars
      await d.createIndex(key, o); indexesCopied++;
    }
    const sourceCount = await s.countDocuments();
    const backupCount = await d.countDocuments();
    const match = sourceCount === backupCount;
    if (!match) result.ok = false;
    result.collections[c.name] = { sourceCount, backupCount, copied, indexes: indexes.length, indexesCopied, match };
  }
  return result;
}

/* ------------------------------ migration ------------------------------ */
const MISSING = { $in: [null, ''] };
const missingTenant = { tenantId: MISSING };
const hasLibrary = { libraryId: { $exists: true, $nin: [null, ''] } };
const missingBoth = { tenantId: MISSING, libraryId: MISSING };
const tenantTargets = () => [
  ...Object.keys(COLLECTIONS).map(col => ({ col, coll: models[col].collection, uniqueBy: ['_key'] })),
  { col: 'settings', coll: Settings.collection, uniqueBy: [] },
  { col: 'studentdocuments', coll: StudentDocument.collection, uniqueBy: ['storageKey'] },
];
const effectiveTenantExpr = (def) => {
  const present = (v) => ({ $and: [{ $ne: [v, null] }, { $ne: [v, ''] }] });
  const t = { $ifNull: ['$tenantId', null] }, l = { $ifNull: ['$libraryId', null] };
  return { $cond: [present(t), t, { $cond: [present(l), l, def] }] };
};

/** Vendored copy of PR #2's migrateTenants steps 1-3 (collision check, default tenant, backfill). */
async function vendoredMigrate(apply) {
  const summary = { engine: 'vendored', apply, defaultTenantId: DEFAULT_TENANT_ID, defaultLibraryWouldCreate: false, defaultLibraryCreated: false, collections: {}, collisions: [], indexes: 'deferred to multi-tenant release (its schemas own the new indexes)' };
  for (const t of tenantTargets()) {
    const groupId = { tenantId: '$__t', ...Object.fromEntries(t.uniqueBy.map(k => [k, `$${k}`])) };
    const rows = await t.coll.aggregate([
      { $addFields: { __t: effectiveTenantExpr(DEFAULT_TENANT_ID) } },
      { $group: { _id: groupId, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $limit: 20 },
    ]).toArray();
    // Report only the tenant id and the duplicate count (keys may be business ids, not personal data).
    for (const r of rows) summary.collisions.push({ collection: t.col, tenantId: r._id.tenantId, count: r.count });
  }
  if (summary.collisions.length) { summary.refused = true; return summary; }
  const def = await Library.collection.findOne({ libraryId: DEFAULT_TENANT_ID });
  if (!def) {
    summary.defaultLibraryWouldCreate = true;
    if (apply) {
      await Library.collection.updateOne({ libraryId: DEFAULT_TENANT_ID },
        { $setOnInsert: { libraryId: DEFAULT_TENANT_ID, name: DEFAULT_TENANT_NAME, status: 'Active', createdBy: 'migration', createdAt: new Date(), updatedAt: new Date() }, $set: { isDefault: true } }, { upsert: true });
      summary.defaultLibraryCreated = true;
    }
  } else if (apply && !def.isDefault) await Library.collection.updateOne({ _id: def._id }, { $set: { isDefault: true } });
  const backfill = async (label, coll, extra = {}) => {
    const fromLib = { ...missingTenant, ...hasLibrary, ...extra }, both = { ...missingBoth, ...extra };
    const c = { total: await coll.countDocuments(), fromLibraryId: await coll.countDocuments(fromLib), defaulted: await coll.countDocuments(both) };
    if (apply) {
      if (c.fromLibraryId) c.updatedFromLibraryId = (await coll.updateMany(fromLib, [{ $set: { tenantId: '$libraryId' } }])).modifiedCount;
      if (c.defaulted) c.updatedDefaulted = (await coll.updateMany(both, [{ $set: { tenantId: DEFAULT_TENANT_ID } }])).modifiedCount;
      c.stillMissingTenant = await coll.countDocuments({ ...missingTenant, ...extra });
    }
    summary.collections[label] = c;
  };
  for (const t of tenantTargets()) await backfill(t.col, t.coll);
  await backfill('users', User.collection, { role: { $ne: 'superadmin' } });
  return summary;
}

async function migrate(apply) {
  let mod = null;
  try { mod = await import('./migrate-tenants.js'); } catch { mod = null; }
  if (mod && typeof mod.migrateTenants === 'function') {
    const log = [];
    try {
      const s = await mod.migrateTenants({ apply, log: (m) => log.push(String(m)) });
      return { engine: 'migrate-tenants.js', ...s, log };
    } catch (e) {
      if (e.code === 'TENANT_COLLISION') return { engine: 'migrate-tenants.js', apply, refused: true, collisions: (e.collisions || []).map(c => ({ collection: c.collection, count: c.count })), log };
      throw e;
    }
  }
  return vendoredMigrate(apply);
}

/* -------------------------------- schema ------------------------------- */
const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'date';
  if (v && v._bsontype) return v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID' ? 'objectId' : v._bsontype.toLowerCase();
  return typeof v;
};
function collectFields(doc, prefix, out, depth) {
  for (const [k, v] of Object.entries(doc || {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    (out[p] ||= new Set()).add(typeOf(v));
    if (depth < 2 && v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !v._bsontype) collectFields(v, p, out, depth + 1);
    if (depth < 2 && Array.isArray(v)) for (const item of v.slice(0, 20)) {
      if (item && typeof item === 'object' && !(item instanceof Date) && !item._bsontype) collectFields(item, `${p}[]`, out, depth + 1);
      else (out[`${p}[]`] ||= new Set()).add(typeOf(item));
    }
  }
}
async function schema() {
  const d = db();
  const res = { database: d.databaseName, generatedAt: new Date().toISOString(), sampleSize: 200, collections: {} };
  const cols = (await d.listCollections().toArray()).filter(c => c.type !== 'view' && !c.name.startsWith('system.')).sort((a, b) => a.name.localeCompare(b.name));
  for (const c of cols) {
    const coll = d.collection(c.name);
    const fields = {};
    for await (const doc of coll.aggregate([{ $sample: { size: 200 } }])) collectFields(doc, '', fields, 0);
    res.collections[c.name] = {
      fields: Object.fromEntries(Object.keys(fields).sort().map(k => [k, [...fields[k]].sort()])),
      indexes: (await coll.indexes()).map(({ ns, ...ix }) => ix), // eslint-disable-line no-unused-vars
      options: { validator: c.options?.validator || null, validationLevel: c.options?.validationLevel || null, validationAction: c.options?.validationAction || null, capped: !!c.options?.capped },
    };
  }
  return res;
}

/* -------------------------------- router ------------------------------- */
export function maintRouter() {
  const r = express.Router();
  r.use((req, res, next) => {
    if (!process.env.MAINT_TOKEN || !safeEqual(req.get('x-maint-token'), process.env.MAINT_TOKEN)) return res.status(404).json({ error: 'Not found' });
    next();
  });
  const h = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 500).json({ error: 'maintenance task failed', code: e.code || e.codeName || null, message: String(e.message).replace(/\/\/[^@/]+@/g, '//****@').slice(0, 300) }); }
  };
  r.post('/backup', h(() => backup()));
  r.post('/migrate-dry', h(() => migrate(false)));
  r.post('/migrate-apply', h(() => migrate(true)));
  r.post('/schema', h(() => schema()));
  return r;
}

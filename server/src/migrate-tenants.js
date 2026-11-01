/**
 * Idempotent multi-tenancy migration.
 *
 * Legacy documents were scoped by `libraryId`; the canonical tenant key is now
 * `tenantId`. This script backfills tenantId from libraryId (or the default
 * tenant), verifies that per-tenant unique keys will not collide, and rebuilds
 * indexes. The legacy `libraryId` field is intentionally left in place so the
 * migration can be rolled back.
 *
 *   node src/migrate-tenants.js            # dry run (default): counts only
 *   node src/migrate-tenants.js --apply    # write changes
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'url';
import { connectDB, redact } from './db.js';
import { COLLECTIONS, models, Library, User, Settings, StudentDocument } from './models.js';

export const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'lib-default';
export const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME || 'Default Library';

const TENANT_MODELS = [
  ...Object.entries(COLLECTIONS).map(([col, def]) => ({ col, model: models[col], uniqueBy: ['_key'] })),
  { col: 'settings', model: Settings, uniqueBy: [] },
  { col: 'studentdocuments', model: StudentDocument, uniqueBy: ['storageKey'] },
];

const noop = () => {};

// A document is missing its tenant when tenantId is absent, null or empty.
const MISSING = { $in: [null, ''] };
const missingTenant = { tenantId: MISSING };
const missingLibrary = { libraryId: { $exists: true, $nin: [null, ''] } };
const missingBoth = { tenantId: MISSING, libraryId: MISSING };

/**
 * Effective tenant of a document after migration:
 * tenantId (if set) -> libraryId (if set) -> default.
 */
const effectiveTenantExpr = (defaultTenantId) => {
  const tenant = { $ifNull: ['$tenantId', null] };
  const library = { $ifNull: ['$libraryId', null] };
  const present = (value) => ({ $and: [{ $ne: [value, null] }, { $ne: [value, ''] }] });
  return {
    $cond: [
      present(tenant),
      tenant,
      { $cond: [present(library), library, defaultTenantId] },
    ],
  };
};

async function count(model, filter) {
  return model.collection.countDocuments(filter);
}

async function findCollisions({ model, uniqueBy }, defaultTenantId) {
  const groupId = uniqueBy.length
    ? Object.fromEntries([['tenantId', '$__tenantId'], ...uniqueBy.map(k => [k, `$${k}`])])
    : { tenantId: '$__tenantId' };
  const rows = await model.collection.aggregate([
    { $addFields: { __tenantId: effectiveTenantExpr(defaultTenantId) } },
    { $group: { _id: groupId, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]).toArray();
  return rows;
}

async function legacyIndexes(model) {
  let indexes = [];
  try {
    indexes = await model.collection.indexes();
  } catch (e) {
    if (e.code === 26 || /ns does not exist/i.test(e.message)) return [];
    throw e;
  }
  return indexes.filter(ix => Object.keys(ix.key || {}).includes('libraryId'));
}

/**
 * Runs the migration on the current mongoose connection.
 *
 * @param {object} opts
 * @param {boolean} [opts.apply=false] write changes; otherwise dry run
 * @param {string} [opts.defaultTenantId]
 * @param {string} [opts.defaultTenantName]
 * @param {Function} [opts.log]
 * @returns {Promise<object>} summary
 */
export async function migrateTenants({
  apply = false,
  defaultTenantId,
  defaultTenantName,
  log = console.log,
} = {}) {
  defaultTenantId = defaultTenantId || process.env.DEFAULT_TENANT_ID || DEFAULT_TENANT_ID;
  defaultTenantName = defaultTenantName || process.env.DEFAULT_TENANT_NAME || DEFAULT_TENANT_NAME;
  const say = typeof log === 'function' ? log : noop;
  const mode = apply ? 'APPLY' : 'DRY RUN';
  say(`[migrate] ${mode} — default tenant "${defaultTenantId}" (${defaultTenantName})`);

  const summary = {
    apply,
    defaultTenantId,
    defaultTenantName,
    defaultLibraryCreated: false,
    defaultLibraryWouldCreate: false,
    collections: {},
    droppedIndexes: [],
    collisions: [],
  };

  // 1. Validate unique-key collisions before touching anything.
  for (const target of TENANT_MODELS) {
    const collisions = await findCollisions(target, defaultTenantId);
    if (collisions.length) {
      for (const c of collisions) {
        summary.collisions.push({ collection: target.col, key: c._id, count: c.count });
        say(`[migrate] COLLISION ${target.col}: ${JSON.stringify(c._id)} (${c.count} docs)`);
      }
    }
  }
  if (summary.collisions.length) {
    say(`[migrate] Refusing to migrate: ${summary.collisions.length} duplicate tenant key group(s) would violate a unique index`);
    const err = new Error('Tenant migration aborted: unique key collisions');
    err.code = 'TENANT_COLLISION';
    err.collisions = summary.collisions;
    throw err;
  }

  // 2. Ensure the default tenant exists.
  const existingDefault = await Library.findOne({ libraryId: defaultTenantId }).lean();
  if (existingDefault) {
    say(`[migrate] default library exists: ${defaultTenantId}`);
    if (apply && !existingDefault.isDefault) {
      await Library.updateOne({ libraryId: defaultTenantId }, { $set: { isDefault: true } });
    }
  } else {
    summary.defaultLibraryWouldCreate = true;
    say(`[migrate] default library ${apply ? 'created' : 'would be created'}: ${defaultTenantId}`);
    if (apply) {
      await Library.updateOne(
        { libraryId: defaultTenantId },
        { $setOnInsert: { libraryId: defaultTenantId, name: defaultTenantName, status: 'Active', createdBy: 'migration' }, $set: { isDefault: true } },
        { upsert: true }
      );
      summary.defaultLibraryCreated = true;
    }
  }

  // 3. Backfill tenantId per collection. Raw collection operations bypass the
  //    query guard and schema validation on purpose.
  const backfill = async (label, model, filters) => {
    const counts = {};
    for (const [name, filter] of Object.entries(filters)) counts[name] = await count(model, filter);
    summary.collections[label] = counts;
    say(`[migrate] ${label}: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ') || 'no legacy documents'}`);
    if (!apply) return;
    if (counts.fromLibraryId) {
      const r = await model.collection.updateMany(filters.fromLibraryId, [{ $set: { tenantId: '$libraryId' } }]);
      summary.collections[label].updatedFromLibraryId = r.modifiedCount;
    }
    if (counts.defaulted) {
      const r = await model.collection.updateMany(filters.defaulted, [{ $set: { tenantId: defaultTenantId } }]);
      summary.collections[label].defaulted = r.modifiedCount;
    }
  };

  for (const target of TENANT_MODELS) {
    await backfill(target.col, target.model, {
      fromLibraryId: { ...missingTenant, ...missingLibrary },
      defaulted: missingBoth,
    });
  }
  await backfill('users', User, {
    fromLibraryId: { ...missingTenant, ...missingLibrary, role: { $ne: 'superadmin' } },
    defaulted: { ...missingBoth, role: { $ne: 'superadmin' } },
  });

  // 4. Drop indexes that still reference libraryId, then rebuild from schemas.
  for (const target of TENANT_MODELS) {
    const indexes = await legacyIndexes(target.model);
    for (const ix of indexes) {
      summary.droppedIndexes.push({ collection: target.col, name: ix.name });
      say(`[migrate] ${apply ? 'dropping' : 'would drop'} legacy index ${target.col}.${ix.name}`);
      if (apply) {
        try { await target.model.collection.dropIndex(ix.name); }
        catch (e) { if (e.code !== 27 && e.codeName !== 'IndexNotFound') throw e; }
      }
    }
    if (apply) {
      await target.model.syncIndexes();
      say(`[migrate] ${target.col}: indexes synced`);
    }
  }

  // User.tenantId needs an index too; keep its legacy libraryId index for rollback.
  const userLegacy = await legacyIndexes(User);
  for (const ix of userLegacy) summary.droppedIndexes.push({ collection: 'users', name: ix.name, kept: true });
  if (apply) {
    await User.syncIndexes();
    say('[migrate] users: indexes synced');
  }

  say(`[migrate] done (${mode})`);
  return summary;
}

// CLI entry point: only connects, runs, and disconnects.
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  try {
    await connectDB();
    await migrateTenants({
      apply,
      defaultTenantId: process.env.DEFAULT_TENANT_ID || DEFAULT_TENANT_ID,
      defaultTenantName: process.env.DEFAULT_TENANT_NAME || DEFAULT_TENANT_NAME,
    });
  } catch (e) {
    console.error('[migrate] failed:', redact(e.message));
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

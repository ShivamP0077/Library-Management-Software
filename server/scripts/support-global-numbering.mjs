#!/usr/bin/env node
/**
 * Issue #20 — one-time safe migration to globally unique ticket numbers.
 *
 * DEFAULT IS A DRY RUN. Nothing is written unless --apply is passed.
 *
 *   cd server
 *   node scripts/support-global-numbering.mjs --uri <mongodb-uri> [--db <name>]            # inspect only
 *   node scripts/support-global-numbering.mjs --uri <mongodb-uri> [--db <name>] --apply    # maintenance window only
 *
 * The target database must be passed explicitly with --uri (or SUPPORT_MIGRATION_MONGO_URI).
 * .env / MONGO_URI are deliberately NOT read, NODE_ENV=production is refused, and the
 * connection disables mongoose autoIndex/autoCreate so a dry run creates nothing.
 *
 * Safety rules (do not skip):
 *   1. Back up the database first (server/src/backup.js or your provider snapshot).
 *   2. Pause support-ticket writes for the whole --apply run. This script renumbers every
 *      existing ticket chronologically and must not race new ticket creation.
 *   3. Run the dry run, review duplicate counts and the old/new mapping summary, then apply.
 *   4. Re-run the dry run afterwards: duplicates=0, first=1, last=max, unique index present.
 *   5. Keep this script (and the database backup) for rollback. The script only changes
 *      `number`, `legacyAliases` and `migrationVersion`; messages and attachment blobs are
 *      never read into memory or replaced.
 *
 * What --apply does:
 *   - sorts tickets by createdAt (then _id) and assigns 1..N globally;
 *   - appends the original {tenantId, number} to legacyAliases (searchable forever);
 *   - drops the legacy per-tenant {tenantId, number} unique index if present;
 *   - moves/sets the atomic SupportTicketCounter to N;
 *   - creates the global {number: 1} unique index (only after duplicates are gone).
 *
 * It is idempotent: running it again keeps the same numbers and does not duplicate aliases.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'url';
import { redact } from '../src/db.js';
import { SupportTicket, SupportTicketCounter, SUPPORT_COUNTER_ID, SUPPORT_NUMBERING_VERSION } from '../src/support.js';

const GLOBAL_INDEX = 'number_1';

// Every historical (pre-migration) number is kept as an alias, even when it happens to equal the
// new global number. Tickets already stamped with this migration version (or created by the new
// code) are never re-aliased, so re-runs are no-ops.
const needsAlias = (ticket, oldNumber) => Number.isFinite(oldNumber) && oldNumber > 0
  && ticket.migrationVersion !== SUPPORT_NUMBERING_VERSION;

const timestampOf = (doc) => {
  if (doc.createdAt) {
    const t = new Date(doc.createdAt).getTime();
    if (Number.isFinite(t)) return t;
  }
  try { return doc._id?.getTimestamp?.().getTime?.() || 0; } catch { return 0; }
};

export async function detectSupportDuplicates(collection) {
  return collection.aggregate([
    { $group: { _id: '$number', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
}

async function indexesOf(collection) {
  try { return await collection.indexes(); } catch (e) {
    if (e.code === 26 || /ns does not exist/i.test(e.message)) return [];
    throw e;
  }
}

const isLegacyTenantNumberUnique = (ix) => ix.unique
  && ix.key && ix.key.tenantId === 1 && ix.key.number === 1;

const isGlobalNumberIndex = (ix) => ix.key && Object.keys(ix.key).length === 1 && ix.key.number === 1;

/**
 * Run the migration on the current mongoose connection.
 * @param {{apply?: boolean, log?: Function, batchSize?: number, collection?: object, counter?: object}} opts
 */
export async function migrateSupportNumbering({ apply = false, log = console.log, batchSize = 200, collection, counter } = {}) {
  const say = typeof log === 'function' ? log : () => {};
  const col = collection || SupportTicket.collection;
  const counters = counter || SupportTicketCounter;
  const mode = apply ? 'APPLY' : 'DRY RUN';
  say(`[support-numbering] ${mode} (${SUPPORT_NUMBERING_VERSION})`);

  const docs = await col.find({}, {
    projection: { _id: 1, tenantId: 1, number: 1, createdAt: 1, legacyAliases: 1, migrationVersion: 1 },
  }).toArray();
  docs.sort((a, b) => {
    const d = timestampOf(a) - timestampOf(b);
    return d !== 0 ? d : String(a._id).localeCompare(String(b._id));
  });

  const duplicatesBefore = await detectSupportDuplicates(col);
  const indexesBefore = await indexesOf(col);
  const legacyIndexes = indexesBefore.filter(isLegacyTenantNumberUnique);
  const globalIndex = indexesBefore.find(isGlobalNumberIndex);
  const assignments = docs.map((t, i) => ({ ticket: t, oldNumber: Number(t.number), newNumber: i + 1 }));
  const changes = assignments.filter(a => a.oldNumber !== a.newNumber).length;
  const aliasAdds = assignments.filter(a => {
    const aliases = Array.isArray(a.ticket.legacyAliases) ? a.ticket.legacyAliases : [];
    return needsAlias(a.ticket, a.oldNumber)
      && !aliases.some(x => String(x?.tenantId) === String(a.ticket.tenantId) && Number(x?.number) === a.oldNumber);
  }).length;

  const summary = {
    apply,
    migrationVersion: SUPPORT_NUMBERING_VERSION,
    ticketCount: docs.length,
    firstNumber: assignments[0]?.newNumber || null,
    lastNumber: assignments[assignments.length - 1]?.newNumber || null,
    renumbered: changes,
    aliasesAdded: aliasAdds,
    duplicatesBefore: duplicatesBefore.map(d => ({ number: d._id, count: d.count })),
    legacyTenantNumberIndexes: legacyIndexes.map(ix => ix.name),
    globalUniqueIndexPresent: !!globalIndex?.unique,
    wouldDropLegacyIndexes: legacyIndexes.map(ix => ix.name),
    wouldCreateGlobalIndex: !globalIndex?.unique,
  };
  say(`[support-numbering] tickets=${summary.ticketCount} first=${summary.firstNumber ?? '-'} last=${summary.lastNumber ?? '-'} renumber=${changes} aliasAdds=${aliasAdds}`);
  say(`[support-numbering] duplicate number groups=${summary.duplicatesBefore.length}; legacy tenant+number unique indexes=${summary.legacyTenantNumberIndexes.join(', ') || 'none'}`);
  for (const d of summary.duplicatesBefore.slice(0, 20)) say(`[support-numbering] duplicate #${d.number} x${d.count}`);

  if (!apply) {
    say('[support-numbering] DRY RUN complete. Nothing was written. Re-run with --apply during a maintenance window.');
    return summary;
  }

  // 1. Drop the old per-tenant uniqueness (it is wrong once numbers are global).
  for (const ix of legacyIndexes) {
    say(`[support-numbering] dropping legacy index ${ix.name}`);
    try { await col.dropIndex(ix.name); } catch (e) {
      if (e.code !== 27 && e.codeName !== 'IndexNotFound') throw e;
    }
  }

  // 2. Renumber in small ordered batches. Only these three fields are touched, so message bodies
  //    and attachment blobs are preserved byte-for-byte.
  for (let start = 0; start < assignments.length; start += Math.max(1, batchSize)) {
    const chunk = assignments.slice(start, start + Math.max(1, batchSize));
    const ops = chunk.map(({ ticket, oldNumber, newNumber }) => {
      const aliases = Array.isArray(ticket.legacyAliases) ? [...ticket.legacyAliases] : [];
      if (needsAlias(ticket, oldNumber)
        && !aliases.some(x => String(x?.tenantId) === String(ticket.tenantId) && Number(x?.number) === oldNumber)) {
        aliases.push({ tenantId: ticket.tenantId || 'unknown', number: oldNumber, label: `#${oldNumber}` });
      }
      return {
        updateOne: {
          filter: { _id: ticket._id },
          update: { $set: { number: newNumber, legacyAliases: aliases, migrationVersion: SUPPORT_NUMBERING_VERSION } },
        },
      };
    });
    if (ops.length) await col.bulkWrite(ops, { ordered: true });
    say(`[support-numbering] renumbered ${Math.min(start + ops.length, assignments.length)}/${assignments.length}`);
  }

  // 3. Persist the high-water mark. New tickets start exactly after it.
  await counters.updateOne(
    { _id: SUPPORT_COUNTER_ID },
    { $set: { value: assignments.length, migrationVersion: SUPPORT_NUMBERING_VERSION } },
    { upsert: true }
  );

  // 4. Verify before creating the unique index.
  const duplicatesAfter = await detectSupportDuplicates(col);
  if (duplicatesAfter.length) {
    const err = new Error(`Support numbering still has ${duplicatesAfter.length} duplicate group(s); unique index not created`);
    err.code = 'SUPPORT_NUMBER_DUPLICATES';
    err.duplicates = duplicatesAfter;
    throw err;
  }

  const indexesAfter = await indexesOf(col);
  const existingGlobal = indexesAfter.find(isGlobalNumberIndex);
  if (existingGlobal && !existingGlobal.unique) {
    say(`[support-numbering] dropping non-unique ${existingGlobal.name}`);
    await col.dropIndex(existingGlobal.name);
  }
  if (!existingGlobal?.unique) {
    await col.createIndex({ number: 1 }, { unique: true, name: GLOBAL_INDEX });
    say(`[support-numbering] created unique index ${GLOBAL_INDEX}`);
  } else {
    say(`[support-numbering] unique index already present (${existingGlobal.name})`);
  }

  summary.duplicatesAfter = duplicatesAfter;
  summary.globalUniqueIndexPresent = true;
  say('[support-numbering] APPLY complete. Verify: duplicates=0, first=1, last=max, number_1 unique.');
  return summary;
}

export function parseCliArgs(argv = process.argv.slice(2), env = process.env) {
  const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const uri = val('--uri') || env.SUPPORT_MIGRATION_MONGO_URI;
  if (!uri || uri.startsWith('--')) throw Object.assign(new Error('Refusing to run: pass the target explicitly with --uri <mongodb-uri> (MONGO_URI/.env are ignored on purpose).'), { code: 'NO_URI' });
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) throw Object.assign(new Error('Refusing to run: --uri must be a mongodb:// or mongodb+srv:// URI.'), { code: 'BAD_URI' });
  if (String(env.NODE_ENV).toLowerCase() === 'production') throw Object.assign(new Error('Refusing to run with NODE_ENV=production from this CLI.'), { code: 'PRODUCTION' });
  return { uri, dbName: val('--db') || undefined, apply: argv.includes('--apply') && !argv.includes('--dry-run') };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  try {
    const { uri, dbName, apply } = parseCliArgs();
    await mongoose.connect(uri, { dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
    await migrateSupportNumbering({ apply });
  } catch (e) {
    console.error('[support-numbering] failed:', redact(e.message), e.duplicates || '');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

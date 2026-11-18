#!/usr/bin/env node
/**
 * Copy each library's current grace days and expired-period days onto student
 * periods that do not have those snapshots yet.
 *
 * DEFAULT IS DRY-RUN. Nothing is written unless APPLY=1.
 * Production apply needs a separate approval. Do not point this at Atlas.
 *
 *   cd server
 *   MONGODB_URI=mongodb://127.0.0.1:27017/library node scripts/backfill-period-snapshots.mjs
 *   APPLY=1 MONGODB_URI=mongodb://127.0.0.1:27017/library node scripts/backfill-period-snapshots.mjs
 *
 * Only 127.0.0.1 and localhost are allowed. There is no flag to override that.
 * APPLY writes a JSONL rollback file of the original student documents first.
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { periodSnapshots } from '../../src/utils/subscriptionLifecycle.js';

export function assertLocalMongoUri(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('Set MONGODB_URI to mongodb://127.0.0.1:27017/... or localhost. This script does not read .env.');
  }
  if (/mongodb\+srv/i.test(uri)) {
    throw new Error('Refusing mongodb+srv URI. This script only allows 127.0.0.1 or localhost.');
  }
  let host = '';
  try {
    host = new URL(uri.replace(/^mongodb:\/\//, 'http://')).hostname;
  } catch {
    throw new Error('Could not read the MongoDB host.');
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing MongoDB host "${host}". Only 127.0.0.1 or localhost is allowed.`);
  }
  return host;
}

export async function planSnapshotBackfill(students, settingsByTenant) {
  const changes = [];
  for (const student of students) {
    const missingGrace = student.graceDaysSnapshot == null || student.graceDaysSnapshot === '';
    const missingExpired = student.expiredPeriodDaysSnapshot == null || student.expiredPeriodDaysSnapshot === '';
    if (!missingGrace && !missingExpired) continue;
    const settings = settingsByTenant.get(String(student.tenantId)) || {};
    const snap = periodSnapshots(settings, student);
    changes.push({
      tenantId: student.tenantId,
      id: student.id || student._key,
      _id: student._id,
      set: {
        ...(missingGrace ? { graceDaysSnapshot: snap.graceDaysSnapshot } : {}),
        ...(missingExpired ? { expiredPeriodDaysSnapshot: snap.expiredPeriodDaysSnapshot } : {}),
      },
      before: student,
    });
  }
  return changes;
}

async function main() {
  const uri = process.env.MONGODB_URI || '';
  assertLocalMongoUri(uri);
  const apply = process.env.APPLY === '1';
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  const students = await mongoose.connection.collection('students').find({}).toArray();
  const settingsDocs = await mongoose.connection.collection('settings').find({}).toArray();
  const settingsByTenant = new Map(settingsDocs.map(s => [String(s.tenantId), s]));
  const changes = await planSnapshotBackfill(students, settingsByTenant);
  console.log(`[snapshots] ${apply ? 'APPLY' : 'DRY-RUN'} ${changes.length} student(s) of ${students.length} need snapshots.`);
  for (const c of changes) {
    console.log(`  ${c.tenantId} ${c.id} -> grace=${c.set.graceDaysSnapshot ?? '(keep)'} expiredPeriod=${c.set.expiredPeriodDaysSnapshot ?? '(keep)'}`);
  }
  if (!apply) {
    console.log('[snapshots] Dry run only. Set APPLY=1 to write. Production apply needs separate approval.');
    await mongoose.disconnect();
    return;
  }
  const dir = path.resolve('scripts/.rollback');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `period-snapshots-${Date.now()}.jsonl`);
  fs.appendFileSync(file, changes.map(c => JSON.stringify({ at: new Date().toISOString(), student: c.before })).join('\n') + (changes.length ? '\n' : ''));
  console.log(`[snapshots] Rollback file ${file}`);
  for (const c of changes) {
    await mongoose.connection.collection('students').updateOne({ _id: c._id }, { $set: c.set });
  }
  console.log(`[snapshots] Updated ${changes.length} student(s).`);
  await mongoose.disconnect();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch(err => {
    console.error('[snapshots]', err.message);
    process.exit(1);
  });
}

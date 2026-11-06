#!/usr/bin/env node
/**
 * Issue #2 — DRY-RUN only. Finds likely copied / duplicate tenant records.
 * NEVER deletes or updates. Safe to run against production with a read-only user.
 *
 * Usage:
 *   MONGODB_URI='...' node server/scripts/copied-data-dry-run.mjs
 *   MONGODB_URI='...' node server/scripts/copied-data-dry-run.mjs --tenants lib-a,lib-b
 *
 * Exit 0 always when it finishes reading (even if overlaps found). Exit 2 on connect error.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { resolveMongoUri } from '../src/db.js';

const args = process.argv.slice(2);
const tenantArg = args.find(a => a.startsWith('--tenants='))?.slice('--tenants='.length);
const wanted = tenantArg ? tenantArg.split(',').map(s => s.trim()).filter(Boolean) : null;

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MONGODB_URI (read-only user recommended). This script never writes.');
  process.exit(2);
}

const fp = (d) => {
  const x = { ...d };
  for (const k of ['_id', 'tenantId', '__v', 'createdAt', 'updatedAt']) delete x[k];
  return JSON.stringify(x, Object.keys(x).sort());
};

async function main() {
  const resolved = await resolveMongoUri(uri.replace(/^['"]|['"]$/g, ''));
  await mongoose.connect(resolved, { readPreference: 'secondaryPreferred' });
  const db = mongoose.connection.db;
  const cols = (await db.listCollections().toArray()).map(c => c.name).sort();
  const libCol = cols.find(n => /^librar/i.test(n));
  if (!libCol) {
    console.log(JSON.stringify({ error: 'no libraries collection', cols }, null, 2));
    await mongoose.disconnect();
    return;
  }
  const libs = await db.collection(libCol).find({}).project({ libraryId: 1, name: 1, createdAt: 1 }).toArray();
  const tenants = (wanted || libs.map(l => l.libraryId).filter(Boolean));
  console.log(JSON.stringify({
    mode: 'dry-run',
    writes: false,
    libraryCount: libs.length,
    comparingTenants: tenants,
    note: 'Overlaps are candidates only. Do not delete without owner approval.',
  }, null, 2));

  const report = [];
  // Compare pairwise for student-like collections
  const interesting = cols.filter(n => /student|payment|seat|shift|branch|expense/i.test(n));
  for (let i = 0; i < tenants.length; i++) {
    for (let j = i + 1; j < tenants.length; j++) {
      const a = tenants[i], b = tenants[j];
      for (const n of interesting) {
        const col = db.collection(n);
        const da = await col.find({ tenantId: a }).limit(5000).toArray();
        const dbb = await col.find({ tenantId: b }).limit(5000).toArray();
        if (!da.length || !dbb.length) continue;
        const setB = new Map(dbb.map(d => [fp(d), d]));
        const exact = da.filter(d => setB.has(fp(d)));
        if (!exact.length) continue;
        report.push({
          collection: n,
          tenantA: a,
          tenantB: b,
          countA: da.length,
          countB: dbb.length,
          exactFingerprintMatches: exact.length,
          sampleIds: exact.slice(0, 5).map(d => ({ _id: String(d._id), id: d.id, name: d.name })),
        });
      }
    }
  }
  console.log(JSON.stringify({ overlaps: report, overlapGroups: report.length }, null, 2));
  console.log('\nDRY-RUN complete. No data was modified.');
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('connect/read failed:', e.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(2);
});

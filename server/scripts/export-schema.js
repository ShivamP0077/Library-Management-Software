/**
 * Exports the MongoDB *schema* (never data) to docs/db-schema/.
 *
 *   cd server && npm run export:schema                # writes ../docs/db-schema
 *   node scripts/export-schema.js --out /some/dir      # custom output dir
 *
 * For every collection it writes <collection>.json with:
 *   - fields: dotted field paths -> BSON types observed in a random sample
 *     (arrays use `[]`, nesting is limited to 3 levels). Only names and types
 *     are recorded, never values.
 *   - indexes: the full getIndexes() output (keys, unique, partial filters, ...)
 *   - options: validator / validationLevel / validationAction / capped
 * plus index.json listing the collections.
 *
 * Uses MONGODB_URI / MONGODB_DB like the server (see src/db.js).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDB, redact } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const OUT = outArg > -1 ? path.resolve(process.argv[outArg + 1]) : path.resolve(here, '../../docs/db-schema');
const SAMPLE = Number(process.env.SCHEMA_SAMPLE_SIZE || 200);

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'date';
  if (v && v._bsontype) return v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID' ? 'objectId' : v._bsontype.toLowerCase();
  return typeof v;
};
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !v._bsontype;

export function collectFields(doc, prefix = '', out = {}, depth = 0) {
  for (const [k, v] of Object.entries(doc || {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    (out[p] ||= new Set()).add(typeOf(v));
    if (depth < 2 && isPlainObject(v)) collectFields(v, p, out, depth + 1);
    if (depth < 2 && Array.isArray(v)) {
      for (const item of v.slice(0, 20)) {
        if (isPlainObject(item)) collectFields(item, `${p}[]`, out, depth + 1);
        else (out[`${p}[]`] ||= new Set()).add(typeOf(item));
      }
    }
  }
  return out;
}

export async function exportSchema(db, sampleSize = SAMPLE) {
  const cols = (await db.listCollections().toArray())
    .filter(c => c.type !== 'view' && !c.name.startsWith('system.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const result = {};
  for (const c of cols) {
    const coll = db.collection(c.name);
    const fields = {};
    for await (const doc of coll.aggregate([{ $sample: { size: sampleSize } }])) collectFields(doc, '', fields, 0);
    result[c.name] = {
      collection: c.name,
      sampleSize,
      fields: Object.fromEntries(Object.keys(fields).sort().map(k => [k, [...fields[k]].sort()])),
      indexes: (await coll.indexes()).map(({ ns, ...ix }) => ix), // eslint-disable-line no-unused-vars
      options: {
        validator: c.options?.validator || null,
        validationLevel: c.options?.validationLevel || null,
        validationAction: c.options?.validationAction || null,
        capped: !!c.options?.capped,
      },
    };
  }
  return result;
}

export function writeSchema(schema, outDir = OUT, database = 'library_management') {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, def] of Object.entries(schema)) {
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(def, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ database, collections: Object.keys(schema) }, null, 2) + '\n');
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const conn = await connectDB();
    const schema = await exportSchema(conn.db);
    writeSchema(schema, OUT, conn.db.databaseName);
    console.log(`[schema] wrote ${Object.keys(schema).length} collections to ${OUT}`);
  } catch (e) {
    console.error('[schema] failed:', redact(e.message));
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

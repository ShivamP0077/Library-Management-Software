/**
 * Encrypted MongoDB backup / restore (spec §10, OPS-01). No external tools needed.
 *
 *   node src/backup.js backup  [--out DIR] [--keep N]      -> DIR/library-os-<timestamp>.bak
 *   node src/backup.js restore <file> --yes [--drop]       -> writes documents back
 *   node src/backup.js verify  <file>                      -> decrypts + counts, writes nothing
 *
 * Env: MONGODB_URI (required), BACKUP_KEY (required, 32+ chars; keep it in the secret manager, never in git),
 *      BACKUP_DIR (default ./backups), BACKUP_KEEP (default 14 files).
 * Format: "LOSB1" | 12-byte IV | 16-byte GCM tag | AES-256-GCM(gzip(EJSON lines)).
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

const MAGIC = Buffer.from('LOSB1');
const EJSON = mongoose.mongo.BSON.EJSON;
const keyFrom = (secret) => {
  if (!secret || String(secret).length < 32) throw new Error('BACKUP_KEY must be set (32+ characters)');
  return crypto.createHash('sha256').update(String(secret)).digest();
};

export async function createBackup(db, secret) {
  const lines = [];
  const cols = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => !n.startsWith('system.')).sort();
  const counts = {};
  for (const name of cols) {
    const docs = await db.collection(name).find({}).toArray();
    counts[name] = docs.length;
    for (const d of docs) lines.push(EJSON.stringify({ c: name, d }, { relaxed: false }));
  }
  const header = EJSON.stringify({ meta: { createdAt: new Date().toISOString(), db: db.databaseName, counts } });
  const plain = zlib.gzipSync(Buffer.from([header, ...lines].join('\n')));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { buffer: Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]), counts };
}

export function readBackup(buffer, secret) {
  if (!buffer.subarray(0, 5).equals(MAGIC)) throw new Error('Not a Library OS backup file');
  const iv = buffer.subarray(5, 17), tag = buffer.subarray(17, 33);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  let plain;
  try { plain = Buffer.concat([decipher.update(buffer.subarray(33)), decipher.final()]); } catch { throw new Error('Wrong BACKUP_KEY or corrupted file'); }
  const [head, ...rest] = zlib.gunzipSync(plain).toString().split('\n');
  const meta = EJSON.parse(head).meta;
  const byCol = {};
  for (const l of rest) { if (!l) continue; const { c, d } = EJSON.parse(l, { relaxed: false }); (byCol[c] ||= []).push(d); }
  return { meta, byCol };
}

export async function restoreBackup(db, buffer, secret, { drop = false } = {}) {
  const { meta, byCol } = readBackup(buffer, secret);
  const restored = {};
  for (const [name, docs] of Object.entries(byCol)) {
    const col = db.collection(name);
    if (drop) await col.deleteMany({});
    if (docs.length) await col.bulkWrite(docs.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })), { ordered: false });
    restored[name] = docs.length;
  }
  return { meta, restored };
}

export function prune(dir, keep) {
  const files = fs.readdirSync(dir).filter(f => /^library-os-.*\.bak$/.test(f)).sort();
  const old = files.slice(0, Math.max(0, files.length - keep));
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  return old;
}

async function main() {
  const [cmd, file] = process.argv.slice(2);
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const secret = process.env.BACKUP_KEY;
  if (cmd === 'verify') {
    const { meta } = readBackup(fs.readFileSync(file), secret);
    console.log(JSON.stringify(meta, null, 2)); return;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  try {
    if (cmd === 'backup') {
      const dir = arg('--out') || process.env.BACKUP_DIR || './backups';
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const { buffer, counts } = await createBackup(db, secret);
      const out = path.join(dir, `library-os-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);
      fs.writeFileSync(out, buffer, { mode: 0o600 });
      const removed = prune(dir, Number(arg('--keep') || process.env.BACKUP_KEEP || 14));
      console.log(JSON.stringify({ ok: true, file: out, bytes: buffer.length, counts, pruned: removed }));
    } else if (cmd === 'restore') {
      if (!process.argv.includes('--yes')) throw new Error('Restore overwrites data. Re-run with --yes');
      const r = await restoreBackup(db, fs.readFileSync(file), secret, { drop: process.argv.includes('--drop') });
      console.log(JSON.stringify({ ok: true, ...r }));
    } else {
      console.log('usage: backup [--out DIR] [--keep N] | restore <file> --yes [--drop] | verify <file>');
      process.exitCode = 2;
    }
  } finally { await mongoose.disconnect(); }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('[backup] FAILED:', e.message); process.exit(1); });

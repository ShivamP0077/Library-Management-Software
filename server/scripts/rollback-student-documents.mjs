#!/usr/bin/env node
/**
 * Restore studentdocuments from a rollback JSONL written by compress-student-documents.mjs.
 *
 * Local MongoDB only. Any host other than 127.0.0.1 or localhost is refused.
 *
 * Usage (from server/):
 *   ROLLBACK_PATH=/workspace/backups/rollback-studentdocuments-<timestamp>.jsonl npm run docs:compress:rollback
 *   APPLY=1 ROLLBACK_PATH=/workspace/backups/rollback-studentdocuments-<timestamp>.jsonl npm run docs:compress:rollback
 *
 * Default is a dry-run (report only). APPLY=1 writes data, fileType and fileSize
 * back and unsets compressedAt. originalFileSize is restored or unset to match
 * the snapshot.
 *
 * MONGODB_URI defaults to mongodb://127.0.0.1:27017/library_management when unset.
 */
import fs from 'node:fs';
import readline from 'node:readline';
import mongoose from 'mongoose';
import { resolveLocalMongoUri } from './lib/local-mongo.mjs';

const APPLY = process.env.APPLY === '1';

function snapshotPath() {
  const given = process.env.ROLLBACK_PATH && String(process.env.ROLLBACK_PATH).trim();
  if (!given) {
    const err = new Error('Set ROLLBACK_PATH to the JSONL file written by docs:compress:apply.');
    err.code = 'ROLLBACK_PATH';
    throw err;
  }
  return given;
}

async function main() {
  const file = snapshotPath();
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error(`Rollback file not found: ${file}`), { code: 'ROLLBACK_PATH' });
  }
  const uri = resolveLocalMongoUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, directConnection: true });
  const col = mongoose.connection.db.collection('studentdocuments');
  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    writes: APPLY,
    file,
    lines: 0,
    restored: 0,
    missing: 0,
    invalid: 0,
  };

  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    summary.lines += 1;
    let snap;
    try {
      snap = JSON.parse(line);
    } catch {
      summary.invalid += 1;
      console.log(`invalid JSON on line ${summary.lines}`);
      continue;
    }
    const filter = snap._id && mongoose.isValidObjectId(snap._id)
      ? { _id: new mongoose.Types.ObjectId(snap._id) }
      : { tenantId: snap.tenantId, storageKey: snap.storageKey };
    const current = await col.findOne(filter, { projection: { _id: 1, storageKey: 1, fileSize: 1, compressedAt: 1 } });
    if (!current) {
      summary.missing += 1;
      console.log(`missing ${snap._id || snap.storageKey}`);
      continue;
    }
    console.log(`${APPLY ? 'restore' : 'would-restore'} ${current._id} ${current.storageKey || ''} currentBytes=${current.fileSize ?? '?'}`);
    if (!APPLY) {
      summary.restored += 1;
      continue;
    }
    const $set = {
      data: snap.data,
      fileType: snap.fileType ?? null,
      fileSize: snap.fileSize ?? null,
    };
    const $unset = { compressedAt: '' };
    if (snap.originalFileSize == null) $unset.originalFileSize = '';
    else $set.originalFileSize = snap.originalFileSize;
    await col.updateOne({ _id: current._id }, { $set, $unset });
    summary.restored += 1;
  }

  console.log('\n' + JSON.stringify(summary, null, 2));
  console.log(APPLY ? '\nROLLBACK APPLY complete.' : '\nDRY-RUN complete. No data was modified.');
  await mongoose.disconnect();
}

if (process.argv[1]?.endsWith('rollback-student-documents.mjs')) {
  main().catch(async (err) => {
    console.error(err.code === 'MONGO_URI_REFUSED' ? err.message : `rollback failed: ${err.message}`);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(err.code === 'MONGO_URI_REFUSED' || err.code === 'ROLLBACK_PATH' ? 2 : 1);
  });
}

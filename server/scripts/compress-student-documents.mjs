#!/usr/bin/env node
/**
 * Compress image payloads in the studentdocuments collection.
 *
 * Local MongoDB only. Any host other than 127.0.0.1 or localhost is refused
 * (including mongodb+srv and Atlas). There is no flag to point this at production.
 *
 * Usage (from server/):
 *   npm run docs:compress
 *   APPLY=1 npm run docs:compress:apply
 *   ROLLBACK_PATH=/workspace/backups/rollback-studentdocuments-custom.jsonl APPLY=1 npm run docs:compress:apply
 *
 * Default is a dry-run: sizes are reported and nothing is written.
 * APPLY=1 writes one document at a time. The original record is appended to the
 * rollback JSONL before that document is updated.
 *
 * MONGODB_URI defaults to mongodb://127.0.0.1:27017/library_management when unset.
 * The same localhost guard still applies.
 *
 * PDFs are skipped. Invalid or non-image payloads are skipped and reported.
 * Documents that already have compressedAt, or that are already within the
 * size target (JPEG, longest side ≤ 1600px), are left unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { resolveLocalMongoUri } from './lib/local-mongo.mjs';
import { compressImageBuffer, parseDataUrl, toDataUrl } from './lib/compress-image-buffer.mjs';

const APPLY = process.env.APPLY === '1';

function rollbackPath() {
  if (process.env.ROLLBACK_PATH && String(process.env.ROLLBACK_PATH).trim()) {
    return path.resolve(String(process.env.ROLLBACK_PATH).trim());
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve(`/workspace/backups/rollback-studentdocuments-${stamp}.jsonl`);
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function row(cells) {
  return cells.map((c, i) => String(c).padEnd(i === 1 ? 22 : 14)).join(' ');
}

async function main() {
  const uri = resolveLocalMongoUri();
  const rollbackFile = APPLY ? rollbackPath() : null;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, directConnection: true });
  const col = mongoose.connection.db.collection('studentdocuments');
  const total = await col.estimatedDocumentCount();
  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    writes: APPLY,
    collection: 'studentdocuments',
    documents: 0,
    toCompress: 0,
    keptOriginal: 0,
    skipped: 0,
    beforeBytes: 0,
    afterBytes: 0,
    savedBytes: 0,
    rollbackPath: rollbackFile,
    files: [],
  };

  console.log(row(['#', 'name', 'kind', 'action', 'before', 'after', 'mime']));
  console.log(row(['-', '----', '----', '------', '------', '-----', '----']));

  let rollbackFd = null;
  if (APPLY) {
    fs.mkdirSync(path.dirname(rollbackFile), { recursive: true });
    rollbackFd = fs.openSync(rollbackFile, 'a');
  }

  const cursor = col.find({}, {
    projection: {
      tenantId: 1,
      storageKey: 1,
      data: 1,
      fileType: 1,
      fileSize: 1,
      fileName: 1,
      docTypeId: 1,
      compressedAt: 1,
      originalFileSize: 1,
    },
    batchSize: 1,
  });

  let index = 0;
  for await (const doc of cursor) {
    index += 1;
    summary.documents += 1;
    const label = doc.fileName || doc.docTypeId || doc.storageKey || String(doc._id);
    const parsed = parseDataUrl(doc.data);
    let result;
    if (!parsed) {
      result = { action: 'skip', reason: 'invalid-data-url', beforeBytes: 0, afterBytes: 0, kind: '-', mime: doc.fileType || '' };
    } else {
      result = await compressImageBuffer(parsed.buf, parsed.mime || doc.fileType, doc);
    }

    const before = result.beforeBytes || 0;
    const after = result.action === 'compress' ? result.afterBytes : before;
    summary.beforeBytes += before;
    summary.afterBytes += after;
    const fileReport = {
      _id: String(doc._id),
      storageKey: doc.storageKey || null,
      fileName: doc.fileName || null,
      docTypeId: doc.docTypeId || null,
      kind: result.kind || null,
      action: result.action,
      reason: result.reason || null,
      beforeBytes: before,
      afterBytes: after,
      fileType: result.action === 'compress' ? result.mime : (parsed?.mime || doc.fileType || null),
    };
    summary.files.push(fileReport);
    console.log(row([
      index,
      String(label).slice(0, 22),
      result.kind || '-',
      result.action === 'skip' ? `skip:${result.reason}` : result.action,
      fmt(before),
      fmt(after),
      fileReport.fileType || '',
    ]));

    if (APPLY && result.action === 'compress' && result.buf) {
      const snapshot = {
        _id: String(doc._id),
        tenantId: doc.tenantId ?? null,
        storageKey: doc.storageKey ?? null,
        data: doc.data,
        fileType: doc.fileType ?? null,
        fileSize: doc.fileSize ?? null,
        fileName: doc.fileName ?? null,
        docTypeId: doc.docTypeId ?? null,
        compressedAt: doc.compressedAt ?? null,
        originalFileSize: doc.originalFileSize ?? null,
      };
      fs.writeSync(rollbackFd, `${JSON.stringify(snapshot)}\n`);
      fs.fsyncSync(rollbackFd);
      const originalFileSize = Number.isFinite(Number(doc.originalFileSize))
        ? Number(doc.originalFileSize)
        : (Number(doc.fileSize) > 0 ? Number(doc.fileSize) : before);
      await col.updateOne({ _id: doc._id }, {
        $set: {
          data: toDataUrl(result.mime, result.buf),
          fileType: result.mime,
          fileSize: result.buf.length,
          compressedAt: new Date(),
          originalFileSize,
        },
      });
      summary.toCompress += 1;
    } else if (result.action === 'compress') {
      summary.toCompress += 1;
    } else if (result.action === 'keep') {
      summary.keptOriginal += 1;
    } else {
      summary.skipped += 1;
    }

    doc.data = undefined;
    result.buf = undefined;
  }

  if (rollbackFd != null) fs.closeSync(rollbackFd);
  summary.savedBytes = summary.beforeBytes - summary.afterBytes;
  summary.estimatedCollectionCount = total;
  console.log('\n' + JSON.stringify(summary, null, 2));
  console.log(APPLY ? '\nAPPLY complete. Originals were appended to the rollback JSONL before each write.' : '\nDRY-RUN complete. No data was modified.');
  await mongoose.disconnect();
}

if (process.argv[1]?.endsWith('compress-student-documents.mjs')) {
  main().catch(async (err) => {
    console.error(err.code === 'MONGO_URI_REFUSED' ? err.message : `compress failed: ${err.message}`);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(err.code === 'MONGO_URI_REFUSED' ? 2 : 1);
  });
}

export { rollbackPath };

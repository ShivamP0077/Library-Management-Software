#!/usr/bin/env node
/**
 * Check users.email_1 so more than one mobile-only account (no email) can exist.
 *
 * DRY-RUN by default. Nothing is dropped or created unless --apply is passed.
 * --apply is refused unless MONGODB_URI is localhost or 127.0.0.1.
 * This script never deletes user or library documents, and it never prints emails,
 * phone numbers, or codes.
 *
 * Backup before any apply (do this yourself; this script does not take a backup):
 *   From server/, with MONGODB_URI pointing at localhost and BACKUP_KEY set (32+ characters):
 *   use connectDB() and createBackup(), write the file mode 0600, and confirm the
 *   document count is not zero. Do not print the backup key or document contents.
 *
 * Rollback: drop the partial email_1 index and recreate the previous unique sparse
 * index only from that backup's index notes. Do not drop the users collection.
 *
 *   node scripts/ensure-user-email-index.mjs
 *   node scripts/ensure-user-email-index.mjs --apply
 *
 * Production apply needs a separate written approval. It was not run in this change.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'url';

function mongoUri() {
  return String(process.env.MONGODB_URI || '').trim().replace(/^['"]|['"]$/g, '');
}

export function assertLocalMongo(uri = mongoUri()) {
  if (!uri) throw Object.assign(new Error('MONGODB_URI is not set'), { code: 'MONGO_URI_MISSING' });
  if (/mongodb\+srv:|atlas|mongodb\.net/i.test(uri)) {
    throw Object.assign(new Error('Refusing a remote MongoDB URI'), { code: 'MONGO_URI_REMOTE' });
  }
  let host = '';
  try {
    host = new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
  } catch {
    throw Object.assign(new Error('MONGODB_URI could not be read'), { code: 'MONGO_URI_REMOTE' });
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw Object.assign(new Error('Refusing a non-localhost MongoDB URI'), { code: 'MONGO_URI_REMOTE' });
  }
  return uri;
}

function indexShape(ix) {
  if (!ix?.unique || ix.key?.email !== 1) return 'other';
  const type = ix.partialFilterExpression?.email?.$type;
  if (type === 'string' || type === 2) return 'partial';
  if (ix.sparse && !ix.partialFilterExpression) return 'sparse';
  return 'other';
}

async function report(collection) {
  const [blankEmailUsers, emptyStringEmails, duplicateGroups, indexes] = await Promise.all([
    collection.countDocuments({ $or: [{ email: { $exists: false } }, { email: null }, { email: '' }] }),
    collection.countDocuments({ email: '' }),
    collection.aggregate([
      { $match: { email: { $type: 'string', $gt: '' } } },
      { $group: { _id: '$email', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: 'groups' },
    ]).toArray(),
    collection.indexes().catch((e) => {
      if (e?.code === 26) return [];
      throw e;
    }),
  ]);
  const emailIndex = indexes.find((ix) => ix.name === 'email_1' || ix.key?.email === 1) || null;
  return {
    blankEmailUsers,
    emptyStringEmails,
    duplicateNonEmptyEmailGroups: duplicateGroups[0]?.groups || 0,
    index: emailIndex ? { name: emailIndex.name, shape: indexShape(emailIndex) } : null,
  };
}

export async function runEmailIndexScript({ apply = false, log = console.log } = {}) {
  const collection = mongoose.connection.collection('users');
  const before = await report(collection);
  const alreadyOk = before.index?.shape === 'partial';
  const wouldRefuse = before.duplicateNonEmptyEmailGroups > 0 || before.emptyStringEmails > 1;
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    db: mongoose.connection.name,
    ...before,
    action: alreadyOk ? 'none' : wouldRefuse ? 'refuse' : (apply ? 'replace-email-index' : 'would-replace-email-index'),
  };
  if (!apply) {
    log(JSON.stringify(summary));
    return summary;
  }
  if (wouldRefuse) {
    log(JSON.stringify(summary));
    throw Object.assign(new Error('email index was not changed because emails collide'), { code: 'EMAIL_INDEX_DUPLICATES' });
  }
  if (!alreadyOk) {
    if (before.index) await collection.dropIndex(before.index.name);
    await collection.createIndex(
      { email: 1 },
      { name: 'email_1', unique: true, partialFilterExpression: { email: { $type: 'string' } } },
    );
  }
  summary.indexAfter = (await report(collection)).index;
  log(JSON.stringify(summary));
  return summary;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  try {
    const uri = assertLocalMongo();
    await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'library_management', serverSelectionTimeoutMS: 5000 });
    await runEmailIndexScript({ apply });
  } catch (e) {
    console.error('[email-index] failed:', e.code || 'error');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

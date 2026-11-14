#!/usr/bin/env node
/**
 * Repair users.email_1 so more than one mobile-only account (no email) can exist.
 *
 * Dry-run by default. Nothing is dropped or created unless --apply is passed.
 * This script never deletes user or library documents, and it never prints emails,
 * phone numbers, or codes.
 *
 *   cd server
 *   node scripts/ensure-user-email-index.mjs
 *   node scripts/ensure-user-email-index.mjs --apply
 *
 * EXACT production migration steps (OCI VM). Do these in order.
 * Do not use `npm run backup` — it is buggy/empty because it connects without the
 * library_management database name.
 *
 * 1. Backup first on the OCI VM with connectDB() + createBackup() (NOT `npm run backup`, which is buggy/empty).
 *    Example dest: /opt/lms-data/backups/library-os-pre-email-index-<ts>.bak.
 *    Confirm the backup is not empty (db library_management, many collections/docs).
 *
 *    From the server directory, with the API environment loaded
 *    (MONGODB_URI, MONGODB_DB=library_management, BACKUP_KEY of 32+ characters):
 *
 *      node --input-type=module -e "
 *        import fs from 'fs';
 *        import { connectDB } from './src/db.js';
 *        import { createBackup } from './src/backup.js';
 *        const conn = await connectDB();
 *        const { buffer, counts } = await createBackup(conn.db, process.env.BACKUP_KEY);
 *        const ts = new Date().toISOString().replace(/[:.]/g, '-');
 *        const dest = '/opt/lms-data/backups/library-os-pre-email-index-' + ts + '.bak';
 *        fs.mkdirSync('/opt/lms-data/backups', { recursive: true, mode: 0o700 });
 *        fs.writeFileSync(dest, buffer, { mode: 0o600 });
 *        const docs = Object.values(counts).reduce((n, c) => n + c, 0);
 *        console.log(JSON.stringify({ file: dest, db: conn.db.databaseName, collections: Object.keys(counts).length, docs, bytes: buffer.length }));
 *        await conn.close();
 *      "
 *
 *    Stop if db is not library_management, the collection count is tiny, or docs is 0.
 *    Do not print the backup key or document contents.
 *
 * 2. Dry-run: count users with missing/null/empty email (should be a small number; do not print emails or phones);
 *    confirm no duplicate non-empty emails.
 *
 *      node scripts/ensure-user-email-index.mjs
 *
 * 3. Apply the index change (drop email_1, create unique partial index). No user/library deletes.
 *
 *      node scripts/ensure-user-email-index.mjs --apply
 *
 * 4. Recheck: two mobile-only accounts can exist; string emails stay unique.
 *    Run the dry-run again. missingNullOrEmpty may be more than one.
 *    duplicateNonEmptyEmailGroups must be 0. The index shape must be "partial"
 *    (unique, partialFilterExpression email $type string).
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'url';
import { connectDB, redact } from '../src/db.js';
import { ensureUserEmailIndex, userEmailIndexReport, userEmailIndexShape } from '../src/models.js';

mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

async function currentEmailIndex() {
  try {
    const indexes = await mongoose.connection.collection('users').indexes();
    return indexes.find((ix) => ix.name === 'email_1' || (ix.key && Object.keys(ix.key).length === 1 && ix.key.email === 1)) || null;
  } catch (e) {
    if (e?.code === 26 || /ns does not exist/i.test(String(e?.message || ''))) return null;
    throw e;
  }
}

function publicIndex(ix) {
  if (!ix) return null;
  return { name: ix.name, unique: Boolean(ix.unique), shape: userEmailIndexShape(ix) };
}

export async function runEmailIndexScript({ apply = false, log = console.log } = {}) {
  const report = await userEmailIndexReport();
  const before = publicIndex(await currentEmailIndex());
  // blankEmailUsers already includes missing, null, and ''.
  const missingNullOrEmpty = report.blankEmailUsers;
  const wouldRefuse = report.duplicateNonEmptyEmailGroups > 0 || report.emptyStringEmails > 1;
  const alreadyOk = before?.shape === 'partial' || before?.shape === 'sparse';
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    db: mongoose.connection.name,
    missingNullOrEmpty,
    blankEmailUsers: report.blankEmailUsers,
    emptyStringEmails: report.emptyStringEmails,
    duplicateNonEmptyEmailGroups: report.duplicateNonEmptyEmailGroups,
    index: before,
    action: alreadyOk ? 'none' : wouldRefuse ? 'refuse' : 'replace-email-index',
  };
  if (!apply) {
    log(JSON.stringify(summary));
    return summary;
  }
  const result = await ensureUserEmailIndex({ log });
  summary.result = { changed: result.changed, reason: result.reason };
  summary.indexAfter = publicIndex(await currentEmailIndex());
  log(JSON.stringify(summary));
  if (result.reason === 'duplicates') {
    const err = new Error('email index was not changed because non-empty emails collide');
    err.code = 'EMAIL_INDEX_DUPLICATES';
    throw err;
  }
  return summary;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  try {
    await connectDB();
    await runEmailIndexScript({ apply });
  } catch (e) {
    console.error('[email-index] failed:', redact(e.message));
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

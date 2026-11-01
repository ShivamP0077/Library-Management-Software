# Backup and restore (spec §10, OPS-01)

Backups are encrypted with AES-256-GCM. The key comes from `BACKUP_KEY` and is never stored in the file or in git.

## Environment

| Variable | Meaning |
|---|---|
| `MONGODB_URI` | Database to back up or restore into. Keep it in the host's secret manager. |
| `BACKUP_KEY` | 32+ character secret. **Store it separately from the backups.** If it is lost, the backups cannot be read. |
| `BACKUP_DIR` | Folder for `.bak` files (default `./backups`, ignored by git). |
| `BACKUP_KEEP` | How many newest files to keep (default 14). Older ones are deleted after each successful backup. |

## Daily backup

Run once a day from a scheduler (a Render cron job, GitHub Actions or system cron):

```bash
cd server && npm run backup            # or: node src/backup.js backup --out /secure/backups --keep 30
```

It prints one JSON line (`ok`, `file`, `counts`, `pruned`). On any failure it exits with code 1 and prints `[backup] FAILED: ...`. Point the scheduler's failure alert (email or Slack) at a non-zero exit. Copy the file to separate storage with restricted access, such as a private bucket with object versioning.

## Check a backup without touching the database

```bash
BACKUP_KEY=... node src/backup.js verify backups/library-os-<time>.bak
```

## Restore (Super Admin only)

1. Restore into a **staging** database first: `MONGODB_URI=<staging> node src/backup.js restore <file> --yes`.
2. Sign in on staging and check a few libraries, students and payments.
3. For production, take a fresh backup first, then run the same command against production. `--drop` empties each collection before restoring (full point-in-time restore). Without it, documents are upserted by `_id`.

## Restore rehearsal evidence

`server/test/backup.test.js` runs a full rehearsal on every `npm test`:
- back up
- delete students and users
- restore
- confirm the data is back and login works
- confirm a wrong key is rejected

Record each manual rehearsal (date, file, who, result) in your ops log.

## Owner data exports

Owners and permitted staff can download CSV files (they open in Excel) from **Help & Support → Export my data**:
- Students need the Students permission.
- Payments need the Payments permission.
- Expenses need the Expenses permission.

Each export contains only that library's data and is written to the audit log.

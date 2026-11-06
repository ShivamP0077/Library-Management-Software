# Support ticket global numbering (Issue #20)

Ticket numbers are now allocated from a single atomic `SupportTicketCounter` document and are
unique across every library. The old per-library `{ tenantId, number }` unique index is gone.

## Why a migration is required

Existing databases can contain the same number in more than one library (for example `lib-a #1`
and `lib-b #1`). MongoDB refuses to create the new global unique index on `{ number: 1 }` while
those duplicates exist. The server therefore does **not** auto-create that index on startup when
duplicates are present; it only creates it when the data is already clean.

## Safe procedure (never run `--apply` against live traffic)

1. Take a database backup/snapshot.
2. Pause support-ticket writes (maintenance window).
3. Dry run (default, writes nothing):

   ```bash
   cd server
   node scripts/support-global-numbering.mjs --uri "<mongodb-uri>" --db <name>
   ```

4. Review the duplicate groups and the first/last number summary.
5. Apply during the maintenance window:

   ```bash
   node scripts/support-global-numbering.mjs --uri "<mongodb-uri>" --db <name> --apply
   ```

6. The script sorts tickets by `createdAt` (then `_id`), assigns `1..N`, and preserves the old
   library/number pair in `legacyAliases` so searches for the old number still find the ticket.
   It only updates `number`, `legacyAliases` and `migrationVersion`; message bodies and attachment
   blobs are untouched.
7. Verify afterwards with another dry run: `duplicatesBefore` must be empty, `firstNumber` is 1,
   `lastNumber` equals the ticket count, and `globalUniqueIndexPresent` is true.
8. Resume writes.

## Rollback

Restore the backup. The script drops only the legacy `{ tenantId, number }` unique index and creates
`number_1`; no documents or attachments are deleted. If you roll back code without restoring data,
keep the global unique index (it is still valid) and the `legacyAliases` fields.

Safety: the CLI never reads `.env`/`MONGO_URI`; the target must be passed with `--uri` (or `SUPPORT_MIGRATION_MONGO_URI`).
It refuses `NODE_ENV=production`, connects with `autoIndex`/`autoCreate` disabled (a dry run creates no collection or index),
and aliases every pre-migration `{tenantId, number}` exactly once.

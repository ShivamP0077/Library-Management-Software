# Tenant migration (`libraryId` → `tenantId`)

`tenantId` is now the canonical tenant key. It always equals the owning
`Library.libraryId`. The old `libraryId` field is **kept on existing documents
for rollback**, but the server no longer queries it for tenant data.

## When to run

Run this once on any existing database **before** deploying the multi-tenant
server code, and again safely at any time (the migration is idempotent).

```bash
cd server
npm run migrate:tenants            # dry run (default): prints counts, writes nothing
npm run migrate:tenants -- --apply # perform the migration
```

The CLI connects using the regular `MONGODB_URI` / `MONGODB_DB` settings and
then disconnects.

Recommended order on production (Render + Atlas):

1. Take an Atlas backup/snapshot.
2. Dry run locally against prod (`MONGODB_URI=... npm run migrate:tenants`) and review counts/collisions.
3. `npm run migrate:tenants -- --apply`.
4. Deploy this branch to Render.
5. Re-run `npm run migrate:tenants -- --apply` once to backfill anything the old
   code wrote between steps 3 and 4 (idempotent, safe).
6. Smoke test: log in as two different library admins and the super admin.

## Options / environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEFAULT_TENANT_ID` | `lib-default` | Tenant id used for documents that have neither `tenantId` nor `libraryId` |
| `DEFAULT_TENANT_NAME` | `Default Library` | Name used if the default library has to be created |

`--dry-run` is the default when `--apply` is absent. Passing both flags makes
`--dry-run` win.

## What it does

1. **Collision check (before any write).** Simulates the post-migration tenant
   for every document (`tenantId` → `libraryId` → default) and refuses to run if
   any group would violate the new unique indexes:
   - tenant collections: `{tenantId, _key}`
   - `settings`: `{tenantId}`
   - `studentdocuments`: `{tenantId, storageKey}`

   On collision it logs the offending groups and exits with code `1`.
2. **Default tenant.** Upserts `Library { libraryId: DEFAULT_TENANT_ID }` with
   `isDefault: true`. The default library is only created when `--apply` is used.
3. **Backfill `tenantId`.**
   - Where `tenantId` is absent/empty and `libraryId` exists: `tenantId = libraryId`.
   - Where both are absent/empty: `tenantId = DEFAULT_TENANT_ID`.
   - Same rule for `users` with `role != 'superadmin'`; superadmins stay
     tenant-less.
4. **Indexes.** Drops legacy indexes whose key contains `libraryId`
   (e.g. `libraryId_1__key_1`, `libraryId_1`, `libraryId_1_storageKey_1`), then
   runs `syncIndexes()` to build the per-tenant unique indexes. User indexes are
   synced too so `tenantId` is indexed.

## Rollback notes

- The legacy `libraryId` field is never unset, so a rollback deployment can still
  read it.
- New writes also mirror `tenantId` into `libraryId`, so post-migration rows stay
  readable by the old code. Rolling back only needs the old code deployed (its
  Mongoose schemas recreate the old `libraryId` indexes on startup).
- Keep a database backup before `--apply`, as with any migration.

## Verifying

```js
// in mongosh
db.students.countDocuments({ tenantId: { $exists: false } }) // 0
db.students.getIndexes()                                    // no libraryId_* indexes
db.libraries.find({ isDefault: true })                      // the default tenant
```

Application-level checks are covered by:

- `server/test/migration.test.js` — dry run, apply, idempotency, isolation,
  collision refusal.
- `server/test/tenant-guard.test.js` — unscoped queries throw.
- `server/test/tenancy.test.js` — cross-tenant ID substitution, superadmin
  drill-in, JWT tenant mismatch.

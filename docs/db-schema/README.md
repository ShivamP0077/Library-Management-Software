# Database schema (`library_management`)

Schema snapshot of the production MongoDB database, kept in Git for recovery.
**It contains no document data**: only collection names, sampled field names
and their BSON types, every index (as returned by `getIndexes()`), and
collection validators/options. Backups with data never go in this repository.

| File | Contents |
| --- | --- |
| `index.json` | Database name and list of collections |
| `<collection>.json` | `fields` (dotted path → observed types; `[]` = array element), `indexes`, `options` (validator, validationLevel, validationAction, capped) |

Field lists are sampled (200 random documents per collection), so rarely used
optional fields may be missing and empty collections show no fields. The
Mongoose models in `server/src/models.js` (and `server/src/whatsapp.js`) remain
the source of truth for the application schema.

## Regenerating

```bash
cd server
MONGODB_URI=... MONGODB_DB=library_management npm run export:schema   # writes ../docs/db-schema
# or: node scripts/export-schema.js --out /tmp/schema
```

Review the diff before committing; it must only contain names, types and indexes.

## Recreating indexes

The app recreates its indexes from the Mongoose schemas on startup
(`autoIndex`), and `npm run migrate:tenants -- --apply` drops legacy
`libraryId` indexes and runs `syncIndexes()` for every tenant model. To recreate
them by hand (e.g. on an empty restore target), use the JSON files in mongosh:

```js
// mongosh "mongodb+srv://.../library_management" --file recreate-indexes.js
const fs = require('fs');
const dir = 'docs/db-schema';
const { collections } = JSON.parse(fs.readFileSync(`${dir}/index.json`, 'utf8'));
for (const name of collections) {
  const { indexes, options } = JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8'));
  if (!db.getCollectionNames().includes(name)) {
    db.createCollection(name, options.validator ? { validator: options.validator, validationLevel: options.validationLevel, validationAction: options.validationAction } : {});
  }
  for (const { key, name: ixName, v, ...opts } of indexes) {
    if (ixName === '_id_') continue;
    db.getCollection(name).createIndex(key, { name: ixName, ...opts });
  }
}
```

Unique tenant indexes are partial (`tenantId` must be a string), so documents
without a `tenantId` must be migrated (`npm run migrate:tenants -- --apply`)
before they are covered.

## Restoring from a backup

Backups are kept outside Git: either a `mongodump` directory or an in-cluster
copy database (e.g. `lm_backup_<timestamp>` on the same Atlas cluster).

From a `mongodump` (directory produced by
`mongodump --uri "$MONGODB_URI" --db library_management --out <dir>`):

```bash
# Dry run first: shows what would be restored
mongorestore --uri "$MONGODB_URI" --nsInclude 'library_management.*' --dryRun <dir>
# Restore, replacing current collections (indexes in the dump are rebuilt too)
mongorestore --uri "$MONGODB_URI" --nsInclude 'library_management.*' --drop <dir>
```

From an in-cluster copy database, dump it and restore it under the live name:

```bash
mongodump   --uri "$MONGODB_URI" --db lm_backup_<timestamp> --out /tmp/bak
mongorestore --uri "$MONGODB_URI" --nsFrom 'lm_backup_<timestamp>.*' --nsTo 'library_management.*' --drop /tmp/bak
```

`--drop` replaces each collection, so only use it when the live data is
corrupted. Afterwards, check the counts per collection, run
`npm run migrate:tenants` (dry run) to confirm every document has a `tenantId`,
and compare `getIndexes()` with the files here.

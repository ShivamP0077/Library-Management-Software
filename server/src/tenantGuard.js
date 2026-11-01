/**
 * Tenant guard plugin.
 *
 * Every tenant-owned schema is scoped by `tenantId`. This plugin makes it
 * impossible to accidentally run a query without a tenant filter: any query
 * middleware whose filter has no `tenantId` throws instead of silently
 * returning data from every tenant.
 *
 * Escape hatch (used only by trusted platform code such as metrics):
 *   Model.find({}).setOptions({ skipTenantGuard: true })
 *   Model.aggregate(pipeline).option({ skipTenantGuard: true })
 */

const QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'countDocuments',
];

const tenantError = (modelName) => {
  const err = new Error(`Tenant guard: query on ${modelName} without tenantId`);
  err.status = 500;
  return err;
};

/** True when a filter explicitly scopes to a tenant (supports `$and`). */
export const hasTenantId = (filter) => {
  if (!filter || typeof filter !== 'object') return false;
  if (filter.tenantId !== undefined && filter.tenantId !== null && filter.tenantId !== '') return true;
  if (Array.isArray(filter.$and) && filter.$and.some(hasTenantId)) return true;
  return false;
};

/** The first `$match` stage of an aggregation pipeline, if any. */
const firstMatch = (pipeline = []) => {
  for (const stage of pipeline) if (stage && stage.$match) return stage.$match;
  return null;
};

/**
 * Wraps `Model.bulkWrite` so every operation that carries a filter (everything
 * except insertOne) is tenant-scoped. `options.skipTenantGuard` bypasses it.
 */
export function applyBulkWriteGuard(Model) {
  const original = Model.bulkWrite;
  Model.bulkWrite = function guardedBulkWrite(ops, options) {
    if (!options || !options.skipTenantGuard) {
      for (const op of ops || []) {
        const entry = Object.entries(op || {})[0];
        if (!entry) continue;
        const [name, spec] = entry;
        if (name === 'insertOne') continue;
        if (!hasTenantId(spec && spec.filter)) {
          return Promise.reject(tenantError(Model.modelName));
        }
      }
    }
    return original.call(this, ops, options);
  };
  return Model;
}

export default function tenantGuard(schema) {
  const guardQuery = function guardQuery() {
    if (this.options && this.options.skipTenantGuard) return;
    const filter = typeof this.getFilter === 'function' ? this.getFilter() : {};
    if (!hasTenantId(filter)) throw tenantError(this.model.modelName);
  };

  for (const op of QUERY_OPS) schema.pre(op, guardQuery);

  schema.pre('aggregate', function guardAggregate() {
    if (this.options && this.options.skipTenantGuard) return;
    if (!hasTenantId(firstMatch(this.pipeline()))) throw tenantError(this.model().modelName);
  });

  // Documents must always carry a tenant, even when created directly.
  const guardDoc = function guardDoc() {
    if (this.tenantId === undefined || this.tenantId === null || this.tenantId === '') {
      throw tenantError(this.constructor.modelName);
    }
  };
  schema.pre('save', guardDoc);
  schema.pre('validate', guardDoc);
}

export { tenantGuard };

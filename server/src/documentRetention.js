/**
 * Issue #3: replaced/removed admission documents are retained for 30 days.
 * This worker is idempotent and only ever deletes rows whose purgeAfter has passed.
 */
import { StudentDocument } from './models.js';

export const DOCUMENT_RETENTION_DAYS = 30;

export function retentionDeadline(from = new Date(), days = DOCUMENT_RETENTION_DAYS) {
  return new Date(new Date(from).getTime() + days * 24 * 60 * 60 * 1000);
}

export async function purgeExpiredDocuments({ now = new Date() } = {}) {
  // Trusted cross-tenant maintenance job; it only touches rows already past their retention deadline.
  const r = await StudentDocument.deleteMany({ retiredAt: { $ne: null }, purgeAfter: { $ne: null, $lte: now } }).setOptions({ skipTenantGuard: true });
  return { purged: r.deletedCount || 0 };
}

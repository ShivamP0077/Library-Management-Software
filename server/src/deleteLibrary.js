// Issue #16: Super Admin "Delete library" — removes only one tenant's data.
import mongoose from 'mongoose';
import { Library, User } from './models.js';
import { createEvolutionClient, evolutionConfigured, instanceNameFor } from './evolution.js';

const KEEP = new Set(['AuditLog', 'Library', 'User']); // audit is kept; Library/User handled explicitly

/** Deletes every document scoped to `libraryId`; returns per-model counts. Other tenants are never matched. */
export async function deleteLibraryData(libraryId, { evolution } = {}) {
  if (typeof libraryId !== 'string' || !libraryId.trim()) throw Object.assign(new Error('libraryId required'), { status: 400 });
  const counts = {};
  for (const name of mongoose.modelNames()) {
    if (KEEP.has(name)) continue;
    const M = mongoose.model(name);
    const field = M.schema.path('tenantId') ? 'tenantId' : M.schema.path('libraryId') ? 'libraryId' : null;
    if (!field) continue; // global collections (e.g. partners) are not tenant data
    const r = await M.deleteMany({ [field]: libraryId });
    if (r.deletedCount) counts[name] = r.deletedCount;
  }
  const u = await User.deleteMany({ role: { $ne: 'superadmin' }, $or: [{ tenantId: libraryId }, { libraryId }] });
  if (u.deletedCount) counts.User = u.deletedCount;
  await Library.deleteOne({ libraryId });
  // Best effort: disconnect the library's WhatsApp instance; never blocks the delete.
  let whatsapp = 'skipped';
  try {
    const client = evolution || (evolutionConfigured() ? createEvolutionClient() : null);
    if (client) { await client.logout(instanceNameFor(libraryId)); whatsapp = 'logged_out'; }
  } catch (e) { whatsapp = e?.status === 404 ? 'not_found' : 'failed'; }
  return { counts, whatsapp };
}

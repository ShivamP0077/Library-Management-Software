/**
 * Audit log for sensitive actions (spec §1): actor, tenant, time, action, reason.
 * Platform-level collection (superadmin actions may have no tenant); every tenant
 * read filters by tenantId.
 */
import mongoose from 'mongoose';

const auditSchema = new mongoose.Schema({
  tenantId: { type: String, index: true, default: null },
  actorId: String, actorEmail: String, actorRole: String,
  action: { type: String, required: true, index: true },
  target: String,
  reason: String,
  detail: mongoose.Schema.Types.Mixed,
  ip: String,
  impersonation: { type: Boolean, default: false },
  at: { type: Date, default: Date.now, index: true },
}, { versionKey: false });
auditSchema.index({ tenantId: 1, at: -1 });
export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditSchema);

const SECRET_KEYS = /pass|otp|token|secret|code/i;
const scrub = (d) => {
  if (!d || typeof d !== 'object') return d;
  const o = Array.isArray(d) ? [] : {};
  for (const [k, v] of Object.entries(d)) o[k] = SECRET_KEYS.test(k) ? '[redacted]' : (v && typeof v === 'object' ? scrub(v) : v);
  return o;
};

/** Never throws: auditing must not break the action it records. */
export async function audit(req, action, { tenantId, target, reason, detail } = {}) {
  try {
    const u = req?.user || {};
    await AuditLog.create({
      tenantId: tenantId !== undefined ? tenantId : (req?.tenantId ?? u.tenantId ?? null),
      actorId: u.id, actorEmail: u.email, actorRole: u.role,
      action, target: target != null ? String(target) : undefined, reason, detail: scrub(detail),
      ip: req?.ip, impersonation: ['superadmin', 'partner', 'agent'].includes(u.role) && !!req?.tenantId,
    });
  } catch (e) { console.error('[audit] failed to record', action, e.message); }
}

export const pubAudit = (a) => ({ id: String(a._id), tenantId: a.tenantId, actorEmail: a.actorEmail, actorRole: a.actorRole, action: a.action, target: a.target, reason: a.reason, detail: a.detail, impersonation: a.impersonation, at: a.at });

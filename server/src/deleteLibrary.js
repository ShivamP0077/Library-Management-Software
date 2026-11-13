// Issue #16: Super Admin "Delete library" — removes only one tenant's data.
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Library, User, models } from './models.js';
import { AuditLog } from './audit.js';
import { SoftwareInvoice } from './payments/invoices.js';
import { DeletionJob } from './deletionJob.js';
import { createEvolutionClient, evolutionConfigured, instanceNameFor } from './evolution.js';
import { recordTrialIdentifiers } from './trialUsage.js';

// Retained on purpose. Everything else with tenantId/libraryId is removed.
// TrialUsage stores only hashed identities and has no tenant field, so a delete
// cannot match it. It is listed here so a future tenant field cannot wipe it.
const KEEP = new Set(['AuditLog', 'Library', 'User', 'DeletionJob', 'TrialUsage']);
const inFlight = new Map();

export const TENANT_FIELDS = ['tenantId', 'libraryId'];

/** The tenancy fields a model actually has. */
export const tenantFieldsFor = (Model) => TENANT_FIELDS.filter((field) => Boolean(Model.schema.path(field)));

/** A filter that catches both canonical and legacy tenancy fields (null when not tenant-owned). */
export function tenantFilterFor(Model, libraryId) {
  const fields = tenantFieldsFor(Model);
  return fields.length ? { $or: fields.map((field) => ({ [field]: libraryId })) } : null;
}

/** Minimal, non-identifying financial footprint for the retained audit trail. */
export function pseudonymizeTenant(libraryId) {
  return `lib_${crypto.createHash('sha256').update(String(libraryId)).digest('hex').slice(0, 16)}`;
}

/**
 * What survives a tenant deletion, and why. No tenant PII, provider receipt body,
 * provider reference or credential is retained.
 */
export function retainedDataPolicy() {
  return [
    { collection: 'AuditLog', reason: 'legal_audit', identity: 'pseudonymised tenantId', fields: ['action', 'actorRole', 'at', 'tenantId', 'target (deletion proof only)', 'detail (deletion proof only)'] },
    { collection: 'SoftwareInvoice', reason: 'financial_legal', identity: 'pseudonymised tenantId', fields: ['invoiceId', 'planId', 'interval', 'amount', 'currency', 'status', 'provider', 'paidAt', 'dueAt', 'periodStart', 'periodEnd', 'createdAt', 'updatedAt'] },
    { collection: 'DeletionJob', reason: 'irreversible_delete_proof', identity: 'immutable libraryId', fields: ['libraryId', 'targetName', 'subject', 'status', 'counts', 'completedAt'] },
  ];
}

export async function financialRetentionSummary(libraryId) {
  const [payments, expenses, invoices] = await Promise.all([
    models.payments.find({ tenantId: libraryId }).select({ netTotal: 1, amount: 1, voided: 1 }).lean(),
    models.expenses.find({ tenantId: libraryId }).select({ amount: 1 }).lean(),
    SoftwareInvoice.find({ tenantId: libraryId }).select({ amount: 1, status: 1 }).lean(),
  ]);
  const collected = payments.filter(p => !p.voided).reduce((sum, p) => sum + Math.max(0, Number(p.netTotal ?? p.amount ?? 0)), 0);
  const spent = expenses.reduce((sum, e) => sum + Math.max(0, Number(e.amount ?? 0)), 0);
  const softwareBilled = invoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount ?? 0)), 0);
  return {
    subject: pseudonymizeTenant(libraryId),
    paymentCount: payments.filter(p => !p.voided).length,
    grossCollected: Math.round(collected * 100) / 100,
    expenseCount: expenses.length,
    grossExpenses: Math.round(spent * 100) / 100,
    softwareInvoiceCount: invoices.length,
    softwareBilled: Math.round(softwareBilled * 100) / 100,
    retainedForLegalAuditOnly: true,
    retained: retainedDataPolicy(),
  };
}

export async function ensureDeletionJob(libraryId, targetName) {
  if (typeof libraryId !== 'string' || !libraryId.trim()) throw Object.assign(new Error('libraryId required'), { status: 400 });
  if (typeof targetName !== 'string' || !targetName.trim()) throw Object.assign(new Error('targetName required'), { status: 400 });
  return DeletionJob.findOneAndUpdate(
    { libraryId },
    {
      $setOnInsert: {
        libraryId,
        targetName: String(targetName).trim(),
        subject: pseudonymizeTenant(libraryId),
        status: 'pending',
        attempts: 0,
        startedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function startDeletionAttempt(libraryId) {
  return DeletionJob.findOneAndUpdate(
    { libraryId },
    { $inc: { attempts: 1 }, $set: { status: 'pending', error: null } },
    { new: true },
  );
}

export async function completeDeletionJob(libraryId, result) {
  return DeletionJob.findOneAndUpdate(
    { libraryId },
    {
      $set: {
        status: 'completed',
        counts: result?.counts || {},
        retention: result?.retention || null,
        whatsapp: result?.whatsapp || 'skipped',
        completedAt: result?.deletedAt ? new Date(result.deletedAt) : new Date(),
        error: null,
      },
    },
    { new: true },
  );
}

export async function failDeletionJob(libraryId, error) {
  return DeletionJob.findOneAndUpdate(
    { libraryId },
    { $set: { status: 'failed', error: String(error?.message || error || 'Delete failed').slice(0, 500) } },
    { new: true },
  );
}

/** Keep audit history but remove who/what of the deleted tenant. */
export async function redactTenantAudit(libraryId, subject = pseudonymizeTenant(libraryId)) {
  const identity = { $or: [{ tenantId: libraryId }, { target: libraryId }] };
  const normal = await AuditLog.updateMany(
    { ...identity, action: { $ne: 'library.deleted' } },
    {
      $set: { tenantId: subject },
      $unset: { actorId: '', actorEmail: '', ip: '', reason: '', detail: '', target: '', impersonation: '' },
    },
  );
  // The deletion proof itself keeps the immutable target + name so a lost response
  // can still be retried with the exact same confirmation, but no actor PII.
  const proof = await AuditLog.updateMany(
    { ...identity, action: 'library.deleted' },
    {
      $set: { tenantId: subject },
      $unset: { actorId: '', actorEmail: '', ip: '', reason: '', impersonation: '' },
    },
  );
  return normal.modifiedCount + proof.modifiedCount;
}

/**
 * Financial/legal support records are retained as minimal invoice metadata.
 * Provider receipts (`raw`) may contain card/customer details and provider refs
 * are live receipt identifiers, so both are removed.
 */
export async function redactSoftwareInvoices(libraryId, subject = pseudonymizeTenant(libraryId), now = new Date()) {
  const r = await SoftwareInvoice.updateMany(
    { tenantId: libraryId },
    {
      $set: { tenantId: subject, retentionSubject: subject, redactedAt: now },
      $unset: { raw: '', providerRef: '' },
    },
  );
  return r.modifiedCount;
}

/** Deletes every document scoped to `libraryId`; returns per-model counts. Other tenants are never matched. */
async function performDelete(libraryId, { evolution, now = new Date() } = {}) {
  if (typeof libraryId !== 'string' || !libraryId.trim()) throw Object.assign(new Error('libraryId required'), { status: 400 });
  const subject = pseudonymizeTenant(libraryId);
  const retention = await financialRetentionSummary(libraryId);
  const counts = {};

  // 1. Close account-linked one-time codes before their users disappear. These
  //    rows carry only a userId and would otherwise be dangling after the delete.
  // Keep the trial identity after the owner and library contact rows are removed.
  const [owners, libDoc] = await Promise.all([
    User.find({ role: 'client_admin', $or: [{ tenantId: libraryId }, { libraryId }] }).select('email mobile googleSub').lean(),
    Library.findOne({ libraryId }).select('contactEmail phone').lean(),
  ]);
  for (const owner of owners) {
    await recordTrialIdentifiers({ email: owner.email, mobile: owner.mobile, googleSub: owner.googleSub });
  }
  if (libDoc) await recordTrialIdentifiers({ email: libDoc.contactEmail, mobile: libDoc.phone });

  const tenantUsers = await User.find({ role: { $ne: 'superadmin' }, $or: [{ tenantId: libraryId }, { libraryId }] }).select('_id').lean();
  const userIds = tenantUsers.map((u) => String(u._id));
  if (userIds.length) {
    const { PasswordResetOtp } = await import('./accounts.js');
    const otp = await PasswordResetOtp.deleteMany({ userId: { $in: userIds } });
    if (otp.deletedCount) counts.PasswordResetOtp = otp.deletedCount;
  }

  // 2. Retain the legal minimum, no PII/provider payload.
  await redactTenantAudit(libraryId, subject);
  const redactedInvoices = await redactSoftwareInvoices(libraryId, subject, now);
  retention.softwareInvoicesRetained = redactedInvoices;

  // 3. Remove every other tenant-owned document. Both legacy `libraryId` and
  //    canonical `tenantId` are checked so older/newer rows cannot dangle.
  for (const name of mongoose.modelNames()) {
    if (KEEP.has(name)) continue;
    const M = mongoose.model(name);
    const filter = tenantFilterFor(M, libraryId);
    if (!filter) continue; // global collections (partners, plans, config) are not tenant data
    const r = await M.deleteMany(filter).setOptions({ skipTenantGuard: true });
    if (r.deletedCount) counts[name] = r.deletedCount;
  }

  const u = await User.deleteMany({ role: { $ne: 'superadmin' }, $or: [{ tenantId: libraryId }, { libraryId }] });
  if (u.deletedCount) counts.User = u.deletedCount;

  // Library is removed last: if anything above fails, a retry still has the tenant record to target.
  const lib = await Library.deleteOne({ libraryId });
  if (lib.deletedCount) counts.Library = lib.deletedCount;

  // Best effort: disconnect the library's WhatsApp instance; never blocks the delete.
  let whatsapp = 'skipped';
  try {
    const client = evolution || (evolutionConfigured() ? createEvolutionClient() : null);
    if (client) { await client.logout(instanceNameFor(libraryId)); whatsapp = 'logged_out'; }
  } catch (e) { whatsapp = e?.status === 404 ? 'not_found' : 'failed'; }
  return { counts, whatsapp, retention, subject, deletedAt: new Date(now).toISOString() };
}

/** Concurrent requests for the same library share one deletion, so retries cannot double-delete. */
export function deleteLibraryData(libraryId, opts = {}) {
  const key = String(libraryId || '');
  if (inFlight.has(key)) return inFlight.get(key);
  const p = performDelete(libraryId, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/** Route helper: idempotent deletion proof. Never stores the super-admin's email/IP. */
export async function recordDeletionProof(libraryId, targetName, result, req) {
  const detail = { name: targetName, ...result };
  await AuditLog.updateOne(
    { action: 'library.deleted', target: libraryId },
    {
      $set: {
        action: 'library.deleted',
        tenantId: result?.subject || pseudonymizeTenant(libraryId),
        target: libraryId,
        actorRole: req?.user?.role || 'superadmin',
        detail,
        at: new Date(),
      },
      $unset: { actorId: '', actorEmail: '', ip: '', reason: '', impersonation: '' },
    },
    { upsert: true },
  );
}

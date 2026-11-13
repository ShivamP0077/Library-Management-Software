import mongoose from 'mongoose';
import tenantGuard, { applyBulkWriteGuard } from './tenantGuard.js';

/* ---------------------------------------------------------------------------
 * Platform (non-tenant) models
 * ------------------------------------------------------------------------- */

/**
 * A client library (tenant). `libraryId` is the canonical tenant identifier;
 * tenant collections store it as `tenantId`.
 */
export const Library = mongoose.model('Library', new mongoose.Schema({
  libraryId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  status: { type: String, enum: ['Active', 'Disabled'], default: 'Active' },
  contactEmail: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true, default: null },
  address: { type: String, trim: true, default: null },
  referralCode: { type: String, trim: true, unique: true, sparse: true, index: true },
  referredByCode: { type: String, trim: true, default: null },
  createdBy: String,
  isDefault: { type: Boolean, default: false },
  city: { type: String, trim: true, default: null }, // used for Library Insights location filters
  studentLimit: { type: Number, default: null }, // active + expired cap (null = unlimited)
  planId: { type: String, default: null }, // Issue #14: software plan (limits come from it unless overridden)
  subscription: { type: mongoose.Schema.Types.Mixed, default: null }, // Issues #15/#19: { planId, interval, status, price, trialEndsAt, currentPeriodEnd, cancelAtPeriodEnd, pendingPlanId }
  signupAt: { type: Date, default: null },
  deletionRequest: { type: mongoose.Schema.Types.Mixed, default: null }, // Issue #19: owner asked for deletion; Super Admin decides
  enquiryToken: { type: String, unique: true, sparse: true }, // public QR enquiry link; absent until generated
}, { timestamps: true }));

export const ROLES = ['superadmin', 'client_admin', 'staff', 'partner', 'agent'];
/** Platform accounts have no tenant of their own (partners/agents reach libraries only via assignment). */
export const PLATFORM_ROLES = ['superadmin', 'partner', 'agent'];
export const isPlatformRole = (role) => PLATFORM_ROLES.includes(role);

/**
 * Login accounts. superadmin has no tenant; client_admin/staff belong to exactly
 * one tenant. `tenantId` is the source of truth, `libraryId` is kept as a legacy
 * mirror so older documents keep working during migration.
 */
const userSchema = new mongoose.Schema({
  // Email is optional for mobile-only owners; at least one verified identifier is required.
  email: { type: String, lowercase: true, trim: true, required: function () { return !this.mobile; } }, // unique+sparse index below
  mobile: { type: String, trim: true },
  emailVerified: { type: Boolean, default: true }, // admin/legacy accounts keep working
  mobileVerified: { type: Boolean, default: false },
  pendingEmail: { type: String, lowercase: true, trim: true, default: null },
  pendingMobile: { type: String, trim: true, default: null },
  name: { type: String, trim: true, default: '' },
  passwordHash: { type: String, select: false }, // optional: Google-only accounts have none
  role: { type: String, enum: ROLES, required: true },
  tenantId: {
    type: String, index: true,
    required: function () { return !isPlatformRole(this.role); },
  },
  libraryId: {
    type: String, index: true,
    required: function () { return !isPlatformRole(this.role); },
  },
  staffId: String, // optional link to a staff record (staffMembers.id) inside the library
  status: { type: String, enum: ['Active', 'Disabled'], default: 'Active' },
  lastLoginAt: Date,
  passwordChangedAt: Date,
  googleSub: { type: String, index: true, sparse: true },
  authProviders: { type: [String], default: [] }, // e.g. ['password', 'google']
}, { timestamps: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ mobile: 1 }, { unique: true, sparse: true });
// Keep the legacy libraryId mirror in sync when only one of the two is supplied.
userSchema.pre('validate', function syncTenantFields() {
  if (!this.tenantId && this.libraryId) this.tenantId = this.libraryId;
  if (!this.libraryId && this.tenantId) this.libraryId = this.tenantId;
});
userSchema.methods.toSafeJSON = function () {
  const { _id, email, mobile, emailVerified, mobileVerified, name, role, staffId, status, lastLoginAt, createdAt, authProviders } = this;
  const tenantId = this.tenantId || this.libraryId || null;
  // Both fields are exposed for compatibility; the frontend still reads libraryId.
  return { id: String(_id), email: email || null, mobile: mobile || null, emailVerified: emailVerified !== false, mobileVerified: mobileVerified === true, name, role, libraryId: tenantId, tenantId, staffId: staffId || null, status, lastLoginAt, createdAt, authProviders };
};
export const User = mongoose.model('User', userSchema);

/* ---------------------------------------------------------------------------
 * Tenant-scoped models
 * The frontend owns rich, evolving documents, so each collection uses a flexible
 * schema (strict: false) keyed by the UI's business id (_key) and ALWAYS scoped by
 * tenantId. Uniqueness is per tenant: { tenantId, _key }.
 * paidOn and enteredAt are optional. Old payments keep working with `date` only.
 * No migration is required; strict:false already stores the extra fields.
 * ------------------------------------------------------------------------- */
const tenantSchema = (fields = {}) => {
  const s = new mongoose.Schema(
    { tenantId: { type: String, required: true, index: true }, _key: { type: String, required: true }, ...fields },
    { strict: false, timestamps: true, minimize: false }
  );
  // Unique per tenant. The partial filter lets pre-migration documents (which
  // have no tenantId yet) coexist until migrate-tenants backfills them.
  s.index({ tenantId: 1, _key: 1 }, { unique: true, partialFilterExpression: { tenantId: { $type: 'string' } } });
  s.plugin(tenantGuard);
  return s;
};

// API collection name -> model definition
export const COLLECTIONS = {
  students:         { name: 'Student',          keys: ['id'], fields: { id: String, name: String, phone: String, branchId: String, status: String, seatNo: String } },
  archivedStudents: { name: 'ArchivedStudent',  keys: ['id'], fields: { id: String, name: String, phone: String } },
  payments:         { name: 'Payment',          keys: ['receiptNo', 'id'], fields: { receiptNo: String, studentId: String, netTotal: Number, amount: Number, date: String, paidOn: String, enteredAt: String, periodStart: String, periodEnd: String, branchId: String } },
  expenses:         { name: 'Expense',          keys: ['id'], fields: { id: String, category: String, amount: Number, date: String, branchId: String } },
  staffMembers:     { name: 'Staff',            keys: ['id'], fields: { id: String, name: String, email: String, role: String, status: String } },
  branches:         { name: 'Branch',           keys: ['id'], fields: { id: String, name: String, code: String } },
  sections:         { name: 'Section',          keys: ['id'], fields: { id: String, name: String, branchId: String } },
  seatTypes:        { name: 'SeatType',         keys: ['id'], fields: { id: String, name: String, allocationMode: String } },
  seats:            { name: 'Seat',             keys: ['id'], fields: { id: String, name: String, branchId: String, sectionId: String, seatTypeId: String } },
  shifts:           { name: 'Shift',            keys: ['id'], fields: { id: String, name: String, startTime: String, endTime: String } },
  plans:            { name: 'Plan',             keys: ['id'], fields: { id: String, name: String, seatTypeId: String } },
  waitingList:      { name: 'WaitingListEntry', keys: ['id'], fields: { id: String, name: String, status: String } },
};

export const models = {};
for (const [col, def] of Object.entries(COLLECTIONS)) {
  const schema = tenantSchema(def.fields);
  if (col === 'payments') schema.index({ tenantId: 1, studentId: 1 });
  if (col === 'students') schema.index({ tenantId: 1, branchId: 1, status: 1 });
  models[col] = applyBulkWriteGuard(mongoose.model(def.name, schema));
}

/** One settings document per tenant (the frontend's `settings` object). */
const settingsSchema = new mongoose.Schema(
  { tenantId: { type: String, required: true } },
  { strict: false, timestamps: true, minimize: false }
);
settingsSchema.index({ tenantId: 1 }, { unique: true, partialFilterExpression: { tenantId: { $type: 'string' } } });
settingsSchema.plugin(tenantGuard);
export const Settings = applyBulkWriteGuard(mongoose.model('Settings', settingsSchema));

/** Student document scans (base64 data URLs), previously IndexedDB-only. */
const docSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  libraryId: String, // legacy mirror of tenantId (rollback only, never queried)
  storageKey: { type: String, required: true },
  data: { type: String, required: true },
  // Issue #3 metadata. Optional so pre-existing uploads keep working.
  studentId: { type: String, index: true },
  docTypeId: String,
  fileName: String,
  fileType: String,
  fileSize: Number,
  status: String,
  uploadedAt: Date,
  createdBy: String,
  // Issue #3/#16 retention: retired files stay recoverable for 30 days, then the job purges them.
  retiredAt: { type: Date, default: null, index: true },
  purgeAfter: { type: Date, default: null, index: true },
}, { timestamps: true });
docSchema.index({ tenantId: 1, storageKey: 1 }, { unique: true, partialFilterExpression: { tenantId: { $type: 'string' } } });
docSchema.index({ tenantId: 1, studentId: 1, retiredAt: 1 });
docSchema.plugin(tenantGuard);
export const StudentDocument = applyBulkWriteGuard(mongoose.model('StudentDocument', docSchema));

export const keyOf = (col, doc) => {
  for (const k of COLLECTIONS[col].keys) if (doc && doc[k] != null && doc[k] !== '') return String(doc[k]);
  return null;
};

const INTERNAL = ['_id', '_key', '_order', '__v', 'createdAt', 'updatedAt', 'tenantId'];
export const clean = (doc) => {
  if (!doc) return doc;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const tenantId = o.tenantId;
  for (const f of INTERNAL) delete o[f];
  // API output keeps the historical `libraryId` field name.
  if (tenantId !== undefined && tenantId !== null) o.libraryId = tenantId;
  return o;
};

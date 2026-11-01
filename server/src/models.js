import mongoose from 'mongoose';

/* ---------------------------------------------------------------------------
 * Platform (non-tenant) models
 * ------------------------------------------------------------------------- */

/** A client library (tenant). libraryId is the tenant id carried by every tenant document. */
export const Library = mongoose.model('Library', new mongoose.Schema({
  libraryId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  status: { type: String, enum: ['Active', 'Disabled'], default: 'Active' },
  contactEmail: { type: String, trim: true, lowercase: true },
  createdBy: String,
}, { timestamps: true }));

export const ROLES = ['superadmin', 'client_admin', 'staff'];

/** Login accounts. superadmin has no libraryId; client_admin/staff belong to exactly one library. */
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, trim: true, default: '' },
  passwordHash: { type: String, select: false }, // optional: Google-only accounts have none
  role: { type: String, enum: ROLES, required: true },
  libraryId: {
    type: String, index: true,
    required: function () { return this.role !== 'superadmin'; },
  },
  staffId: String, // optional link to a staff record (staffMembers.id) inside the library
  status: { type: String, enum: ['Active', 'Disabled'], default: 'Active' },
  lastLoginAt: Date,
  googleSub: { type: String, index: true, sparse: true },
  authProviders: { type: [String], default: [] }, // e.g. ['password', 'google']
}, { timestamps: true });
userSchema.methods.toSafeJSON = function () {
  const { _id, email, name, role, libraryId, staffId, status, lastLoginAt, createdAt, authProviders } = this;
  return { id: String(_id), email, name, role, libraryId: libraryId || null, staffId: staffId || null, status, lastLoginAt, createdAt, authProviders };
};
export const User = mongoose.model('User', userSchema);

/* ---------------------------------------------------------------------------
 * Tenant-scoped models
 * The frontend owns rich, evolving documents, so each collection uses a flexible
 * schema (strict: false) keyed by the UI's business id (_key) and ALWAYS scoped by
 * libraryId. Uniqueness is per tenant: { libraryId, _key }.
 * ------------------------------------------------------------------------- */
const tenantSchema = (fields = {}) => {
  const s = new mongoose.Schema(
    { libraryId: { type: String, required: true, index: true }, _key: { type: String, required: true }, ...fields },
    { strict: false, timestamps: true, minimize: false }
  );
  s.index({ libraryId: 1, _key: 1 }, { unique: true });
  return s;
};

// API collection name -> model definition
export const COLLECTIONS = {
  students:         { name: 'Student',          keys: ['id'], fields: { id: String, name: String, phone: String, branchId: String, status: String, seatNo: String } },
  archivedStudents: { name: 'ArchivedStudent',  keys: ['id'], fields: { id: String, name: String, phone: String } },
  payments:         { name: 'Payment',          keys: ['receiptNo', 'id'], fields: { receiptNo: String, studentId: String, netTotal: Number, amount: Number, date: String, branchId: String } },
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
  if (col === 'payments') schema.index({ libraryId: 1, studentId: 1 });
  if (col === 'students') schema.index({ libraryId: 1, branchId: 1, status: 1 });
  models[col] = mongoose.model(def.name, schema);
}

/** One settings document per library (the frontend's `settings` object). */
export const Settings = mongoose.model('Settings', new mongoose.Schema(
  { libraryId: { type: String, required: true, unique: true } },
  { strict: false, timestamps: true, minimize: false }
));

/** Student document scans (base64 data URLs), previously IndexedDB-only. */
const docSchema = new mongoose.Schema({
  libraryId: { type: String, required: true },
  storageKey: { type: String, required: true },
  data: { type: String, required: true },
}, { timestamps: true });
docSchema.index({ libraryId: 1, storageKey: 1 }, { unique: true });
export const StudentDocument = mongoose.model('StudentDocument', docSchema);

export const keyOf = (col, doc) => {
  for (const k of COLLECTIONS[col].keys) if (doc && doc[k] != null && doc[k] !== '') return String(doc[k]);
  return null;
};

const INTERNAL = ['_id', '_key', '_order', '__v', 'createdAt', 'updatedAt'];
export const clean = (doc) => {
  if (!doc) return doc;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  for (const f of INTERNAL) delete o[f];
  return o;
};

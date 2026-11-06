import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Library, User, models, isPlatformRole } from './models.js';
import { AuditLog } from './audit.js';
import { DeletionJob } from './deletionJob.js';

export const generatePassword = (len = 20) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*-_';
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
};
export const hashPassword = (pw) => bcrypt.hash(String(pw), 12);
export const validatePassword = (pw) => typeof pw === 'string' && pw.length >= 8;

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'library';

/** Creates a library (tenant) with its settings doc and optionally a client-admin account. */
export async function createLibrary({ name, libraryId, contactEmail, phone, city, address, referralCode, referredByCode, admin, createdBy, isDefault }) {
  if (!name || !String(name).trim()) throw Object.assign(new Error('Library name is required'), { status: 400 });
  let id = libraryId ? slug(libraryId) : `lib-${slug(name)}`;
  // A deleted library's id is permanently retired: old backups, browser caches and
  // audit records must never attach to a different customer.
  const idRetired = async (candidate) => (
    await DeletionJob.exists({ libraryId: candidate })
    || await AuditLog.exists({ action: 'library.deleted', target: candidate })
  );
  if (await Library.exists({ libraryId: id })) {
    if (libraryId) throw Object.assign(new Error('libraryId already exists'), { status: 409 });
    id = `${id}-${crypto.randomBytes(3).toString('hex')}`;
  }
  if (await idRetired(id)) {
    if (libraryId) throw Object.assign(new Error('libraryId belonged to a deleted library and cannot be reused'), { status: 409, code: 'library_id_retired' });
    id = `${id}-${crypto.randomBytes(3).toString('hex')}`;
  }
  let adminUser = null, generatedPassword = null;
  if (admin?.email || admin?.mobile) {
    if (admin?.email && await User.exists({ email: String(admin.email).toLowerCase().trim() })) throw Object.assign(new Error('Admin email already in use'), { status: 409 });
    if (admin?.mobile && await User.exists({ mobile: String(admin.mobile).replace(/\D/g, '') })) throw Object.assign(new Error('Owner mobile already in use'), { status: 409 });
    if (admin.password && !validatePassword(admin.password)) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  }
  const code = referralCode || `LIB-${String(id).toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
  const library = await Library.create({ libraryId: id, name: String(name).trim(), contactEmail, phone: phone || null, city: city || null, address: address || null, referralCode: code, referredByCode: referredByCode || null, createdBy, ...(isDefault !== undefined ? { isDefault } : {}) });
  if (admin?.email || admin?.mobile) adminUser = await createUser({ ...admin, role: 'client_admin', tenantId: id, libraryId: id });
  if (adminUser) { generatedPassword = adminUser.generatedPassword; adminUser = adminUser.user; }
  return { library, adminUser, generatedPassword };
}

/**
 * Creates a login account. Password is optional: without one the account can only sign
 * in with Google (email must match). Pass generatePassword: true to mint a random one.
 */
export async function createUser({ email, mobile, name, role, tenantId, libraryId, staffId, password, generatePassword: gen, emailVerified, mobileVerified, authProviders }) {
  email = email ? String(email).toLowerCase().trim() : '';
  mobile = mobile ? String(mobile).replace(/\D/g, '') : '';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('A valid email is required'), { status: 400 });
  if (!email && !mobile) throw Object.assign(new Error('An email or mobile number is required'), { status: 400 });
  if (email && await User.exists({ email })) throw Object.assign(new Error('Email already in use'), { status: 409 });
  if (mobile && await User.exists({ mobile })) throw Object.assign(new Error('Mobile number already in use'), { status: 409 });
  if (password && !validatePassword(password)) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  const generatedPassword = !password && gen ? generatePassword() : null;
  const pw = password || generatedPassword;
  const tid = isPlatformRole(role) ? undefined : (tenantId || libraryId);
  const providers = authProviders || ['google', ...(pw ? ['password'] : [])];
  const user = await User.create({
    email: email || undefined, mobile: mobile || undefined, name: name || '', role, tenantId: tid, libraryId: tid, staffId,
    passwordHash: pw ? await hashPassword(pw) : undefined,
    emailVerified: emailVerified !== undefined ? emailVerified : Boolean(email),
    mobileVerified: mobileVerified === true,
    authProviders: providers,
  });
  return { user, generatedPassword };
}

const sumField = (expr) => ({ $sum: { $convert: { input: expr, to: 'double', onError: 0, onNull: 0 } } });

/** Aggregate metrics for one or all tenants. */
export async function computeMetrics(libraryIds) {
  const scoped = Array.isArray(libraryIds);
  // Always scope the aggregation by tenantId. The unscoped (all-tenants) metrics
  // aggregation is the only trusted platform query that bypasses the guard.
  const ids = scoped ? libraryIds : (await Library.find().select('libraryId').lean()).map(l => l.libraryId);
  const match = { tenantId: { $in: ids } };
  const aggregate = (Model, pipeline) => {
    const q = Model.aggregate(pipeline);
    if (!scoped) q.option({ skipTenantGuard: true });
    return q;
  };
  const ACTIVE = ['Active', 'Expiring Soon'];
  const [seats, students, occupied, payments, expenses] = await Promise.all([
    aggregate(models.seats, [{ $match: match }, { $group: { _id: '$tenantId', total: { $sum: 1 } } }]),
    aggregate(models.students, [{ $match: match }, { $group: {
      _id: '$tenantId', total: { $sum: 1 },
      active: { $sum: { $cond: [{ $in: ['$status', ACTIVE] }, 1, 0] } } } }]),
    // Occupied fixed desks = distinct (branch, section, seatNo) held by active students
    aggregate(models.students, [
      { $match: { ...match, status: { $in: ACTIVE }, seatNo: { $nin: [null, '', 'Non-Fixed Seat'] } } },
      { $group: { _id: { lib: '$tenantId', b: '$branchId', s: '$sectionId', n: '$seatNo' } } },
      { $group: { _id: '$_id.lib', occupied: { $sum: 1 } } }]),
    aggregate(models.payments, [{ $match: match }, { $group: {
      _id: '$tenantId', count: { $sum: 1 }, revenue: sumField({ $ifNull: ['$netTotal', '$amount'] }) } }]),
    aggregate(models.expenses, [{ $match: match }, { $group: { _id: '$tenantId', count: { $sum: 1 }, total: sumField('$amount') } }]),
  ]);
  const byLib = {};
  const get = (id) => (byLib[id] ||= { libraryId: id, seatsTotal: 0, seatsOccupied: 0, studentsTotal: 0, studentsActive: 0, paymentsCount: 0, revenue: 0, expensesCount: 0, expenses: 0, net: 0 });
  (libraryIds || []).forEach(get);
  seats.forEach(r => { get(r._id).seatsTotal = r.total; });
  students.forEach(r => { Object.assign(get(r._id), { studentsTotal: r.total, studentsActive: r.active }); });
  occupied.forEach(r => { get(r._id).seatsOccupied = r.occupied; });
  payments.forEach(r => { Object.assign(get(r._id), { paymentsCount: r.count, revenue: r.revenue }); });
  expenses.forEach(r => { Object.assign(get(r._id), { expensesCount: r.count, expenses: r.total }); });
  const perLibrary = Object.values(byLib).map(m => ({ ...m, seatsOccupied: Math.min(m.seatsOccupied, m.seatsTotal), net: m.revenue - m.expenses }));
  const totals = perLibrary.reduce((t, m) => {
    for (const k of ['seatsTotal', 'seatsOccupied', 'studentsTotal', 'studentsActive', 'paymentsCount', 'revenue', 'expensesCount', 'expenses', 'net']) t[k] += m[k];
    return t;
  }, { libraries: perLibrary.length, seatsTotal: 0, seatsOccupied: 0, studentsTotal: 0, studentsActive: 0, paymentsCount: 0, revenue: 0, expensesCount: 0, expenses: 0, net: 0 });
  return { perLibrary, totals };
}

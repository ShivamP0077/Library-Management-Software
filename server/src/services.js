import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Library, User, models, Settings } from './models.js';

export const generatePassword = (len = 20) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*-_';
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
};
export const hashPassword = (pw) => bcrypt.hash(String(pw), 12);
export const validatePassword = (pw) => typeof pw === 'string' && pw.length >= 8;

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'library';

/** Creates a library (tenant) with its settings doc and optionally a client-admin account. */
export async function createLibrary({ name, libraryId, contactEmail, admin, createdBy }) {
  if (!name || !String(name).trim()) throw Object.assign(new Error('Library name is required'), { status: 400 });
  let id = libraryId ? slug(libraryId) : `lib-${slug(name)}`;
  if (await Library.exists({ libraryId: id })) {
    if (libraryId) throw Object.assign(new Error('libraryId already exists'), { status: 409 });
    id = `${id}-${crypto.randomBytes(3).toString('hex')}`;
  }
  let adminUser = null, generatedPassword = null;
  if (admin?.email) {
    if (await User.exists({ email: String(admin.email).toLowerCase().trim() })) throw Object.assign(new Error('Admin email already in use'), { status: 409 });
    if (admin.password && !validatePassword(admin.password)) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  }
  const library = await Library.create({ libraryId: id, name: String(name).trim(), contactEmail, createdBy });
  if (admin?.email) adminUser = await createUser({ ...admin, role: 'client_admin', libraryId: id });
  if (adminUser) { generatedPassword = adminUser.generatedPassword; adminUser = adminUser.user; }
  return { library, adminUser, generatedPassword };
}

/**
 * Creates a login account. Password is optional: without one the account can only sign
 * in with Google (email must match). Pass generatePassword: true to mint a random one.
 */
export async function createUser({ email, name, role, libraryId, staffId, password, generatePassword: gen }) {
  email = String(email || '').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('A valid email is required'), { status: 400 });
  if (await User.exists({ email })) throw Object.assign(new Error('Email already in use'), { status: 409 });
  if (password && !validatePassword(password)) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  const generatedPassword = !password && gen ? generatePassword() : null;
  const pw = password || generatedPassword;
  const user = await User.create({
    email, name: name || '', role, libraryId: role === 'superadmin' ? undefined : libraryId, staffId,
    passwordHash: pw ? await hashPassword(pw) : undefined,
    authProviders: ['google', ...(pw ? ['password'] : [])],
  });
  return { user, generatedPassword };
}

const sumField = (expr) => ({ $sum: { $convert: { input: expr, to: 'double', onError: 0, onNull: 0 } } });

/** Aggregate metrics for one or all libraries. */
export async function computeMetrics(libraryIds) {
  const match = libraryIds ? { libraryId: { $in: libraryIds } } : {};
  const ACTIVE = ['Active', 'Expiring Soon'];
  const [seats, students, occupied, payments, expenses] = await Promise.all([
    models.seats.aggregate([{ $match: match }, { $group: { _id: '$libraryId', total: { $sum: 1 } } }]),
    models.students.aggregate([{ $match: match }, { $group: {
      _id: '$libraryId', total: { $sum: 1 },
      active: { $sum: { $cond: [{ $in: ['$status', ACTIVE] }, 1, 0] } } } }]),
    // Occupied fixed desks = distinct (branch, section, seatNo) held by active students
    models.students.aggregate([
      { $match: { ...match, status: { $in: ACTIVE }, seatNo: { $nin: [null, '', 'Non-Fixed Seat'] } } },
      { $group: { _id: { lib: '$libraryId', b: '$branchId', s: '$sectionId', n: '$seatNo' } } },
      { $group: { _id: '$_id.lib', occupied: { $sum: 1 } } }]),
    models.payments.aggregate([{ $match: match }, { $group: {
      _id: '$libraryId', count: { $sum: 1 }, revenue: sumField({ $ifNull: ['$netTotal', '$amount'] }) } }]),
    models.expenses.aggregate([{ $match: match }, { $group: { _id: '$libraryId', count: { $sum: 1 }, total: sumField('$amount') } }]),
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

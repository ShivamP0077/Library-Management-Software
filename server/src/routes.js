import express from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { COLLECTIONS, models, Settings, StudentDocument, Library, User, keyOf, clean } from './models.js';
import { signToken, requireAuth, requireRole, tenantScope } from './auth.js';
import { createLibrary, createUser, computeMetrics, hashPassword, validatePassword } from './services.js';
import { verifyGoogleIdToken, googleEnabled } from './google.js';

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// libraryId is stripped from all client input: the tenant always comes from req.libraryId
const stripMeta = (body) => { const o = { ...(body || {}) }; for (const f of ['_id', '_key', '_order', '__v', 'createdAt', 'updatedAt', 'libraryId']) delete o[f]; return o; };

// ---------------------------------------------------------------- Health
export const healthHandler = wrap(async (_req, res) => {
  const state = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
  let ping = false;
  if (state === 'connected') { await mongoose.connection.db.admin().ping(); ping = true; }
  const collections = ping ? (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).sort() : [];
  res.status(ping ? 200 : 503).json({ ok: ping, db: { state, name: mongoose.connection.name, collections }, googleAuth: googleEnabled() });
});
router.get('/health', healthHandler);

// ---------------------------------------------------------------- Auth
async function issueSession(user, res) {
  if (user.status !== 'Active') return res.status(403).json({ error: 'Account is disabled' });
  let library = null;
  if (user.role !== 'superadmin') {
    library = await Library.findOne({ libraryId: user.libraryId }).lean();
    if (!library || library.status !== 'Active') return res.status(403).json({ error: 'Library is disabled' });
  }
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  res.json({ token: signToken(user), user: user.toSafeJSON(), library: library && { libraryId: library.libraryId, name: library.name, status: library.status } });
}

router.get('/auth/config', (_req, res) => res.json({ googleEnabled: googleEnabled(), passwordLogin: true }));

// Optional fallback for seeded / password-enabled accounts
router.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+passwordHash');
  if (!user || !user.passwordHash || !(await bcrypt.compare(String(password), user.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' });
  return issueSession(user, res);
}));

// Google Identity Services: verify ID token, map verified email to a pre-provisioned user. No self-signup.
router.post('/auth/google', wrap(async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'credential (Google ID token) is required' });
  const g = await verifyGoogleIdToken(credential);
  const user = await User.findOne({ email: g.email });
  if (!user) return res.status(403).json({ error: 'This Google account is not registered. Ask your administrator to add your email.' });
  if (user.googleSub && user.googleSub !== g.sub) return res.status(401).json({ error: 'Google account mismatch' });
  if (!user.googleSub) { user.googleSub = g.sub; if (!user.name && g.name) user.name = g.name; await user.save(); }
  return issueSession(user, res);
}));

router.use(requireAuth);

router.get('/auth/me', wrap(async (req, res) => {
  const user = await User.findById(req.user.id);
  const library = user.libraryId ? await Library.findOne({ libraryId: user.libraryId }).lean() : null;
  res.json({ user: user.toSafeJSON(), library: library && { libraryId: library.libraryId, name: library.name, status: library.status } });
}));

router.post('/auth/change-password', wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!validatePassword(newPassword)) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (user.passwordHash && !(await bcrypt.compare(String(currentPassword || ''), user.passwordHash))) return res.status(401).json({ error: 'Current password is incorrect' });
  user.passwordHash = await hashPassword(newPassword);
  user.authProviders = [...new Set([...(user.authProviders || []), 'password'])];
  await user.save();
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Super admin
const admin = express.Router();
admin.use(requireRole('superadmin'));

admin.get('/libraries', wrap(async (_req, res) => {
  const libs = await Library.find().sort({ createdAt: 1 }).lean();
  const { perLibrary } = await computeMetrics(libs.map(l => l.libraryId));
  const admins = await User.find({ role: 'client_admin' }).lean();
  const m = Object.fromEntries(perLibrary.map(x => [x.libraryId, x]));
  res.json(libs.map(l => ({
    libraryId: l.libraryId, name: l.name, status: l.status, contactEmail: l.contactEmail, createdAt: l.createdAt,
    admins: admins.filter(a => a.libraryId === l.libraryId).map(a => ({ id: String(a._id), email: a.email, name: a.name, status: a.status })),
    metrics: m[l.libraryId],
  })));
}));

admin.post('/libraries', wrap(async (req, res) => {
  const { name, libraryId, contactEmail, adminEmail, adminName, adminPassword, generatePassword } = req.body || {};
  const r = await createLibrary({ name, libraryId, contactEmail, createdBy: req.user.email,
    admin: adminEmail ? { email: adminEmail, name: adminName, password: adminPassword, generatePassword } : null });
  res.status(201).json({
    library: { libraryId: r.library.libraryId, name: r.library.name, status: r.library.status },
    admin: r.adminUser?.toSafeJSON() || null,
    generatedPassword: r.generatedPassword || undefined, // shown once, never stored in plain text
  });
}));

admin.patch('/libraries/:libraryId', wrap(async (req, res) => {
  const set = {};
  if (req.body?.name) set.name = String(req.body.name).trim();
  if (req.body?.status) { if (!['Active', 'Disabled'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' }); set.status = req.body.status; }
  if (req.body?.contactEmail !== undefined) set.contactEmail = req.body.contactEmail;
  const lib = await Library.findOneAndUpdate({ libraryId: req.params.libraryId }, { $set: set }, { new: true, lean: true });
  lib ? res.json({ libraryId: lib.libraryId, name: lib.name, status: lib.status }) : res.status(404).json({ error: 'Library not found' });
}));

admin.get('/metrics', wrap(async (_req, res) => {
  const libs = await Library.find().lean();
  const { perLibrary, totals } = await computeMetrics(libs.map(l => l.libraryId));
  const names = Object.fromEntries(libs.map(l => [l.libraryId, { name: l.name, status: l.status }]));
  res.json({ totals, perLibrary: perLibrary.map(p => ({ ...p, ...names[p.libraryId] })) });
}));

admin.get('/libraries/:libraryId/users', wrap(async (req, res) => {
  res.json((await User.find({ libraryId: req.params.libraryId })).map(u => u.toSafeJSON()));
}));

// Pre-provision a client admin (or staff) by email; Google sign-in then works for them.
admin.post('/libraries/:libraryId/users', wrap(async (req, res) => {
  if (!(await Library.exists({ libraryId: req.params.libraryId }))) return res.status(404).json({ error: 'Library not found' });
  const role = req.body?.role === 'staff' ? 'staff' : 'client_admin';
  const r = await createUser({ ...req.body, role, libraryId: req.params.libraryId });
  res.status(201).json({ user: r.user.toSafeJSON(), generatedPassword: r.generatedPassword || undefined });
}));

admin.patch('/users/:id', wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body?.status) user.status = req.body.status === 'Disabled' ? 'Disabled' : 'Active';
  if (req.body?.name !== undefined) user.name = req.body.name;
  if (req.body?.password) {
    if (!validatePassword(req.body.password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    user.passwordHash = await hashPassword(req.body.password);
    user.authProviders = [...new Set([...(user.authProviders || []), 'password'])];
  }
  await user.save();
  res.json(user.toSafeJSON());
}));

router.use('/admin', admin);

// ---------------------------------------------------------------- Tenant data (scoped)
const tenant = express.Router();
tenant.use(tenantScope);

// Client admins manage login accounts for their own library (staff / co-admins)
tenant.get('/users', requireRole('client_admin', 'superadmin'), wrap(async (req, res) => {
  res.json((await User.find({ libraryId: req.libraryId })).map(u => u.toSafeJSON()));
}));
tenant.post('/users', requireRole('client_admin', 'superadmin'), wrap(async (req, res) => {
  const role = req.body?.role === 'client_admin' ? 'client_admin' : 'staff';
  const r = await createUser({ ...req.body, role, libraryId: req.libraryId });
  res.status(201).json({ user: r.user.toSafeJSON(), generatedPassword: r.generatedPassword || undefined });
}));
tenant.patch('/users/:id', requireRole('client_admin', 'superadmin'), wrap(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, libraryId: req.libraryId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body?.status) user.status = req.body.status === 'Disabled' ? 'Disabled' : 'Active';
  if (req.body?.name !== undefined) user.name = req.body.name;
  if (req.body?.staffId !== undefined) user.staffId = req.body.staffId;
  await user.save();
  res.json(user.toSafeJSON());
}));

// Full snapshot of this library (frontend loads this on start)
tenant.get('/state', wrap(async (req, res) => {
  const out = {};
  await Promise.all(Object.keys(COLLECTIONS).map(async col => {
    out[col] = (await models[col].find({ libraryId: req.libraryId }).sort({ _order: 1, createdAt: 1 }).lean()).map(clean);
  }));
  const s = await Settings.findOne({ libraryId: req.libraryId }).lean();
  out.settings = s && Object.keys(clean(s)).length > 1 ? clean(s) : null;
  out.libraryId = req.libraryId;
  out.readOnly = req.readOnly;
  res.json(out);
}));

tenant.get('/settings', wrap(async (req, res) => {
  const s = await Settings.findOne({ libraryId: req.libraryId }).lean();
  res.json(s ? clean(s) : null);
}));
tenant.put('/settings', requireRole('client_admin', 'superadmin', 'staff'), wrap(async (req, res) => {
  const s = await Settings.findOneAndReplace({ libraryId: req.libraryId }, { ...stripMeta(req.body), libraryId: req.libraryId }, { upsert: true, new: true, lean: true });
  res.json(clean(s));
}));

tenant.get('/documents/:key', wrap(async (req, res) => {
  const d = await StudentDocument.findOne({ libraryId: req.libraryId, storageKey: req.params.key }).lean();
  d ? res.json({ storageKey: d.storageKey, data: d.data }) : res.status(404).json({ error: 'Not found' });
}));
tenant.put('/documents/:key', wrap(async (req, res) => {
  if (!req.body?.data) return res.status(400).json({ error: 'data is required' });
  await StudentDocument.updateOne({ libraryId: req.libraryId, storageKey: req.params.key }, { $set: { data: req.body.data } }, { upsert: true });
  res.json({ ok: true });
}));
tenant.delete('/documents/:key', wrap(async (req, res) => {
  await StudentDocument.deleteOne({ libraryId: req.libraryId, storageKey: req.params.key });
  res.json({ ok: true });
}));

// Generic REST for each entity collection, always filtered by req.libraryId
const colParam = (req, res, next) => {
  if (!COLLECTIONS[req.params.col]) return res.status(404).json({ error: `Unknown collection "${req.params.col}"` });
  req.Model = models[req.params.col];
  next();
};

tenant.get('/:col', colParam, wrap(async (req, res) => {
  const filter = { libraryId: req.libraryId };
  for (const f of ['branchId', 'status', 'studentId']) if (req.query[f]) filter[f] = String(req.query[f]);
  res.json((await req.Model.find(filter).sort({ _order: 1, createdAt: 1 }).lean()).map(clean));
}));

tenant.get('/:col/:key', colParam, wrap(async (req, res) => {
  const d = await req.Model.findOne({ libraryId: req.libraryId, _key: req.params.key }).lean();
  d ? res.json(clean(d)) : res.status(404).json({ error: 'Not found' });
}));

tenant.post('/:col', colParam, wrap(async (req, res) => {
  const body = stripMeta(req.body);
  const _key = keyOf(req.params.col, body);
  if (!_key) return res.status(400).json({ error: `Missing key field (${COLLECTIONS[req.params.col].keys.join(' or ')})` });
  if (await req.Model.exists({ libraryId: req.libraryId, _key })) return res.status(409).json({ error: 'Already exists' });
  const d = await req.Model.create({ ...body, _key, libraryId: req.libraryId });
  res.status(201).json(clean(d));
}));

tenant.put('/:col/:key', colParam, wrap(async (req, res) => {
  const d = await req.Model.findOneAndUpdate({ libraryId: req.libraryId, _key: req.params.key }, { $set: stripMeta(req.body) }, { new: true, lean: true });
  d ? res.json(clean(d)) : res.status(404).json({ error: 'Not found' });
}));

tenant.delete('/:col/:key', colParam, wrap(async (req, res) => {
  const r = await req.Model.deleteOne({ libraryId: req.libraryId, _key: req.params.key });
  r.deletedCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
}));

// Bulk sync: make this library's collection match the array the UI holds
// (upsert all, delete this library's docs that are no longer present).
tenant.put('/:col', colParam, wrap(async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Body must be an array' });
  const col = req.params.col;
  const seen = new Set();
  const ops = [];
  req.body.forEach((raw, i) => {
    const body = stripMeta(raw);
    const _key = keyOf(col, body);
    if (!_key || seen.has(_key)) return;
    seen.add(_key);
    ops.push({ replaceOne: { filter: { libraryId: req.libraryId, _key }, replacement: { ...body, _key, _order: i, libraryId: req.libraryId }, upsert: true } });
  });
  if (ops.length) await req.Model.bulkWrite(ops, { ordered: false });
  const del = await req.Model.deleteMany({ libraryId: req.libraryId, _key: { $nin: [...seen] } });
  res.json({ ok: true, upserted: ops.length, deleted: del.deletedCount });
}));

router.use('/', tenant);
export default router;

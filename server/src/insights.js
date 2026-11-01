/**
 * Spec §8 SA-01.
 * - SaaS dashboard (`GET /admin/saas-summary`): OUR business only — customer libraries, growth,
 *   activity, plus KPIs contributed by other modules (partners/commissions, support tickets) via
 *   registerSaasKpi(). Subscription/trial/software-revenue KPIs belong to §5 billing (out of scope)
 *   and are reported as `notAvailable`. No customer students/seats/fees/expenses here.
 * - Library Insights & Analytics (`GET /admin/insights`, `/admin/insights/export.csv`): aggregated
 *   customer operational data, no student PII, filters (date, tenant, city, plan), every access audited.
 * Every aggregation is matched on an explicit tenantId list.
 */
import express from 'express';
import { Library, models, User } from './models.js';
import { audit } from './audit.js';
import { todayIn } from './finance.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const kpiProviders = [];
/** Other modules add SaaS KPIs: fn({ libraryIds }) → object merged into summary.kpis[name]. */
const listDecorators = [];
/** Other modules add per-library fields to the dashboard list: fn(ids) → { [libraryId]: {...} }. */
export const registerLibraryListFields = (fn) => { if (!listDecorators.includes(fn)) listDecorators.push(fn); };
export const registerSaasKpi = (name, fn) => { if (!kpiProviders.some(k => k.name === name)) kpiProviders.push({ name, fn }); };

const ACTIVE = ['Active', 'Expiring Soon'];
const num = (e) => ({ $convert: { input: e, to: 'double', onError: 0, onNull: 0 } });
const monthOf = (d) => (d instanceof Date ? d.toISOString() : String(d || '')).slice(0, 7);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export async function saasSummary() {
  const libs = await Library.find().sort({ createdAt: 1 }).lean();
  const ids = libs.map(l => l.libraryId);
  const today = todayIn();
  const month = today.slice(0, 7);
  const since7 = new Date(Date.now() - 7 * 864e5);
  const users = await User.find({ role: { $ne: 'superadmin' }, tenantId: { $in: ids } }).select('tenantId role email name status lastLoginAt').lean();
  const lastActive = {};
  for (const u of users) if (u.lastLoginAt && (!lastActive[u.tenantId] || u.lastLoginAt > lastActive[u.tenantId])) lastActive[u.tenantId] = u.lastLoginAt;
  const growth = {};
  for (const l of libs) { const m = monthOf(l.createdAt); growth[m] = (growth[m] || 0) + 1; }
  const kpis = {};
  for (const p of kpiProviders) { try { kpis[p.name] = await p.fn({ libraryIds: ids }); } catch (e) { kpis[p.name] = { error: e.message }; } }
  const extra = {};
  for (const fn of listDecorators) { try { for (const [id, v] of Object.entries(await fn(ids))) extra[id] = { ...(extra[id] || {}), ...v }; } catch (e) { console.error('[saas-summary]', e.message); } }
  return {
    libraries: {
      total: libs.length,
      active: libs.filter(l => l.status === 'Active').length,
      disabled: libs.filter(l => l.status !== 'Active').length,
      newThisMonth: libs.filter(l => monthOf(l.createdAt) === month).length,
      activeLast7Days: Object.values(lastActive).filter(d => d >= since7).length,
      growth: Object.entries(growth).sort().map(([m, count]) => ({ month: m, count })),
    },
    accounts: { owners: users.filter(u => u.role === 'client_admin').length, staff: users.filter(u => u.role !== 'client_admin').length },
    kpis,
    notAvailable: ['activeSubscriptions', 'trials', 'upcomingExpiries', 'softwareRevenue', 'whatsappAddonRevenue', 'overdueInvoices'],
    notAvailableReason: 'Subscriptions and billing (spec §5) are not built yet.',
    list: libs.map(l => {
      const owner = users.find(u => u.tenantId === l.libraryId && u.role === 'client_admin');
      return { libraryId: l.libraryId, name: l.name, status: l.status, city: l.city || null, createdAt: l.createdAt,
        owner: owner ? { name: owner.name, email: owner.email } : null, lastActiveAt: lastActive[l.libraryId] || null,
        subscription: null, expiry: null, paymentStatus: null, ...(extra[l.libraryId] || {}) };
    }),
  };
}

/** Aggregated customer analytics. No names/phones; per-library rows contain counts and sums only. */
export async function libraryInsights({ from, to, libraryId, city, planId } = {}) {
  let libs = await Library.find().lean();
  if (libraryId) libs = libs.filter(l => l.libraryId === libraryId);
  if (city) libs = libs.filter(l => (l.city || '').toLowerCase() === String(city).toLowerCase());
  const ids = libs.map(l => l.libraryId);
  const base = { tenantId: { $in: ids } };
  const dateRange = {};
  if (isDate(from)) dateRange.$gte = from;
  if (isDate(to)) dateRange.$lte = to;
  const dated = Object.keys(dateRange).length ? { date: dateRange } : {};
  const stuMatch = planId ? { ...base, planId: String(planId) } : base;
  const [students, seats, occupied, pays, exps, plans, growth, branchPays, planNames] = await Promise.all([
    models.students.aggregate([{ $match: stuMatch }, { $group: { _id: '$tenantId', total: { $sum: 1 }, active: { $sum: { $cond: [{ $in: ['$status', ACTIVE] }, 1, 0] } } } }]),
    models.seats.aggregate([{ $match: base }, { $group: { _id: '$tenantId', total: { $sum: 1 } } }]),
    models.students.aggregate([{ $match: { ...base, status: { $in: ACTIVE }, seatNo: { $nin: [null, '', 'Non-Fixed Seat'] } } },
      { $group: { _id: { t: '$tenantId', b: '$branchId', s: '$sectionId', n: '$seatNo' } } }, { $group: { _id: '$_id.t', n: { $sum: 1 } } }]),
    models.payments.aggregate([{ $match: { ...base, ...dated } }, { $group: { _id: '$tenantId', count: { $sum: 1 }, total: { $sum: num({ $ifNull: ['$netTotal', '$amount'] }) } } }]),
    models.expenses.aggregate([{ $match: { ...base, ...dated } }, { $group: { _id: '$tenantId', total: { $sum: num('$amount') } } }]),
    models.students.aggregate([{ $match: { ...base, planId: { $nin: [null, ''] } } }, { $group: { _id: { t: '$tenantId', p: '$planId', name: '$planName' }, n: { $sum: 1 } } }]),
    models.payments.aggregate([{ $match: { ...base, ...dated, date: { ...(dated.date || {}), $type: 'string' } } }, { $group: { _id: { $substrBytes: ['$date', 0, 7] }, collections: { $sum: num({ $ifNull: ['$netTotal', '$amount'] }) }, payments: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    models.payments.aggregate([{ $match: { ...base, ...dated } }, { $group: { _id: { t: '$tenantId', b: '$branchId' }, total: { $sum: num({ $ifNull: ['$netTotal', '$amount'] }) } } }]),
    models.plans.find(base).select('tenantId _key name').lean(),
  ]);
  const by = (arr) => Object.fromEntries(arr.map(r => [r._id, r]));
  const S = by(students), SE = by(seats), O = by(occupied), P = by(pays), E = by(exps);
  const perLibrary = libs.map(l => {
    const id = l.libraryId;
    const seatsTotal = SE[id]?.total || 0;
    const seatsOccupied = Math.min(O[id]?.n || 0, seatsTotal);
    const collections = Math.round(P[id]?.total || 0), expenses = Math.round(E[id]?.total || 0);
    return { libraryId: id, name: l.name, city: l.city || null, studentsTotal: S[id]?.total || 0, studentsActive: S[id]?.active || 0,
      seatsTotal, seatsOccupied, seatUtilization: seatsTotal ? Math.round((seatsOccupied / seatsTotal) * 100) : null,
      payments: P[id]?.count || 0, collections, expenses, net: collections - expenses };
  });
  const sum = (k) => perLibrary.reduce((a, r) => a + (r[k] || 0), 0);
  const seatsTotal = sum('seatsTotal'), seatsOccupied = sum('seatsOccupied');
  const pn = Object.fromEntries(planNames.map(p => [`${p.tenantId}:${p._key}`, p.name]));
  const popular = {};
  for (const r of plans) { const name = r._id.name || pn[`${r._id.t}:${r._id.p}`] || r._id.p; popular[name] = (popular[name] || 0) + r.n; }
  const cities = {};
  for (const r of perLibrary) { const c = r.city || 'Unknown'; (cities[c] ||= { city: c, libraries: 0, studentsActive: 0, collections: 0 }); cities[c].libraries++; cities[c].studentsActive += r.studentsActive; cities[c].collections += r.collections; }
  return {
    filters: { from: dateRange.$gte || null, to: dateRange.$lte || null, libraryId: libraryId || null, city: city || null, planId: planId || null },
    totals: { libraries: libs.length, studentsTotal: sum('studentsTotal'), studentsActive: sum('studentsActive'), seatsTotal, seatsOccupied,
      seatUtilization: seatsTotal ? Math.round((seatsOccupied / seatsTotal) * 100) : null, payments: sum('payments'),
      customerFeeCollections: sum('collections'), customerExpenses: sum('expenses'), customerNet: sum('collections') - sum('expenses') },
    trend: growth.map(g => ({ month: g._id, collections: Math.round(g.collections), payments: g.payments })),
    popularPlans: Object.entries(popular).map(([name, students]) => ({ name, students })).sort((a, b) => b.students - a.students).slice(0, 10),
    cities: Object.values(cities).sort((a, b) => b.studentsActive - a.studentsActive),
    branches: branchPays.map(b => ({ libraryId: b._id.t, branchId: b._id.b || null, collections: Math.round(b.total) })),
    perLibrary,
    privacy: 'Aggregated statistics only. No student names, phone numbers or documents are included. Access is logged.',
  };
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows, cols) => [cols.map(c => c.label).join(','), ...rows.map(r => cols.map(c => csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n');

export function createInsightsRouter() {
  const r = express.Router();
  const filters = (q) => ({ from: q.from, to: q.to, libraryId: q.libraryId ? String(q.libraryId) : undefined, city: q.city ? String(q.city) : undefined, planId: q.planId ? String(q.planId) : undefined });
  r.get('/saas-summary', wrap(async (_req, res) => res.json(await saasSummary())));
  r.get('/insights', wrap(async (req, res) => {
    const f = filters(req.query);
    await audit(req, 'insights.view', { tenantId: f.libraryId || null, target: 'library-insights', detail: f });
    res.json(await libraryInsights(f));
  }));
  r.get('/insights/export.csv', wrap(async (req, res) => {
    const f = filters(req.query);
    await audit(req, 'insights.export', { tenantId: f.libraryId || null, target: 'library-insights', detail: f });
    const d = await libraryInsights(f);
    const csv = toCsv(d.perLibrary, [
      { key: 'libraryId', label: 'Library ID' }, { key: 'name', label: 'Library' }, { key: 'city', label: 'City' },
      { key: 'studentsActive', label: 'Active students' }, { key: 'studentsTotal', label: 'Total students' },
      { key: 'seatsOccupied', label: 'Seats occupied' }, { key: 'seatsTotal', label: 'Seats' }, { key: 'seatUtilization', label: 'Utilization %' },
      { key: 'collections', label: 'Fee collections' }, { key: 'expenses', label: 'Expenses' }, { key: 'net', label: 'Net collections' }]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="library-insights-${todayIn()}.csv"`);
    res.send(csv);
  }));
  return r;
}

/**
 * Fees, payments, recurring expenses and P&L (spec §3.3, FEE-01).
 * All money is whole rupees. Rounding rule (used everywhere): compute the exact
 * value and round half-up to the nearest rupee once, at the end.
 */
import mongoose from 'mongoose';
import express from 'express';
import tenantGuard, { applyBulkWriteGuard } from './tenantGuard.js';
import { models } from './models.js';
import { normalizePaymentReferences, referenceError, trimReference } from '../../src/utils/paymentReference.js';

export const roundRupees = (v) => Math.round(Number(v) + Number.EPSILON);

/** Suggest Plan: base(1 month) × months × (1 − discount%) → ₹2,500 × 3 × 0.95 = ₹7,125. */
export function suggestPlanPrice(baseMonthly, months, discountPct = 0) {
  const b = Number(baseMonthly), m = Number(months), d = Number(discountPct || 0);
  if (!(b >= 0) || !(m > 0) || d < 0 || d > 100) throw Object.assign(new Error('Invalid plan pricing input'), { status: 400 });
  return roundRupees(b * m * (1 - d / 100));
}
export const derivePlanPrices = (baseMonthly, tiers = [{ months: 1, discountPct: 0 }]) =>
  tiers.map(t => ({ months: Number(t.months), discountPct: Number(t.discountPct || 0), price: suggestPlanPrice(baseMonthly, t.months, t.discountPct) }));

export class ValidationError extends Error { constructor(m) { super(m); this.status = 400; this.code = 'validation_failed'; } }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const shiftIso = (iso, n) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/**
 * Payment date window: not in the future, and not more than 60 days ago.
 * Returns '' when allowed. Same wording as the admission/renewal form.
 */
export function paidOnError(paidOn, today = todayIn()) {
  const v = String(paidOn || '').slice(0, 10);
  if (!ISO_DAY.test(v)) return 'Enter a valid payment date (YYYY-MM-DD).';
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'Enter a valid payment date (YYYY-MM-DD).';
  const day = String(today || todayIn()).slice(0, 10);
  if (v > day) return 'Payment date cannot be in the future.';
  if (v < shiftIso(day, -60)) return 'Payment date cannot be more than 60 days ago.';
  return '';
}

/** Keep `date` equal to paidOn. Fills enteredAt the first time a payment is recorded. */
export function applyPaidOn(record, { today = todayIn() } = {}) {
  if (!record || record.paidOn == null || record.paidOn === '') return record;
  const msg = paidOnError(record.paidOn, today);
  if (msg) throw new ValidationError(msg);
  record.paidOn = String(record.paidOn).slice(0, 10);
  record.date = record.paidOn;
  if (!record.enteredAt) record.enteredAt = new Date().toISOString();
  return record;
}

/**
 * Check paidOn only on history rows that were not already saved.
 * Older rows without paidOn, or with a date that has since aged past 60 days, still sync.
 */
export function normalizeStudentPaymentDates(student, previous, today = todayIn()) {
  if (!student) return student;
  const prevRenewals = new Set((previous?.renewalHistory || []).map(r => r?.renewalId).filter(Boolean));
  const prevPays = new Set((previous?.paymentHistory || []).map(p => p?.receiptNo || p?.id).filter(Boolean));
  for (const r of student.renewalHistory || []) {
    if (r?.renewalId && prevRenewals.has(r.renewalId)) continue;
    applyPaidOn(r, { today });
  }
  for (const p of student.paymentHistory || []) {
    const id = p?.receiptNo || p?.id;
    if (id && prevPays.has(id)) continue;
    applyPaidOn(p, { today });
    applyPaymentReference(p, { required: true });
  }
  return student;
}

/** Trim referenceNo. Required only for a new non-cash payment (and each non-cash split part). */
export function applyPaymentReference(p, { required = false } = {}) {
  try { normalizePaymentReferences(p, { required }); }
  catch (e) {
    if (e?.referenceError) throw new ValidationError(e.referenceError);
    throw e;
  }
  return p;
}

/** Server-side payment rules: no negatives, no overpayment, split rows sum exactly. */
export function validatePayment(p, { checkPaidOn = true, checkReference = false } = {}) {
  if (!p) return;
  if (checkPaidOn) applyPaidOn(p);
  const num = (v) => Number(v ?? 0);
  const isRefund = p.method === 'Refund' || num(p.netTotal) < 0;
  for (const f of ['amount', 'discount', 'fine', 'netTotal']) {
    if (p[f] !== undefined && p[f] !== null && !Number.isFinite(num(p[f]))) throw new ValidationError(`${f} must be a number`);
  }
  if (!isRefund) {
    if (num(p.discount) < 0 || num(p.fine) < 0) throw new ValidationError('Discount and fine cannot be negative');
    if (p.amount !== undefined && num(p.discount) > num(p.amount)) throw new ValidationError('Discount cannot exceed the fee');
  }
  if (p.method === 'Split' || (Array.isArray(p.breakdown) && p.breakdown.length)) {
    const rows = Array.isArray(p.breakdown) ? p.breakdown : [];
    if (!rows.length) throw new ValidationError('Split payment needs at least one method');
    let sum = 0;
    for (const r of rows) {
      const a = Number(r?.amount);
      if (!Number.isFinite(a) || a < 0) throw new ValidationError('Split amounts cannot be negative');
      if (!Number.isInteger(a)) throw new ValidationError('Split amounts must be whole rupees');
      if (!r.method) throw new ValidationError('Each split row needs a payment method');
      sum += a;
    }
    const total = Math.abs(num(p.netTotal));
    if (rows.some(r => Number(r.amount) > total)) throw new ValidationError('A split amount cannot exceed the total');
    if (sum !== total) throw new ValidationError(`Split amounts (₹${sum}) must add up exactly to the total (₹${total})`);
  }
  applyPaymentReference(p, { required: checkReference });
}

/** Validates only new/changed payments so legacy rows never block saving. */
export function validatePaymentBatch(items, previous = new Map()) {
  for (const p of items) {
    const prev = previous.get(String(p.receiptNo ?? p.id));
    const sameMoney = prev && ['amount', 'discount', 'fine', 'netTotal', 'method', 'paidOn', 'date'].every(k => prev[k] === p[k]) && JSON.stringify(prev.breakdown || null) === JSON.stringify(p.breakdown || null);
    if (sameMoney) continue;
    validatePayment(p, { checkPaidOn: !prev || prev.paidOn !== p.paidOn || !prev.paidOn, checkReference: !prev });
  }
}

/* ------------------------------------------------------------ recurring expenses */
const FREQ_MONTHS = { monthly: 1, every_2_months: 2, quarterly: 3, half_yearly: 6, yearly: 12 };

const recurringSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  category: { type: String, required: true },
  description: String,
  branchId: String,
  amount: { type: Number, required: true, min: 0 },
  frequency: { type: String, enum: [...Object.keys(FREQ_MONTHS), 'custom', 'interval'], required: true },
  intervalMonths: { type: Number, min: 1 },
  // Issue #8: clear schedule = firstDueDate + every N days/months/years. Old bills (no firstDueDate) keep dueDay rules.
  firstDueDate: String,
  intervalUnit: { type: String, enum: ['days', 'months', 'years'] },
  intervalCount: { type: Number, min: 1 },
  startDate: { type: String, required: true },
  dueDay: { type: Number, min: 1, max: 31 },
  endDate: String,
  reminder: { daysBefore: { type: Number, default: 3 }, onDue: { type: Boolean, default: true }, repeatEveryDays: { type: Number, default: 3 } },
  status: { type: String, enum: ['active', 'stopped'], default: 'active' },
  stoppedAt: Date,
  createdBy: String,
}, { timestamps: true });
recurringSchema.plugin(tenantGuard);
export const RecurringExpense = applyBulkWriteGuard(mongoose.models.RecurringExpense || mongoose.model('RecurringExpense', recurringSchema));

const instanceSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  templateId: { type: String, required: true },
  periodKey: { type: String, required: true },
  category: String, description: String, branchId: String,
  dueDate: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  payments: [{ amount: Number, date: String, mode: String, note: String, referenceNo: String, by: String, at: Date }],
  paidAmount: { type: Number, default: 0 },
  paymentDate: String,
  attachments: [{ name: String, storageKey: String }],
  history: [{ at: Date, by: String, action: String, detail: String }],
}, { timestamps: true });
// Idempotent generation: one bill per template per period even when jobs retry.
instanceSchema.index({ tenantId: 1, templateId: 1, periodKey: 1 }, { unique: true });
instanceSchema.plugin(tenantGuard);
export const ExpenseInstance = applyBulkWriteGuard(mongoose.models.ExpenseInstance || mongoose.model('ExpenseInstance', instanceSchema));

const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Today in the app timezone (default Asia/Kolkata) as YYYY-MM-DD. */
export const todayIn = (tz = process.env.APP_TIMEZONE || 'Asia/Kolkata', d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Issue #8: n-th due date from firstDueDate. Months/years keep the original day, clamped to short months / Feb 28. */
export function nthDueDate(firstDueDate, unit, count, n) {
  const [y0, m0, d0] = firstDueDate.split('-').map(Number);
  if (unit === 'days') return new Date(Date.UTC(y0, m0 - 1, d0) + n * count * 864e5).toISOString().slice(0, 10);
  const months = n * count * (unit === 'years' ? 12 : 1);
  const total = (m0 - 1) + months;
  const y = y0 + Math.floor(total / 12), m = (total % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(d0, daysInMonth(y, m)))}`;
}

export function dueDatesFor(t, until) {
  if (t.firstDueDate) {
    const unit = t.intervalUnit || 'months', count = Math.max(1, Number(t.intervalCount || 1));
    const out = [];
    for (let i = 0; i < 5000; i++) {
      const due = nthDueDate(t.firstDueDate, unit, count, i);
      if ((t.endDate && due > t.endDate) || due > until) break;
      out.push({ periodKey: due, dueDate: due });
    }
    return out;
  }
  const step = t.frequency === 'custom' ? Number(t.intervalMonths || 1) : FREQ_MONTHS[t.frequency];
  const [sy, sm, sd] = t.startDate.split('-').map(Number);
  const day = Number(t.dueDay || sd);
  const out = [];
  for (let i = 0; i < 600; i++) {
    const total = (sm - 1) + i * step;
    const y = sy + Math.floor(total / 12), m = (total % 12) + 1;
    const due = `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
    if (due < t.startDate) continue;
    if ((t.endDate && due > t.endDate) || due > until) break;
    out.push({ periodKey: `${y}-${pad(m)}`, dueDate: due });
  }
  return out;
}

export function instanceStatus(inst, today = todayIn()) {
  const paid = Number(inst.paidAmount || 0), amt = Number(inst.amount || 0);
  if (paid >= amt) return 'paid';
  if (inst.dueDate < today) return 'overdue';
  return paid > 0 ? 'part_paid' : 'unpaid';
}

export async function generateInstances(tenantId, { today = todayIn(), lookaheadDays = 31 } = {}) {
  const until = new Date(Date.parse(today + 'T00:00:00Z') + lookaheadDays * 864e5).toISOString().slice(0, 10);
  const templates = await RecurringExpense.find({ tenantId, status: 'active' }).lean();
  let created = 0;
  for (const t of templates) {
    for (const { periodKey, dueDate } of dueDatesFor(t, until)) {
      try {
        const r = await ExpenseInstance.updateOne(
          { tenantId, templateId: String(t._id), periodKey },
          { $setOnInsert: { dueDate, amount: t.amount, category: t.category, description: t.description, branchId: t.branchId, paidAmount: 0, history: [{ at: new Date(), by: 'system', action: 'generated' }] } },
          { upsert: true });
        created += r.upsertedCount || 0;
      } catch (e) { if (e?.code !== 11000) throw e; }
    }
  }
  return created;
}

/** Unpaid bills needing a reminder today: before / on / repeatedly after due. */
export async function dueReminders(tenantId, today = todayIn()) {
  const templates = new Map((await RecurringExpense.find({ tenantId }).lean()).map(t => [String(t._id), t]));
  const out = [];
  for (const i of await ExpenseInstance.find({ tenantId }).lean()) {
    if (instanceStatus(i, today) === 'paid') continue;
    const rem = templates.get(i.templateId)?.reminder || { daysBefore: 3, onDue: true, repeatEveryDays: 3 };
    const diff = Math.round((Date.parse(i.dueDate) - Date.parse(today)) / 864e5);
    let kind = null;
    if (diff > 0 && diff === Number(rem.daysBefore)) kind = 'before';
    else if (diff === 0 && rem.onDue !== false) kind = 'due';
    else if (diff < 0 && rem.repeatEveryDays > 0 && (-diff) % rem.repeatEveryDays === 0) kind = 'overdue';
    if (kind) out.push({ instance: i, kind, daysFromDue: diff });
  }
  return out;
}

const pubInstance = (i, today) => ({ id: String(i._id), templateId: i.templateId, periodKey: i.periodKey, category: i.category, description: i.description, branchId: i.branchId, dueDate: i.dueDate, amount: i.amount, paidAmount: i.paidAmount || 0, paymentDate: i.paymentDate, payments: i.payments || [], attachments: i.attachments || [], history: i.history || [], status: instanceStatus(i, today) });
const pubTemplate = (t) => ({ id: String(t._id), category: t.category, description: t.description, branchId: t.branchId, amount: t.amount, frequency: t.frequency, intervalMonths: t.intervalMonths, firstDueDate: t.firstDueDate, intervalUnit: t.intervalUnit, intervalCount: t.intervalCount, startDate: t.startDate, dueDay: t.dueDay, endDate: t.endDate, reminder: t.reminder, status: t.status });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function templateInput(b, partial = false) {
  const o = {};
  for (const k of ['category', 'description', 'branchId', 'frequency', 'startDate', 'endDate', 'firstDueDate', 'intervalUnit']) if (b[k] !== undefined && b[k] !== '') o[k] = String(b[k]);
  for (const k of ['amount', 'intervalMonths', 'dueDay', 'intervalCount']) if (b[k] !== undefined && b[k] !== '' && b[k] !== null) o[k] = Number(b[k]);
  if (o.firstDueDate) {
    if (!DATE.test(o.firstDueDate)) throw new ValidationError('firstDueDate must be YYYY-MM-DD');
    o.frequency = 'interval';
    o.intervalUnit = o.intervalUnit || 'months';
    if (!['days', 'months', 'years'].includes(o.intervalUnit)) throw new ValidationError('Repeat unit must be days, months or years');
    if (!(Number.isInteger(o.intervalCount) && o.intervalCount >= 1)) throw new ValidationError('Repeat every must be a whole number of at least 1');
    if (!o.startDate) o.startDate = o.firstDueDate;
  }
  if (b.reminder) o.reminder = { daysBefore: Number(b.reminder.daysBefore ?? 3), onDue: b.reminder.onDue !== false, repeatEveryDays: Number(b.reminder.repeatEveryDays ?? 3) };
  if (!partial) {
    if (!o.category) throw new ValidationError('Category is required');
    if (o.amount === undefined) throw new ValidationError('Amount is required');
    if (!o.frequency) throw new ValidationError('Frequency is required');
    if (!o.startDate) throw new ValidationError('Start date is required');
  }
  if (o.amount !== undefined && !(o.amount >= 0)) throw new ValidationError('Amount must be 0 or more');
  if (o.frequency && o.frequency !== 'custom' && o.frequency !== 'interval' && !FREQ_MONTHS[o.frequency]) throw new ValidationError('Unknown frequency');
  if (o.frequency === 'custom' && !(o.intervalMonths >= 1)) throw new ValidationError('Custom frequency needs an interval of at least 1 month');
  for (const k of ['startDate', 'endDate']) if (o[k] && !DATE.test(o[k])) throw new ValidationError(`${k} must be YYYY-MM-DD`);
  if (o.frequency === 'interval' && !o.firstDueDate && !partial) throw new ValidationError('First due date is required');
  if (o.endDate && o.firstDueDate && o.endDate < o.firstDueDate) throw new ValidationError('End date must be after the first due date');
  if (o.endDate && o.startDate && o.endDate < o.startDate) throw new ValidationError('End date must be after start date');
  return o;
}

/* ------------------------------------------------------------------ P&L */
export async function computePnl(tenantId, { from, to, branchId } = {}) {
  const inRange = (d) => (!from || (d || '') >= from) && (!to || (d || '') <= to);
  const inBranch = (b) => !branchId || branchId === 'all' || b === branchId;
  const payments = (await models.payments.find({ tenantId }).lean()).filter(p => inRange(p.date) && inBranch(p.branchId));
  const expenses = (await models.expenses.find({ tenantId }).lean()).filter(e => inRange(e.date) && inBranch(e.branchId));
  const instances = (await ExpenseInstance.find({ tenantId }).lean()).filter(i => inBranch(i.branchId));
  let feeCollections = 0, refunds = 0; const byMethod = {};
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  for (const p of payments) {
    if (p.voided === true || p.status === 'Voided') continue; // Issue #11: voided receipts stay visible but out of totals
    const n = Number(p.netTotal ?? p.amount ?? 0);
    if (n < 0 || p.method === 'Refund') { refunds += Math.abs(n); continue; }
    feeCollections += n;
    if (p.method === 'Split' && Array.isArray(p.breakdown)) p.breakdown.forEach(b => add(byMethod, b.method || 'Other', Number(b.amount || 0)));
    else add(byMethod, p.method || 'Other', n);
  }
  const byCategory = {}; let oneTime = 0;
  for (const e of expenses) { const a = Number(e.amount || 0); oneTime += a; add(byCategory, e.category || 'Other', a); }
  let recurringPaid = 0, recurringOutstanding = 0;
  for (const i of instances) {
    for (const pay of i.payments || []) if (inRange(pay.date)) { recurringPaid += Number(pay.amount || 0); add(byCategory, i.category || 'Other', Number(pay.amount || 0)); }
    if (inRange(i.dueDate)) recurringOutstanding += Math.max(0, Number(i.amount || 0) - Number(i.paidAmount || 0));
  }
  const students = await models.students.find({ tenantId }).lean();
  const studentDues = students.filter(s => inBranch(s.branchId) && s.status !== 'Archived').reduce((a, s) => a + Math.max(0, Number(s.dueAmount ?? s.balanceDue ?? 0)), 0);
  const total = oneTime + recurringPaid, netFees = feeCollections - refunds;
  return {
    scope: 'library', // the customer library's own income — never our software-company revenue
    period: { from: from || null, to: to || null, branchId: branchId || 'all' },
    feeCollections, refunds, netFees,
    expenses: { oneTime, recurringPaid, total, byCategory },
    recurringOutstanding, studentDues,
    netCollections: netFees - total,
    byMethod,
  };
}

const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';

/* ------------------------------------------------------------------ routes */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const byId = (req) => (mongoose.isValidObjectId(req.params.id) ? { tenantId: req.tenantId, _id: req.params.id } : null);

export function createFinanceRouter() {
  const r = express.Router();
  r.get('/fees/suggest', (req, res, next) => {
    try {
      const tiers = String(req.query.tiers || '1:0').split(',').map(x => { const [months, discountPct] = x.split(':'); return { months, discountPct }; });
      res.json({ rounding: 'half-up to the nearest rupee, applied once to the final price', prices: derivePlanPrices(req.query.base, tiers) });
    } catch (e) { next(e); }
  });

  r.get('/recurring-expenses', wrap(async (req, res) => {
    res.json((await RecurringExpense.find({ tenantId: req.tenantId }).sort({ createdAt: -1 }).lean()).map(pubTemplate));
  }));
  r.post('/recurring-expenses', wrap(async (req, res) => {
    const t = await RecurringExpense.create({ ...templateInput(req.body || {}), tenantId: req.tenantId, createdBy: req.user.email });
    await generateInstances(req.tenantId);
    res.status(201).json(pubTemplate(t));
  }));
  r.put('/recurring-expenses/:id', wrap(async (req, res) => {
    const f = byId(req); if (!f) return res.status(404).json({ error: 'Not found' });
    const t = await RecurringExpense.findOneAndUpdate(f, { $set: templateInput(req.body || {}, true) }, { new: true, lean: true });
    if (!t) return res.status(404).json({ error: 'Not found' });
    await generateInstances(req.tenantId);
    res.json(pubTemplate(t));
  }));
  r.post('/recurring-expenses/:id/stop', wrap(async (req, res) => {
    const f = byId(req); if (!f) return res.status(404).json({ error: 'Not found' });
    const t = await RecurringExpense.findOneAndUpdate(f, { $set: { status: 'stopped', stoppedAt: new Date() } }, { new: true, lean: true });
    t ? res.json(pubTemplate(t)) : res.status(404).json({ error: 'Not found' });
  }));
  r.post('/recurring-expenses/generate', wrap(async (req, res) => res.json({ created: await generateInstances(req.tenantId) })));

  r.get('/expense-instances', wrap(async (req, res) => {
    const q = { tenantId: req.tenantId };
    if (req.query.templateId) q.templateId = String(req.query.templateId);
    const today = todayIn();
    let list = (await ExpenseInstance.find(q).sort({ dueDate: -1 }).lean()).map(i => pubInstance(i, today));
    if (req.query.status) list = list.filter(i => i.status === req.query.status);
    if (req.query.branchId && req.query.branchId !== 'all') list = list.filter(i => i.branchId === req.query.branchId);
    res.json(list);
  }));
  r.get('/expense-instances/:id', wrap(async (req, res) => {
    const f = byId(req); const i = f && await ExpenseInstance.findOne(f).lean();
    i ? res.json(pubInstance(i)) : res.status(404).json({ error: 'Not found' });
  }));
  r.patch('/expense-instances/:id', wrap(async (req, res) => {
    const f = byId(req); if (!f) return res.status(404).json({ error: 'Not found' });
    const set = {};
    if (req.body?.amount !== undefined) { const a = Number(req.body.amount); if (!(a >= 0)) throw new ValidationError('Amount must be 0 or more'); set.amount = roundRupees(a); }
    if (req.body?.description !== undefined) set.description = String(req.body.description);
    if (req.body?.dueDate !== undefined) { if (!DATE.test(req.body.dueDate)) throw new ValidationError('dueDate must be YYYY-MM-DD'); set.dueDate = req.body.dueDate; }
    if (Array.isArray(req.body?.attachments)) set.attachments = req.body.attachments.map(a => ({ name: String(a.name || ''), storageKey: String(a.storageKey || '') }));
    const i = await ExpenseInstance.findOneAndUpdate(f, { $set: set, $push: { history: { at: new Date(), by: req.user.email, action: 'edited', detail: Object.keys(set).join(', ') } } }, { new: true, lean: true });
    i ? res.json(pubInstance(i)) : res.status(404).json({ error: 'Not found' });
  }));
  r.post('/expense-instances/:id/payments', wrap(async (req, res) => {
    const f = byId(req); if (!f) return res.status(404).json({ error: 'Not found' });
    const amount = Number(req.body?.amount);
    if (!(amount > 0) || !Number.isInteger(amount)) throw new ValidationError('Payment must be a positive whole amount');
    const date = req.body?.date || todayIn();
    if (!DATE.test(date)) throw new ValidationError('date must be YYYY-MM-DD');
    const mode = req.body?.mode || 'Cash';
    const referenceNo = trimReference(req.body?.referenceNo);
    // Expense payments (money going out): the reference is optional, only trimmed and length-checked.
    const refErr = referenceError(mode, referenceNo, { required: false });
    if (refErr) throw new ValidationError(refErr);
    const cur = await ExpenseInstance.findOne(f).lean();
    if (!cur) return res.status(404).json({ error: 'Not found' });
    if ((cur.paidAmount || 0) + amount > cur.amount) throw new ValidationError(`Payment exceeds the remaining ₹${cur.amount - (cur.paidAmount || 0)}`);
    const i = await ExpenseInstance.findOneAndUpdate({ ...f, paidAmount: cur.paidAmount || 0 },
      { $inc: { paidAmount: amount }, $set: { paymentDate: date }, $push: { payments: { amount, date, mode, note: req.body?.note || '', ...(referenceNo ? { referenceNo } : {}), by: req.user.email, at: new Date() }, history: { at: new Date(), by: req.user.email, action: 'payment', detail: `₹${amount}` } } },
      { new: true, lean: true });
    if (!i) return res.status(409).json({ error: 'This bill was updated by someone else. Refresh and try again.' });
    res.json(pubInstance(i));
  }));

  const pnlQuery = (req) => ({ from: req.query.from, to: req.query.to, branchId: req.query.branchId });
  r.get('/reports/pnl', wrap(async (req, res) => res.json(await computePnl(req.tenantId, pnlQuery(req)))));
  r.get('/reports/pnl.csv', wrap(async (req, res) => {
    const p = await computePnl(req.tenantId, pnlQuery(req));
    const rows = [['Line', 'Amount (INR)'], ['Fee collections', p.feeCollections], ['Refunds', -p.refunds], ['Net fees', p.netFees],
      ['One-time expenses', -p.expenses.oneTime], ['Recurring bills paid', -p.expenses.recurringPaid], ['Net collections', p.netCollections],
      ['Recurring bills outstanding', p.recurringOutstanding], ['Student dues', p.studentDues], [], ['Expense category', 'Amount (INR)'],
      ...Object.entries(p.expenses.byCategory), [], ['Payment method', 'Amount (INR)'], ...Object.entries(p.byMethod)];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pnl-${p.period.from || 'all'}-${p.period.to || 'all'}.csv"`);
    res.send(toCsv(rows));
  }));
  return r;
}

/** Daily job: generate bills for every active library (idempotent). */
export async function runDailyFinanceJob(Library) {
  for (const l of await Library.find({ status: 'Active' }).lean()) {
    try { await generateInstances(l.libraryId); } catch (e) { console.error('[finance] generation failed for', l.libraryId, e.message); }
  }
}

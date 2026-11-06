// Issue #9: who may edit payment amounts. Admin always; Manager on by default; other staff off.
// The owner changes Manager/Staff in Settings (managerCanEditAmount / staffCanEditAmount).
// Enforced here, audited. Client amountEdited / suggestedAmount flags are NOT trusted for
// the permission decision — the server recomputes the plan price when planId is present.
import { models, Settings } from './models.js';
import { audit } from './audit.js';
import { expectedPayment, differsFromExpected } from './planPrice.js';

const MONEY = ['amount', 'discount', 'fine', 'netTotal'];
const AMOUNT_SETTINGS = ['managerCanEditAmount', 'staffCanEditAmount'];
const n = (v) => Number(v ?? 0);

export const isOwnerRole = (user) => user?.role === 'client_admin' || user?.role === 'superadmin';

/** Pure rule: staff role + library settings -> allowed? */
export function roleCanEditAmount(staffRole, settings = {}) {
  if (staffRole === 'Admin') return true;
  if (staffRole === 'Manager') return settings.managerCanEditAmount !== false;
  return settings.staffCanEditAmount === true;
}

export async function canEditAmount(req) {
  if (isOwnerRole(req.user)) return true;
  if (req.user?.role !== 'staff') return false;
  const staff = req.user.staffId ? await models.staffMembers.findOne({ tenantId: req.tenantId, _key: String(req.user.staffId) }).lean() : null;
  if (!staff || (staff.status && staff.status !== 'Active')) return false;
  const settings = (await Settings.findOne({ tenantId: req.tenantId }).lean()) || {};
  return roleCanEditAmount(staff.role, settings);
}

/**
 * Detect amount edits without trusting client flags.
 * - Existing receipts: any change to money fields / breakdown.
 * - New payments with a server-computable plan price: differ from expected.
 * - New payments with suggestedAmount only: differ from suggestedAmount (or any discount/fine).
 * - New payments with neither planId nor suggestedAmount: any discount, or amountEdited-style
 *   customisation is an edit; a plain payment with no plan context is allowed (manual fee
 *   entry by permitted roles still goes through canEditAmount only when money looks custom).
 *
 * `expectedByKey` is an optional Map<receiptKey, expectedAmounts> precomputed by enforceAmountEdits.
 */
export function amountEdits(items, previous = new Map(), expectedByKey = new Map()) {
  const out = [];
  for (const p of items) {
    const key = String(p.receiptNo ?? p.id);
    const prev = previous.get(key);
    if (prev) {
      const changed = MONEY.filter(k => n(prev[k]) !== n(p[k]));
      const bd = JSON.stringify((prev.breakdown || []).map(b => Number(b.amount))) !== JSON.stringify((p.breakdown || []).map(b => Number(b.amount)));
      if (changed.length || bd) {
        out.push({ receiptNo: key, kind: 'edit', from: Object.fromEntries(MONEY.map(k => [k, prev[k] ?? null])), to: Object.fromEntries(MONEY.map(k => [k, p[k] ?? null])) });
      }
      continue;
    }

    const expected = expectedByKey.get(key);
    if (expected) {
      if (differsFromExpected(p, expected)) {
        out.push({
          receiptNo: key,
          kind: 'new',
          from: { amount: expected.amount, discount: expected.discount, fine: expected.fine, netTotal: expected.netTotal },
          to: Object.fromEntries(MONEY.map(k => [k, p[k] ?? null])),
          source: expected.source,
        });
      }
      continue;
    }

    // No server price available. Without a matching suggestedAmount the payment is treated
    // as a custom amount (owners/admins who can edit still pass enforceAmountEdits).
    // Client amountEdited is ignored for the decision — only the numbers matter.
    const suggested = p.suggestedAmount != null ? n(p.suggestedAmount) : null;
    const matchesSuggested = suggested != null
      && n(p.amount) === suggested
      && n(p.discount) === 0
      && n(p.netTotal) === Math.max(0, suggested + n(p.fine));
    // Relocate / credit rows may send suggestedAmount equal to netTotal (possibly negative).
    const matchesSuggestedLoose = suggested != null
      && n(p.amount) === suggested
      && n(p.netTotal) === suggested + n(p.fine) - n(p.discount);
    if (!(matchesSuggested || matchesSuggestedLoose)) {
      out.push({
        receiptNo: key,
        kind: 'new',
        from: suggested != null ? { amount: suggested } : null,
        to: Object.fromEntries(MONEY.map(k => [k, p[k] ?? null])),
      });
    }
  }
  return out;
}

export class AmountEditError extends Error {
  constructor() { super('You do not have permission to change payment amounts. Ask the owner.'); this.status = 403; this.code = 'amount_edit_forbidden'; }
}

/** Load plans referenced by new payments and build expected amounts. */
async function expectedMap(req, items, previous) {
  const settings = (await Settings.findOne({ tenantId: req.tenantId }).lean()) || {};
  const planIds = [...new Set(items
    .filter(p => !previous.has(String(p.receiptNo ?? p.id)) && p.planId)
    .map(p => String(p.planId)))];
  const plans = planIds.length
    ? await models.plans.find({ tenantId: req.tenantId, _key: { $in: planIds } }).lean()
    : [];
  const byId = new Map(plans.map(p => [String(p._key || p.id), p]));
  const map = new Map();
  for (const p of items) {
    const key = String(p.receiptNo ?? p.id);
    if (previous.has(key)) continue;
    const plan = p.planId ? byId.get(String(p.planId)) : null;
    // Relocate charges carry oldFee/newFee and need no plan.
    const expected = expectedPayment(p, { plan, settings });
    if (expected) map.set(key, expected);
  }
  return map;
}

/** Throw 403 if not allowed; audit every allowed edit. */
export async function enforceAmountEdits(req, items, previous = new Map()) {
  const expectedByKey = await expectedMap(req, items, previous);
  const edits = amountEdits(items, previous, expectedByKey);
  if (!edits.length) return;
  if (!(await canEditAmount(req))) {
    await audit(req, 'payment.amount_edit_denied', { tenantId: req.tenantId, target: edits.map(e => e.receiptNo).join(','), detail: { count: edits.length } });
    throw new AmountEditError();
  }
  for (const e of edits) await audit(req, 'payment.amount_edit', { tenantId: req.tenantId, target: e.receiptNo, detail: { kind: e.kind, from: e.from, to: e.to, source: e.source || null } });
}

/** Only the owner may change who can edit amounts. */
export function amountSettingsChanged(prev = {}, next = {}) {
  return AMOUNT_SETTINGS.some(k => (prev?.[k] ?? null) !== (next?.[k] ?? null));
}

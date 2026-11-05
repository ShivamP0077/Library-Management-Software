// Issue #9: who may edit payment amounts. Admin always; Manager on by default; other staff off.
// The owner changes Manager/Staff in Settings (managerCanEditAmount / staffCanEditAmount). Enforced here, audited.
import { models, Settings } from './models.js';
import { audit } from './audit.js';

const MONEY = ['amount', 'discount', 'fine', 'netTotal'];
const AMOUNT_SETTINGS = ['managerCanEditAmount', 'staffCanEditAmount'];

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

/** Amount edits in a batch: changed money fields on existing receipts, or new payments flagged amountEdited. */
export function amountEdits(items, previous = new Map()) {
  const out = [];
  for (const p of items) {
    const key = String(p.receiptNo ?? p.id);
    const prev = previous.get(key);
    if (prev) {
      const changed = MONEY.filter(k => Number(prev[k] ?? 0) !== Number(p[k] ?? 0));
      const bd = JSON.stringify((prev.breakdown || []).map(b => Number(b.amount))) !== JSON.stringify((p.breakdown || []).map(b => Number(b.amount)));
      if (changed.length || bd) out.push({ receiptNo: key, kind: 'edit', from: Object.fromEntries(MONEY.map(k => [k, prev[k] ?? null])), to: Object.fromEntries(MONEY.map(k => [k, p[k] ?? null])) });
    } else if (p.amountEdited === true) {
      out.push({ receiptNo: key, kind: 'new', from: p.suggestedAmount != null ? { amount: p.suggestedAmount } : null, to: Object.fromEntries(MONEY.map(k => [k, p[k] ?? null])) });
    }
  }
  return out;
}

export class AmountEditError extends Error {
  constructor() { super('You do not have permission to change payment amounts. Ask the owner.'); this.status = 403; this.code = 'amount_edit_forbidden'; }
}

/** Throw 403 if not allowed; audit every allowed edit. */
export async function enforceAmountEdits(req, items, previous) {
  const edits = amountEdits(items, previous);
  if (!edits.length) return;
  if (!(await canEditAmount(req))) {
    await audit(req, 'payment.amount_edit_denied', { tenantId: req.tenantId, target: edits.map(e => e.receiptNo).join(','), detail: { count: edits.length } });
    throw new AmountEditError();
  }
  for (const e of edits) await audit(req, 'payment.amount_edit', { tenantId: req.tenantId, target: e.receiptNo, detail: { kind: e.kind, from: e.from, to: e.to } });
}

/** Only the owner may change who can edit amounts. */
export function amountSettingsChanged(prev = {}, next = {}) {
  return AMOUNT_SETTINGS.some(k => (prev?.[k] ?? null) !== (next?.[k] ?? null));
}

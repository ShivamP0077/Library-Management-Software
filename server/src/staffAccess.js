// Staff financial permissions. Owner and Super Admin are not limited by the matrix.
// Missing action keys are false. A Librarian never receives Wallet, even if the
// saved object says allow-all or wallet = true.
import { models } from './models.js';
import { isOwnerRole } from './amountPermission.js';
import { sanitizeStaffPermissions, staffAllows, canSeeNetProfit, getDefaultPermissionsForRole } from '../../src/utils/staffPermissions.js';

export { staffAllows, canSeeNetProfit, sanitizeStaffPermissions };

function deny(message, code = 'forbidden') {
  const err = new Error(message);
  err.status = 403;
  err.code = code;
  return err;
}

export async function staffContext(req) {
  if (req._staffCtx) return req._staffCtx;
  if (isOwnerRole(req.user)) {
    req._staffCtx = { unrestricted: true, role: req.user.role, permissions: null };
    return req._staffCtx;
  }
  if (req.user?.role !== 'staff') {
    req._staffCtx = { unrestricted: false, missing: true, role: req.user?.role, permissions: null };
    return req._staffCtx;
  }
  const staff = req.user.staffId
    ? await models.staffMembers.findOne({ tenantId: req.tenantId, _key: String(req.user.staffId) }).lean()
    : null;
  const role = staff?.role || null;
  const stored = staff?.permissions;
  const base = stored?.students || stored?.payments ? stored : { ...getDefaultPermissionsForRole(role), ...(stored || {}) };
  const permissions = sanitizeStaffPermissions(base, role);
  req._staffCtx = {
    staff,
    role,
    permissions,
    unrestricted: role === 'Admin',
    inactive: Boolean(staff && staff.status && staff.status !== 'Active'),
  };
  return req._staffCtx;
}

export async function assertModule(req, moduleName, actionName) {
  const ctx = await staffContext(req);
  if (ctx.unrestricted) return ctx;
  if (!ctx.staff || ctx.inactive) throw deny('You do not have permission for this.');
  if (!staffAllows(ctx.permissions, ctx.role, moduleName, actionName)) {
    throw deny('You do not have permission for this.');
  }
  return ctx;
}

export function redactPnl(pnl, ctx) {
  if (!pnl || ctx?.unrestricted) return pnl;
  if (canSeeNetProfit(ctx.permissions, ctx.role)) return pnl;
  const copy = { ...pnl };
  delete copy.netCollections;
  return copy;
}

const MONEY_FIELDS = ['amount', 'discount', 'fine', 'netTotal', 'method', 'date', 'paidOn', 'referenceNo', 'status', 'voided', 'category', 'description'];
const moneySig = (p) => JSON.stringify(MONEY_FIELDS.map(k => p?.[k] ?? null));

/** Bulk payment/expense sync: new rows, edits, and removals need the matching action. */
export async function assertMoneySync(req, moduleName, previous, incoming) {
  const prev = new Map((previous || []).map(d => [String(d._key), d]));
  const seen = new Set();
  let needCreate = false;
  let needEdit = false;
  for (const row of incoming) {
    const key = String(row._key || row.id || row.receiptNo || '');
    if (!key) continue;
    seen.add(key);
    const old = prev.get(key);
    if (!old) needCreate = true;
    else if (moneySig(row) !== moneySig({ ...old, _id: undefined })) needEdit = true;
  }
  const needDelete = [...prev.keys()].some(k => !seen.has(k));
  if (needCreate) await assertModule(req, moduleName, 'collect');
  if (needEdit) await assertModule(req, moduleName, 'edit');
  if (needDelete) await assertModule(req, moduleName, 'delete');
  if (!needCreate && !needEdit && !needDelete) await assertModule(req, moduleName, 'view');
}

function moduleSig(perms) {
  if (!perms || typeof perms !== 'object') return '';
  const mods = {};
  for (const [k, v] of Object.entries(perms)) {
    if (v && typeof v === 'object') mods[k] = v;
  }
  return JSON.stringify({ mods, allowAllFinancial: perms.allowAllFinancial === true });
}

/**
 * Staff may save the staff list when roles and permission objects are unchanged.
 * Changing your own permissions is refused. Changing anyone's permissions needs Staff edit.
 * Librarian wallet flags are removed even when the owner saves.
 */
export async function prepareStaffWrite(req, incoming, { partial = false } = {}) {
  const ctx = await staffContext(req);
  const rows = (incoming || []).map(b => (
    b.permissions === undefined ? b : { ...b, permissions: sanitizeStaffPermissions(b.permissions, b.role) }
  ));
  if (ctx.unrestricted) return rows;
  const prevDocs = await models.staffMembers.find({ tenantId: req.tenantId }).lean();
  const prevBy = new Map(prevDocs.map(d => [String(d._key), d]));
  const incomingIds = new Set(rows.map(b => String(b.id || b._key || '')));
  let needsEdit = false;
  for (const b of rows) {
    const id = String(b.id || b._key || '');
    const prev = prevBy.get(id);
    const changed = !prev
      || (b.role !== undefined && b.role !== prev.role)
      || (b.permissions !== undefined && moduleSig(b.permissions) !== moduleSig(prev.permissions));
    if (!changed) continue;
    if (ctx.staff && id && id === String(req.user.staffId)) {
      throw deny('You cannot change your own permissions.', 'self_grant');
    }
    needsEdit = true;
  }
  if (!partial && prevDocs.some(d => !incomingIds.has(String(d._key)))) needsEdit = true;
  if (needsEdit) await assertModule(req, 'staff', 'edit');
  return rows;
}

// Central Staff Role & Granular Permission Definitions

export const STAFF_MODULES = [
  { id: 'students', name: 'Students Directory', label: 'Students Directory', desc: 'View and manage student records and history' },
  { id: 'admissions', name: 'New Admissions', label: 'New Admissions', desc: 'Process and authorize new student admissions' },
  { id: 'renewals', name: 'Renewals & Upgrades', label: 'Renewals & Upgrades', desc: 'Extend memberships and change student plans' },
  { id: 'seats', name: 'Seat Map & Allocation', label: 'Seat Map & Allocation', desc: 'Manage physical desks, allocations, and maintenance' },
  { id: 'waitingList', name: 'Waiting List', label: 'Waiting List', desc: 'Manage waitlist entries, priorities, and seat offers' },
  { id: 'payments', name: 'Payments & Receipts', label: 'Payments & Receipts', desc: 'Fee collections, receipts, and refund issuance' },
  { id: 'feePlans', name: 'Fee Plans & Pricing', label: 'Fee Plans & Pricing', desc: 'Configure pricing tiers, shifts, and plan durations' },
  { id: 'expenses', name: 'Expense Management', label: 'Expense Management', desc: 'Record and track operational library expenses' },
  { id: 'reports', name: 'Reports & P&L', label: 'Reports & P&L', desc: 'Financial insights, collection summaries, and P&L' },
  { id: 'documents', name: 'Document Settings', label: 'Document Settings', desc: 'ID proof rules, upload policies, and verification' },
  { id: 'settings', name: 'Library Settings', label: 'Library Settings', desc: 'Operating branches, shifts, and general system configuration' },
  { id: 'staff', name: 'Staff & Roles', label: 'Staff & Roles', desc: 'Staff directory, role assignments, and permission matrix' },
  { id: 'wallet', name: 'Wallet', label: 'Wallet', desc: 'Software wallet balance and eligible wallet actions' }
];

/** Financial modules the owner can grant. Wallet is never eligible for a Librarian. */
export const FINANCIAL_MODULE_IDS = ['payments', 'expenses', 'reports', 'wallet'];

/** Labels on the financial matrix. Keys are stored on the existing module object. */
export const FINANCIAL_MATRIX = [
  { id: 'view', label: 'View', keys: ['view'] },
  { id: 'collect', label: 'Add/Collect', keys: ['create', 'collect'] },
  { id: 'edit', label: 'Edit', keys: ['edit'] },
  { id: 'delete', label: 'Reverse/Delete', keys: ['delete'] },
  { id: 'print', label: 'Print', keys: ['print'] },
  { id: 'share', label: 'Share', keys: ['share'] },
  { id: 'export', label: 'Export', keys: ['export'] },
];

const FINANCIAL_KEYS = ['view', 'create', 'edit', 'delete', 'print', 'share', 'export', 'collect'];

export const STAFF_ACTIONS = [
  { id: 'view', name: 'View', label: 'View', desc: 'Can view records and lists' },
  { id: 'create', name: 'Create', label: 'Create', desc: 'Can add new records' },
  { id: 'edit', name: 'Edit', label: 'Edit', desc: 'Can modify existing records' },
  { id: 'delete', name: 'Delete', label: 'Delete', desc: 'Can delete or cancel records' },
  { id: 'approve', name: 'Approve', label: 'Approve', desc: 'Can authorize refunds and special requests' },
  { id: 'manage', name: 'Manage (All)', label: 'Manage (All)', desc: 'Full administrative control over this module' }
];

export const STAFF_ROLES = [
  { id: 'Admin', name: 'Admin / Owner', label: 'Admin / Owner', badgeColor: '#ef4444', desc: 'Unrestricted full access across all modules' },
  { id: 'Manager', name: 'Branch Manager', label: 'Branch Manager', badgeColor: '#8b5cf6', desc: 'High-level operational management and approvals' },
  { id: 'Librarian', name: 'Librarian', label: 'Librarian / Receptionist', badgeColor: '#3b82f6', desc: 'Front-desk admissions, seat allocations, and fees' },
  { id: 'Accountant', name: 'Accountant', label: 'Accountant', badgeColor: '#10b981', desc: 'Financial transactions, receipts, expenses, and reports' },
  { id: 'Custom', name: 'Custom Access', label: 'Custom Access', badgeColor: '#f59e0b', desc: 'Customized granular permission configuration' }
];

// Helper to create empty permissions object
export const createEmptyPermissions = () => {
  const perms = {};
  STAFF_MODULES.forEach(mod => {
    perms[mod.id] = {
      view: false,
      create: false,
      edit: false,
      delete: false,
      approve: false,
      manage: false
    };
  });
  return perms;
};

// Helper to get default permissions by role
export const getDefaultPermissionsForRole = (role) => {
  const perms = createEmptyPermissions();

  if (role === 'Admin') {
    STAFF_MODULES.forEach(mod => {
      perms[mod.id] = {
        view: true,
        create: true,
        edit: true,
        delete: true,
        approve: true,
        manage: true
      };
    });
  } else if (role === 'Manager') {
    // Manager has operational and approval access
    perms.students = { view: true, create: true, edit: true, delete: false, approve: false, manage: false };
    perms.admissions = { view: true, create: true, edit: true, delete: false, approve: true, manage: false };
    perms.renewals = { view: true, create: true, edit: true, delete: false, approve: true, manage: false };
    perms.seats = { view: true, create: false, edit: true, delete: false, approve: false, manage: false };
    perms.waitingList = { view: true, create: true, edit: true, delete: false, approve: true, manage: false };
    perms.payments = { view: true, create: true, edit: true, delete: false, approve: true, manage: false };
    perms.feePlans = { view: true, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.expenses = { view: true, create: true, edit: true, delete: false, approve: false, manage: false };
    perms.reports = { view: true, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.documents = { view: true, create: false, edit: true, delete: false, approve: true, manage: false };
    perms.settings = { view: true, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.staff = { view: true, create: false, edit: false, delete: false, approve: false, manage: false };
  } else if (role === 'Librarian') {
    // Librarian manages daily desk operations
    perms.students = { view: true, create: true, edit: true, delete: false, approve: false, manage: false };
    perms.admissions = { view: true, create: true, edit: false, delete: false, approve: false, manage: false };
    perms.renewals = { view: true, create: true, edit: false, delete: false, approve: false, manage: false };
    perms.seats = { view: true, create: false, edit: true, delete: false, approve: false, manage: false };
    perms.waitingList = { view: true, create: true, edit: false, delete: false, approve: false, manage: false };
    perms.payments = { view: true, create: true, edit: false, delete: false, approve: false, manage: false };
    perms.feePlans = { view: true, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.expenses = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.reports = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.documents = { view: true, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.settings = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.staff = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
  } else if (role === 'Accountant') {
    // Accountant handles financials and audit
    perms.students = { view: true, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.admissions = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.renewals = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.seats = { view: true, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.waitingList = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.payments = { view: true, create: true, edit: true, delete: false, approve: true, manage: false };
    perms.feePlans = { view: true, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.expenses = { view: true, create: true, edit: true, delete: false, approve: true, manage: false };
    perms.reports = { view: true, create: false, edit: false, delete: false, approve: true, manage: false };
    perms.documents = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.settings = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
    perms.staff = { view: false, create: false, edit: false, delete: false, approve: false, manage: false };
  }

  // Populate legacy boolean flags for backward compatibility
  return syncLegacyPermissions(perms);
};

// Sync legacy boolean flags from granular permissions
export const syncLegacyPermissions = (perms) => {
  const result = { ...perms };
  result.canManageStudents = Boolean(perms.students?.edit || perms.students?.manage);
  result.canProcessPayments = Boolean(perms.payments?.create || perms.payments?.collect || perms.payments?.manage);
  result.canEditSeats = Boolean(perms.seats?.edit || perms.seats?.manage);
  result.canManageExpenses = Boolean(perms.expenses?.create || perms.expenses?.manage);
  result.canViewFinancials = Boolean(perms.reports?.view || perms.reports?.manage);
  result.canManageSettings = Boolean(perms.settings?.edit || perms.settings?.manage);
  result.canCancelAdmission = Boolean(perms.admissions?.delete || perms.students?.delete || perms.admissions?.manage);
  result.canProcessRefunds = Boolean(perms.payments?.approve || perms.payments?.manage);
  return result;
};

// Count active granular permissions for UI indicators
export const countAllowedActions = (perms) => {
  if (!perms) return 0;
  let count = 0;
  STAFF_MODULES.forEach(mod => {
    const m = perms[mod.id];
    if (m) {
      if (m.manage) count += 6;
      else {
        if (m.view) count++;
        if (m.create) count++;
        if (m.edit) count++;
        if (m.delete) count++;
        if (m.approve) count++;
      }
    }
  });
  return count;
};

export const emptyModuleActions = () => ({
  view: false, create: false, edit: false, delete: false, approve: false, manage: false,
  print: false, share: false, export: false, collect: false,
});

export const isWalletBlockedRole = (role) => role === 'Librarian';

/**
 * One module + action. `manage` still means every action in that module.
 * Absent keys are false. Add/Collect is `create` or `collect`.
 * Librarians never pass a wallet check.
 */
export function staffAllows(perms, role, moduleName, actionName = 'view') {
  if (role === 'Admin') return true;
  if (moduleName === 'wallet' && isWalletBlockedRole(role)) return false;
  const mod = perms?.[moduleName];
  if (mod && typeof mod === 'object') {
    if (mod.manage === true) return true;
    if (actionName === 'netProfit') return mod.netProfit === true;
    if (actionName === 'collect' || actionName === 'create') return mod.create === true || mod.collect === true;
    if (typeof mod[actionName] === 'boolean') return mod[actionName];
    return false;
  }
  if (moduleName === 'students' && actionName === 'edit') return Boolean(perms?.canManageStudents);
  if (moduleName === 'students' && actionName === 'view') return true;
  if (moduleName === 'payments' && (actionName === 'create' || actionName === 'collect')) return Boolean(perms?.canProcessPayments);
  if (moduleName === 'seats' && actionName === 'edit') return Boolean(perms?.canEditSeats);
  if (moduleName === 'expenses' && (actionName === 'create' || actionName === 'collect')) return Boolean(perms?.canManageExpenses);
  if (moduleName === 'reports' && actionName === 'view') return Boolean(perms?.canViewFinancials);
  if (moduleName === 'settings' && actionName === 'edit') return Boolean(perms?.canManageSettings);
  if (moduleName === 'admissions' && actionName === 'delete') return Boolean(perms?.canCancelAdmission);
  if (moduleName === 'payments' && actionName === 'approve') return Boolean(perms?.canProcessRefunds);
  return false;
}

/** Net Profit is its own flag. Missing means hidden. `manage` on reports still includes it. */
export function canSeeNetProfit(perms, role) {
  if (role === 'Admin') return true;
  const mod = perms?.reports;
  if (mod && typeof mod === 'object') {
    if (mod.manage === true) return true;
    return mod.netProfit === true;
  }
  return false;
}

/** Grants every financial action this role may have. Librarians never receive Wallet. */
export function applyAllowAllFinancial(perms = {}, role) {
  const next = { ...perms, allowAllFinancial: true };
  for (const id of FINANCIAL_MODULE_IDS) {
    const cur = { ...emptyModuleActions(), ...(perms?.[id] && typeof perms[id] === 'object' ? perms[id] : {}) };
    if (id === 'wallet' && isWalletBlockedRole(role)) {
      next.wallet = emptyModuleActions();
      continue;
    }
    for (const k of FINANCIAL_KEYS) cur[k] = true;
    if (id === 'reports') cur.netProfit = true;
    next[id] = cur;
  }
  return syncLegacyPermissions(next);
}

/** Drop Wallet for a Librarian, including when Allow All was stored on the document. */
export function sanitizeStaffPermissions(perms, role) {
  if (!perms || typeof perms !== 'object') return perms;
  if (perms.allowAllFinancial) return applyAllowAllFinancial(perms, role);
  if (!isWalletBlockedRole(role)) return perms;
  return { ...perms, wallet: emptyModuleActions() };
}

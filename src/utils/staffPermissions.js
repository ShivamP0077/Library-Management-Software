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
  { id: 'staff', name: 'Staff & Roles', label: 'Staff & Roles', desc: 'Staff directory, role assignments, and permission matrix' }
];

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
  result.canProcessPayments = Boolean(perms.payments?.create || perms.payments?.manage);
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

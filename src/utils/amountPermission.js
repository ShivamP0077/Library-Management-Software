// Issue #9 (client mirror of server/src/amountPermission.js; the server is the real check).
export function roleCanEditAmount(staffRole, settings = {}) {
  if (staffRole === 'Admin') return true;
  if (staffRole === 'Manager') return settings.managerCanEditAmount !== false;
  return settings.staffCanEditAmount === true;
}
/** Owner sessions (no locked staff id) can always edit amounts. */
export const clientCanEditAmount = ({ lockedStaffId, currentStaff, settings }) =>
  !lockedStaffId || roleCanEditAmount(currentStaff?.role, settings || {});

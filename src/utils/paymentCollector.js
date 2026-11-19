/**
 * Who recorded a fee payment. Names come from the signed-in user.
 * Blank name falls back to email. Nothing here invents "Admin".
 */

const text = (v) => (v == null ? '' : String(v).trim());

/** Display role for a receipt. Staff uses their desk role when we know it. */
export function collectorRoleLabel(role, staffRole = '') {
  const r = text(role);
  if (r === 'client_admin' || r === 'superadmin') return 'Owner';
  if (r === 'staff') return text(staffRole) || 'Staff';
  return r;
}

/** Fields stored on a new payment. Empty when the account has no name or email. */
export function collectorIdentity(user, { staffRole = '' } = {}) {
  const name = text(user?.name) || text(user?.email);
  const role = collectorRoleLabel(user?.role, staffRole);
  const fields = {};
  if (user?.id) fields.collectedByUserId = String(user.id);
  if (name) {
    fields.collectedByName = name;
    fields.staffName = name;
  }
  if (role) fields.collectedByRole = role;
  return fields;
}

/** Public enquiry form rules: required fields, branch/section locking, view-only fee plans. */

export const GENDERS = ['male', 'female', 'other'];

export const ENQUIRY_IMAGE_LIMITS = {
  types: ['image/jpeg', 'image/webp'],
  maxEdge: 1600,
  maxBytes: 500 * 1024,
  qualities: [0.85, 0.75],
};

export function sectionsForBranch(sections, branchId) {
  return (sections || []).filter((section) => {
    const id = section?.branchId;
    if (!id || id === 'all') return true;
    return id === branchId;
  });
}

/** One option is selected and locked. Several stay open. None hides the control. */
export function singleChoice(options, selectedId = '') {
  const list = options || [];
  if (list.length === 1) return { options: list, value: list[0].id, locked: true, hidden: false };
  if (list.length === 0) return { options: list, value: '', locked: true, hidden: true };
  const value = list.some(item => item.id === selectedId) ? selectedId : '';
  return { options: list, value, locked: false, hidden: false };
}

export function branchSectionState(catalogue, branchId, sectionId) {
  const branches = catalogue?.branches || [];
  const branch = singleChoice(branches, branchId);
  const sections = sectionsForBranch(catalogue?.sections, branch.value);
  const section = singleChoice(sections, sectionId);
  return { branch, section };
}

/** Library fee plans for display. Software (SaaS) plans are not in this list. */
export function viewOnlyPlans(plans) {
  return (plans || []).filter(plan => plan && plan.name && !plan.priceMonthly && !plan.planId).map(plan => ({
    id: String(plan.id || plan.name),
    name: String(plan.name),
    price: plan.price == null || plan.price === '' ? null : (Number.isFinite(Number(plan.price)) ? Number(plan.price) : null),
  }));
}

export function genderError(value) {
  return GENDERS.includes(value) ? '' : 'Select male, female or other';
}

/** Enquiry form configuration. Defaults match the original public form. */

export const DEFAULT_ENQUIRY_FORM = {
  fields: {
    name: { show: true, required: true },
    mobile: { show: true, required: true },
    email: { show: true, required: false },
    gender: { show: true, required: true },
    branch: { show: true, required: true },
    section: { show: true, required: true },
    message: { show: true, required: false },
  },
  documents: { show: true, required: false },
  plan: { show: true, required: false },
  branches: null,
  sections: null,
};

/** Visible core fields always appear in this order when shown. */
export const ENQUIRY_CORE_ORDER = ['name', 'mobile', 'email', 'gender', 'branch', 'section'];
export const LOCKED_ENQUIRY_FIELDS = ['name', 'mobile'];

function flag(value, defaultShow, defaultRequired) {
  const src = value && typeof value === 'object' ? value : {};
  return {
    show: src.show === undefined ? defaultShow : !!src.show,
    required: src.required === undefined ? defaultRequired : !!src.required,
  };
}

function optionList(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (item == null) continue;
    if (typeof item === 'string') {
      const id = item.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: id });
      continue;
    }
    const id = String(item.id || '').trim();
    const name = String(item.name || item.id || '').trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const opt = { id, name };
    if (item.branchId) opt.branchId = String(item.branchId);
    out.push(opt);
  }
  return out;
}

export function normalizeEnquiryForm(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const fieldsIn = src.fields && typeof src.fields === 'object' ? src.fields : {};
  const fields = {};
  for (const key of Object.keys(DEFAULT_ENQUIRY_FORM.fields)) {
    const def = DEFAULT_ENQUIRY_FORM.fields[key];
    fields[key] = flag(fieldsIn[key], def.show, def.required);
  }
  fields.name = { show: true, required: true };
  fields.mobile = { show: true, required: true };
  return {
    fields,
    documents: flag(src.documents, true, false),
    plan: flag(src.plan, true, false),
    branches: optionList(src.branches),
    sections: optionList(src.sections),
  };
}

function catalogueOptions(list) {
  return (list || [])
    .filter((o) => o && o.id && o.name)
    .map((o) => ({
      id: String(o.id),
      name: String(o.name),
      ...(o.branchId ? { branchId: String(o.branchId) } : {}),
    }));
}

function pickOptions(configured, catalogue) {
  const cat = catalogueOptions(catalogue);
  if (configured == null) return cat;
  const byId = new Map(cat.map((o) => [o.id, o]));
  return configured.map((o) => {
    const fromCat = byId.get(o.id);
    return fromCat ? { ...fromCat, name: o.name || fromCat.name } : o;
  });
}

/**
 * Resolve owner config against the live catalogue for the public form and POST validation.
 * Branch/section are hidden when the owner turned them off or when no options remain.
 */
export function resolveEnquiryForm(settings, catalogue = {}) {
  const cfg = normalizeEnquiryForm(settings?.enquiryForm);
  const branches = pickOptions(cfg.branches, catalogue.branches);
  const sections = pickOptions(cfg.sections, catalogue.sections);
  const branchShow = cfg.fields.branch.show && branches.length > 0;
  const sectionShow = cfg.fields.section.show && sections.length > 0;
  return {
    fields: {
      ...cfg.fields,
      branch: { ...cfg.fields.branch, show: branchShow },
      section: { ...cfg.fields.section, show: sectionShow },
    },
    documents: cfg.documents,
    plan: cfg.plan,
    branches,
    sections,
  };
}

export function publicEnquiryFormPayload(resolved) {
  return {
    fields: resolved.fields,
    documents: resolved.documents,
    plan: resolved.plan,
  };
}

export function planChoiceOptions(plans) {
  return (plans || [])
    .filter((plan) => plan && (plan.id || plan.name) && !plan.priceMonthly && !plan.planId)
    .map((plan) => ({
      id: String(plan.id || plan.name),
      name: String(plan.name || plan.id),
      price: plan.price == null || plan.price === '' ? null : (Number.isFinite(Number(plan.price)) ? Number(plan.price) : null),
    }));
}

export function findPlanChoice(plans, value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return planChoiceOptions(plans).find((p) => p.id === raw || p.name === raw) || null;
}

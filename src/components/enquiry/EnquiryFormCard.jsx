import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { LOCKED_ENQUIRY_FIELDS, normalizeEnquiryForm } from '../../utils/enquiryFormConfig';

const FIELD_ROWS = [
  { key: 'name', label: 'Name' },
  { key: 'mobile', label: 'Mobile number' },
  { key: 'email', label: 'Email' },
  { key: 'gender', label: 'Gender' },
  { key: 'branch', label: 'Branch' },
  { key: 'section', label: 'Section' },
  { key: 'message', label: 'Message' },
];

function newCustomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function EnquiryFormCard() {
  const { settings, setSettings, branches, sections, plans } = useLibrary();
  const [form, setForm] = useState(() => normalizeEnquiryForm(settings?.enquiryForm));

  useEffect(() => {
    setForm(normalizeEnquiryForm(settings?.enquiryForm));
  }, [settings?.enquiryForm]);

  const patchField = (key, patch) => {
    if (LOCKED_ENQUIRY_FIELDS.includes(key)) return;
    setForm((prev) => ({ ...prev, fields: { ...prev.fields, [key]: { ...prev.fields[key], ...patch } } }));
  };

  const catalogueBranches = (branches || []).filter((b) => b.id && b.name);
  const catalogueSections = (sections || []).filter((s) => s.id && s.name);
  const usingCustomBranches = Array.isArray(form.branches);
  const usingCustomSections = Array.isArray(form.sections);

  const toggleCatalogueItem = (kind, item, checked) => {
    setForm((prev) => {
      const current = Array.isArray(prev[kind]) ? prev[kind] : (kind === 'branches' ? catalogueBranches : catalogueSections).map((o) => ({ id: o.id, name: o.name, ...(o.branchId ? { branchId: o.branchId } : {}) }));
      const next = checked
        ? (current.some((o) => o.id === item.id) ? current : [...current, { id: item.id, name: item.name, ...(item.branchId ? { branchId: item.branchId } : {}) }])
        : current.filter((o) => o.id !== item.id);
      return { ...prev, [kind]: next };
    });
  };

  const addCustom = (kind, name, branchId) => {
    const label = String(name || '').trim();
    if (!label) return;
    setForm((prev) => {
      const current = Array.isArray(prev[kind]) ? prev[kind] : [];
      return { ...prev, [kind]: [...current, { id: newCustomId(kind === 'branches' ? 'br' : 'sec'), name: label, ...(branchId ? { branchId } : {}) }] };
    });
  };

  const save = (e) => {
    e.preventDefault();
    const next = normalizeEnquiryForm(form);
    setSettings({ ...settings, enquiryForm: next });
    toast.success('Enquiry form settings saved.');
  };

  const [customBranch, setCustomBranch] = useState('');
  const [customSection, setCustomSection] = useState('');
  const [customSectionBranch, setCustomSectionBranch] = useState('');

  const selectedBranchIds = new Set((usingCustomBranches ? form.branches : catalogueBranches).map((b) => b.id));
  const selectedSectionIds = new Set((usingCustomSections ? form.sections : catalogueSections).map((s) => s.id));

  return (
    <div className="premium-card" style={{ padding: 20, marginBottom: 20 }} data-testid="enquiry-form-settings">
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>Enquiry form</h3>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
        Choose which fields appear on the public QR enquiry form. Name and mobile stay required. Fields always show in this order: Name, Mobile number, Email, Gender, Branch, Section, then Documents, Plan and Message.
      </p>

      <form onSubmit={save}>
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '6px 8px' }}>Field</th>
                <th style={{ padding: '6px 8px' }}>Show</th>
                <th style={{ padding: '6px 8px' }}>Required</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_ROWS.map((row) => {
                const locked = LOCKED_ENQUIRY_FIELDS.includes(row.key);
                const cfg = form.fields[row.key];
                return (
                  <tr key={row.key}>
                    <td style={{ padding: '6px 8px' }}>{row.label}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <input type="checkbox" checked={cfg.show} disabled={locked} onChange={(e) => patchField(row.key, { show: e.target.checked })} />
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <input type="checkbox" checked={cfg.required} disabled={locked || !cfg.show} onChange={(e) => patchField(row.key, { required: e.target.checked })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
          <label data-testid="enquiry-documents-toggle" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, border: '1px solid var(--border-light)', borderRadius: 10 }}>
            <input type="checkbox" checked={form.documents.show} onChange={(e) => setForm((p) => ({ ...p, documents: { ...p.documents, show: e.target.checked } }))} />
            <span>
              <strong>Documents</strong>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>Show the Aadhaar and student photo uploads as one section.</span>
              <label style={{ display: 'inline-flex', gap: 6, marginTop: 6, fontSize: 12, opacity: form.documents.show ? 1 : 0.5 }}>
                <input type="checkbox" disabled={!form.documents.show} checked={form.documents.required} onChange={(e) => setForm((p) => ({ ...p, documents: { ...p.documents, required: e.target.checked } }))} />
                Required
              </label>
            </span>
          </label>

          <label data-testid="enquiry-plan-toggle" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, border: '1px solid var(--border-light)', borderRadius: 10 }}>
            <input type="checkbox" checked={form.plan.show} onChange={(e) => setForm((p) => ({ ...p, plan: { ...p.plan, show: e.target.checked } }))} />
            <span>
              <strong>Plan selection</strong>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>
                Let the applicant choose a membership plan. {(plans || []).length ? `${(plans || []).length} plan(s) available.` : 'No membership plans have been added yet, so the control stays hidden on the form.'}
              </span>
              <label style={{ display: 'inline-flex', gap: 6, marginTop: 6, fontSize: 12, opacity: form.plan.show ? 1 : 0.5 }}>
                <input type="checkbox" disabled={!form.plan.show} checked={form.plan.required} onChange={(e) => setForm((p) => ({ ...p, plan: { ...p.plan, required: e.target.checked } }))} />
                Required
              </label>
            </span>
          </label>
        </div>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginBottom: 16 }}>
          <fieldset style={{ border: '1px solid var(--border-light)', borderRadius: 10, padding: 12, margin: 0 }}>
            <legend style={{ fontWeight: 600, fontSize: 13 }}>Branch options</legend>
            <label style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 8 }}>
              <input type="checkbox" checked={!usingCustomBranches} onChange={(e) => setForm((p) => ({ ...p, branches: e.target.checked ? null : catalogueBranches.map((b) => ({ id: b.id, name: b.name })) }))} />
              Use all library branches
            </label>
            {usingCustomBranches && (
              <>
                {catalogueBranches.map((b) => (
                  <label key={b.id} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={selectedBranchIds.has(b.id)} onChange={(e) => toggleCatalogueItem('branches', b, e.target.checked)} />
                    {b.name}
                  </label>
                ))}
                {(form.branches || []).filter((b) => !catalogueBranches.some((c) => c.id === b.id)).map((b) => (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                    <span>{b.name} <em style={{ color: 'var(--text-tertiary)' }}>(custom)</em></span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm((p) => ({ ...p, branches: (p.branches || []).filter((x) => x.id !== b.id) }))}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input className="form-input" placeholder="Custom branch" value={customBranch} onChange={(e) => setCustomBranch(e.target.value)} />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { addCustom('branches', customBranch); setCustomBranch(''); }}>Add</button>
                </div>
              </>
            )}
          </fieldset>

          <fieldset style={{ border: '1px solid var(--border-light)', borderRadius: 10, padding: 12, margin: 0 }}>
            <legend style={{ fontWeight: 600, fontSize: 13 }}>Section options</legend>
            <label style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 8 }}>
              <input type="checkbox" checked={!usingCustomSections} onChange={(e) => setForm((p) => ({ ...p, sections: e.target.checked ? null : catalogueSections.map((s) => ({ id: s.id, name: s.name, ...(s.branchId ? { branchId: s.branchId } : {}) })) }))} />
              Use all library sections
            </label>
            {usingCustomSections && (
              <>
                {catalogueSections.map((s) => (
                  <label key={s.id} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={selectedSectionIds.has(s.id)} onChange={(e) => toggleCatalogueItem('sections', s, e.target.checked)} />
                    {s.name}
                  </label>
                ))}
                {(form.sections || []).filter((s) => !catalogueSections.some((c) => c.id === s.id)).map((s) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                    <span>{s.name} <em style={{ color: 'var(--text-tertiary)' }}>(custom)</em></span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm((p) => ({ ...p, sections: (p.sections || []).filter((x) => x.id !== s.id) }))}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <input className="form-input" placeholder="Custom section" value={customSection} onChange={(e) => setCustomSection(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
                  {catalogueBranches.length > 0 && (
                    <select className="form-select" value={customSectionBranch} onChange={(e) => setCustomSectionBranch(e.target.value)}>
                      <option value="">Any branch</option>
                      {catalogueBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  )}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { addCustom('sections', customSection, customSectionBranch); setCustomSection(''); }}>Add</button>
                </div>
              </>
            )}
          </fieldset>
        </div>

        <button type="submit" className="btn btn-primary"><Save size={15} /> Save enquiry form</button>
      </form>
    </div>
  );
}

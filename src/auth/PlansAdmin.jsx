// Issue #14: Super Admin software plan builder (price, limits, features) and per-library plan assignment.
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';
import { SaModal } from './SaModal';

const EMPTY = { name: '', description: '', priceMonthly: '', priceYearly: '', studentLimit: '', staffLimit: '', branchLimit: '', trialDays: '', features: '', public: true, active: true };
const fmtLimit = (n) => (n ? n.toLocaleString() : 'Unlimited');

export function PlansAdmin({ libraries = [], onChanged }) {
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // planId or null for new
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => { try { setPlans(await api.adminPlans()); } catch (e) { toast.error(e.message); } }, []);
  useEffect(() => { load(); }, [load]);

  const startEdit = (p) => {
    setEditing(p ? p.planId : null);
    setForm(p ? { ...EMPTY, ...p, priceYearly: p.priceYearly ?? '', studentLimit: p.studentLimit ?? '', staffLimit: p.staffLimit ?? '', branchLimit: p.branchLimit ?? '', trialDays: p.trialDays || '', features: (p.features || []).join('\n') } : EMPTY);
    setOpen(true);
  };
  const save = async (e) => {
    e.preventDefault();
    const body = { ...form, priceMonthly: Number(form.priceMonthly) || 0, priceYearly: form.priceYearly === '' ? null : Number(form.priceYearly), trialDays: Number(form.trialDays) || 0 };
    try {
      if (editing) await api.adminUpdatePlan(editing, body); else await api.adminCreatePlan(body);
      toast.success(`Plan ${editing ? 'updated' : 'created'}`);
      setOpen(false); load();
    } catch (err) { toast.error(err.message); }
  };
  const assign = async (lib, planId) => {
    try { await api.adminUpdateLibrary(lib.libraryId, { planId: planId || null }); toast.success(`${lib.name}: plan updated`); load(); onChanged?.(); } catch (e) { toast.error(e.message); }
  };
  const field = (k, label, type = 'number', extra = {}) => (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label" htmlFor={`plan-${k}`}>{label}</label>
      <input id={`plan-${k}`} className="form-input" type={type} min={type === 'number' ? 0 : undefined} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} {...extra} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="premium-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Software plans</h3>
          <button className="btn btn-primary btn-sm" onClick={() => startEdit(null)}>+ New plan</button>
        </div>
        {plans.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No plans yet. Libraries without a plan have no plan limits.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {plans.map(p => (
            <div key={p.planId} data-plan={p.planId} style={{ border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8, padding: 12, opacity: p.active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{p.name}</strong>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{!p.active ? 'Archived' : p.public ? 'On signup' : 'Hidden'}</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, margin: '6px 0' }}>₹{Number(p.priceMonthly).toLocaleString()}<span style={{ fontSize: 12, fontWeight: 400 }}>/month</span>{p.priceYearly ? <span style={{ fontSize: 12, fontWeight: 400 }}> · ₹{p.priceYearly.toLocaleString()}/year</span> : null}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Students: {fmtLimit(p.studentLimit)} · Staff: {fmtLimit(p.staffLimit)} · Branches: {fmtLimit(p.branchLimit)}{p.trialDays ? ` · ${p.trialDays}-day trial` : ''}</div>
              {p.features?.length > 0 && <ul style={{ fontSize: 12, margin: '6px 0 0', paddingLeft: 18 }}>{p.features.map(f => <li key={f}>{f}</li>)}</ul>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{p.libraries} {p.libraries === 1 ? 'library' : 'libraries'}</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(p)}>Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { try { await api.adminUpdatePlan(p.planId, { active: !p.active }); load(); } catch (e) { toast.error(e.message); } }}>{p.active ? 'Archive' : 'Restore'}</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <SaModal open={open} title={editing ? `Edit ${form.name || 'plan'}` : 'New plan'} onClose={() => setOpen(false)} maxWidth={720}>
        <form style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={save} aria-label="Plan form">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {field('name', 'Name *', 'text', { required: true })}
            {field('priceMonthly', 'Price per month (₹)')}
            {field('priceYearly', 'Price per year (₹, optional)')}
            {field('studentLimit', 'Student limit (blank = unlimited)')}
            {field('staffLimit', 'Staff limit (blank = unlimited)')}
            {field('branchLimit', 'Branch limit (blank = unlimited)')}
            {field('trialDays', 'Free trial days')}
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="plan-features">Features (one per line)</label>
            <textarea id="plan-features" className="form-input" rows={3} value={form.features} onChange={e => setForm(f => ({ ...f, features: e.target.value }))} />
          </div>
          <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!form.public} onChange={e => setForm(f => ({ ...f, public: e.target.checked }))} /> Offer on owner signup</label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save plan</button>
          </div>
        </form>
      </SaModal>

      <div className="premium-card" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Library plans</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {libraries.map(l => (
            <div key={l.libraryId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
              <span>{l.name} <span style={{ color: 'var(--text-tertiary)' }}>({l.libraryId})</span>{l.studentLimit ? <span style={{ color: 'var(--text-tertiary)' }}> · own student limit {l.studentLimit}</span> : null}</span>
              <select className="form-select" aria-label={`Plan for ${l.name}`} style={{ maxWidth: 200 }} value={l.planId || ''} onChange={e => assign(l, e.target.value)}>
                <option value="">No plan</option>
                {plans.filter(p => p.active || p.planId === l.planId).map(p => <option key={p.planId} value={p.planId}>{p.name}{p.active ? '' : ' (archived)'}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

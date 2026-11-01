import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Power, Save, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const card = { padding: 14, display: 'grid', gap: 10, minWidth: 0 };
const grid = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end' };

const RuleEditor = ({ p, appliesTo, onSaved }) => {
  const cur = p.rules?.[appliesTo];
  const [mode, setMode] = useState(cur?.mode || 'percent');
  const [value, setValue] = useState(cur?.value ?? '');
  const save = async () => {
    try { await api.adminSetCommissionRule(p.id, appliesTo, value === '' ? { disabled: true } : { mode, value: Number(value) }); toast.success('Rule saved (old commissions unchanged)'); onSaved(); }
    catch (e) { toast.error(e.message); }
  };
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, width: 52 }}>{appliesTo === 'initial' ? 'New sale' : 'Renewal'}</span>
      <select className="form-input" style={{ width: 70, padding: '4px 6px' }} value={mode} onChange={e => setMode(e.target.value)}><option value="percent">%</option><option value="fixed">₹</option></select>
      <input className="form-input" style={{ width: 70, padding: '4px 6px' }} type="number" min={0} placeholder="none" value={value} onChange={e => setValue(e.target.value)} />
      <button type="button" className="btn btn-ghost btn-sm" title="Save rule" onClick={save}><Save size={14} /></button>
      {cur && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>v{cur.version}</span>}
    </div>
  );
};

/** Super Admin: partners & agents, commission rules, library assignment, commission records (no payouts). */
export function PartnersAdmin({ libraries, onChanged }) {
  const [partners, setPartners] = useState([]);
  const [recs, setRecs] = useState([]);
  const [form, setForm] = useState({ kind: 'partner', name: '', email: '' });
  const [assign, setAssign] = useState({ libraryId: '', partnerId: '', originalSellerId: '', reason: '' });
  const [sale, setSale] = useState({ libraryId: '', kind: 'initial', saleRef: '', saleAmount: '' });
  const load = useCallback(async () => {
    try { const [p, c] = await Promise.all([api.adminPartners(), api.adminCommissions()]); setPartners(p); setRecs(c); } catch (e) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const name = (id) => partners.find(p => p.id === id)?.name || '—';
  const libName = (id) => libraries.find(l => l.libraryId === id)?.name || id;
  const set = (setter, k) => (e) => setter(x => ({ ...x, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    try {
      const r = await api.adminCreatePartner(form);
      toast.success(r.generatedPassword ? `Created. Temporary password (shown once): ${r.generatedPassword}` : 'Created', { duration: 15000 });
      setForm({ kind: form.kind, name: '', email: '' }); load();
    } catch (err) { toast.error(err.message); }
  };
  const doAssign = async (e) => {
    e.preventDefault();
    try {
      await api.adminAssignLibrary(assign.libraryId, { partnerId: assign.partnerId || null, ...(assign.originalSellerId ? { originalSellerId: assign.originalSellerId } : {}), reason: assign.reason });
      toast.success('Assignment saved'); setAssign({ libraryId: '', partnerId: '', originalSellerId: '', reason: '' }); load(); onChanged?.();
    } catch (err) { toast.error(err.message); }
  };
  const doSale = async (e) => {
    e.preventDefault();
    try {
      const r = await api.adminRecordSale({ ...sale, saleAmount: Number(sale.saleAmount) });
      r.created ? toast.success(`Commission ${inr(r.record.amount)} recorded`) : toast(`No commission: ${String(r.reason).replace('_', ' ')}`);
      setSale(s => ({ ...s, saleRef: '', saleAmount: '' })); load(); onChanged?.();
    } catch (err) { toast.error(err.message); }
  };
  const reverse = async (r) => {
    const reason = window.prompt('Reason (refund, cancellation…)');
    if (!reason) return;
    try { await api.adminReverseCommission(r.id, { reason }); toast.success('Commission reversed'); load(); onChanged?.(); } catch (e) { toast.error(e.message); }
  };
  const toggle = async (p) => {
    const status = p.status === 'Active' ? 'Disabled' : 'Active';
    if (status === 'Disabled' && !window.confirm(`Disable ${p.name}? They will be signed out.`)) return;
    try { await api.adminUpdatePartner(p.id, { status }); load(); } catch (e) { toast.error(e.message); }
  };
  const perm = async (p, k) => { try { await api.adminUpdatePartner(p.id, { permissions: { [k]: !p.permissions[k] } }); load(); } catch (e) { toast.error(e.message); } };

  return (
    <div id="partners-admin" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <form className="premium-card" style={card} onSubmit={create}>
        <strong>Add partner or agent</strong>
        <div style={grid}>
          <label className="form-label" style={{ margin: 0 }}>Type<select className="form-input" value={form.kind} onChange={set(setForm, 'kind')}><option value="partner">Partner (manages clients)</option><option value="agent">Agent (sales/referrals)</option></select></label>
          <label className="form-label" style={{ margin: 0 }}>Name<input className="form-input" required value={form.name} onChange={set(setForm, 'name')} /></label>
          <label className="form-label" style={{ margin: 0 }}>Login email<input className="form-input" type="email" required value={form.email} onChange={set(setForm, 'email')} /></label>
          <button className="btn btn-primary btn-sm" type="submit"><Plus size={14} /> <span>Create</span></button>
        </div>
      </form>

      <div className="premium-card sa-table-card" style={{ padding: 0 }}>
        <div className="table-container">
          <table className="data-grid" style={{ width: '100%' }}>
            <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Libraries</th><th>Commission rules</th><th>Permissions</th><th></th></tr></thead>
            <tbody>
              {partners.length === 0 && <tr><td colSpan={7}>No partners or agents yet.</td></tr>}
              {partners.map(p => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong><div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{p.email}</div></td>
                  <td>{p.kind}</td>
                  <td><span className={`badge ${p.status === 'Active' ? 'badge-active' : 'badge-expired'}`}>{p.status}</span></td>
                  <td>{p.libraries}</td>
                  <td><RuleEditor key={`${p.id}-i-${p.rules?.initial?.version}`} p={p} appliesTo="initial" onSaved={load} /><RuleEditor key={`${p.id}-r-${p.rules?.renewal?.version}`} p={p} appliesTo="renewal" onSaved={load} /></td>
                  <td style={{ fontSize: 12 }}>
                    {['accessLibrary', 'viewClients', 'viewCommissions'].map(k => (
                      <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={!!p.permissions[k]} onChange={() => perm(p, k)} />{k === 'accessLibrary' ? 'Access Library (read-only)' : k === 'viewClients' ? 'See clients' : 'See commissions'}</label>
                    ))}
                  </td>
                  <td><button className="btn btn-ghost btn-sm" title={p.status === 'Active' ? 'Disable' : 'Enable'} onClick={() => toggle(p)}><Power size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form className="premium-card" style={card} onSubmit={doAssign}>
        <strong>Assign / transfer a library</strong>
        <div style={grid}>
          <label className="form-label" style={{ margin: 0 }}>Library<select className="form-input" required value={assign.libraryId} onChange={set(setAssign, 'libraryId')}><option value="">Pick…</option>{libraries.map(l => <option key={l.libraryId} value={l.libraryId}>{l.name}{l.partner ? ` (now: ${l.partner.name})` : ''}</option>)}</select></label>
          <label className="form-label" style={{ margin: 0 }}>Managing partner<select className="form-input" value={assign.partnerId} onChange={set(setAssign, 'partnerId')}><option value="">None</option>{partners.filter(p => p.kind === 'partner' && p.status === 'Active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="form-label" style={{ margin: 0 }}>Original seller (once)<select className="form-input" value={assign.originalSellerId} onChange={set(setAssign, 'originalSellerId')}><option value="">Leave as is</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="form-label" style={{ margin: 0 }}>Reason<input className="form-input" value={assign.reason} onChange={set(setAssign, 'reason')} /></label>
          <button className="btn btn-primary btn-sm" type="submit">Save</button>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Direct website signups have no original seller, so they never earn a new-sale commission. A partner assigned later can earn renewal commissions.</span>
      </form>

      <form className="premium-card" style={card} onSubmit={doSale}>
        <strong>Record a software sale (until billing is connected)</strong>
        <div style={grid}>
          <label className="form-label" style={{ margin: 0 }}>Library<select className="form-input" required value={sale.libraryId} onChange={set(setSale, 'libraryId')}><option value="">Pick…</option>{libraries.map(l => <option key={l.libraryId} value={l.libraryId}>{l.name}</option>)}</select></label>
          <label className="form-label" style={{ margin: 0 }}>Type<select className="form-input" value={sale.kind} onChange={set(setSale, 'kind')}><option value="initial">New sale</option><option value="renewal">Renewal</option></select></label>
          <label className="form-label" style={{ margin: 0 }}>Invoice / ref<input className="form-input" required value={sale.saleRef} onChange={set(setSale, 'saleRef')} /></label>
          <label className="form-label" style={{ margin: 0 }}>Amount (₹)<input className="form-input" type="number" min={1} required value={sale.saleAmount} onChange={set(setSale, 'saleAmount')} /></label>
          <button className="btn btn-primary btn-sm" type="submit">Record</button>
        </div>
      </form>

      <div className="premium-card sa-table-card" style={{ padding: 0 }}>
        <div style={{ padding: '12px 14px' }}><strong>Commission records</strong> <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Rate is frozen at the time of sale. Payouts are not handled in the app.</span></div>
        <div className="table-container">
          <table className="data-grid" style={{ width: '100%' }}>
            <thead><tr><th>Date</th><th>Library</th><th>Seller</th><th>Type</th><th>Sale</th><th>Rate</th><th>Commission</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {recs.length === 0 && <tr><td colSpan={9}>No commissions yet.</td></tr>}
              {recs.map(r => (
                <tr key={r.id}>
                  <td>{r.saleDate}</td><td>{libName(r.tenantId)}</td><td>{name(r.sellerId)}</td><td>{r.kind === 'initial' ? 'New sale' : 'Renewal'}</td>
                  <td>{inr(r.saleAmount)}<div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{r.saleRef}</div></td>
                  <td>{r.basis?.mode === 'percent' ? `${r.basis.value}%` : inr(r.basis?.value)}</td>
                  <td><strong>{inr(r.amount)}</strong></td>
                  <td><span className={`badge ${r.status === 'earned' ? 'badge-active' : 'badge-expired'}`}>{r.status}</span>{r.statusReason && <div style={{ fontSize: 11 }}>{r.statusReason}</div>}</td>
                  <td>{r.status === 'earned' && <button className="btn btn-ghost btn-sm" title="Reverse (refund/cancel)" onClick={() => reverse(r)}><Undo2 size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

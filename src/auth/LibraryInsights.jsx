import React, { useCallback, useEffect, useState } from 'react';
import { Download, Lock, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, downloadFile } from '../utils/api';

const inr = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;
const Stat = ({ label, value, sub }) => (
  <div className="premium-card" style={{ padding: 14, minWidth: 140, flex: '1 1 140px' }}>
    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, overflowWrap: 'anywhere' }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{sub}</div>}
  </div>
);
const Bars = ({ rows, label, value, fmt = (v) => v }) => {
  const max = Math.max(1, ...rows.map(r => r[value] || 0));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map(r => (
        <div key={r[label]} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 30%) 1fr auto', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[label]}</span>
          <div style={{ background: 'var(--border-light, #f3f4f6)', borderRadius: 4, height: 10 }}><div style={{ width: `${((r[value] || 0) / max) * 100}%`, background: '#111827', height: 10, borderRadius: 4 }} /></div>
          <span style={{ fontWeight: 600 }}>{fmt(r[value])}</span>
        </div>
      ))}
      {rows.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No data for these filters.</span>}
    </div>
  );
};

/** Super Admin "Library Insights & Analytics": aggregated customer operations, no student PII, audited. */
export function LibraryInsights({ libraries }) {
  const [f, setF] = useState({ from: '', to: '', libraryId: '', city: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v && p.set(k, v)); const s = p.toString(); return s ? `?${s}` : ''; };
  const load = useCallback(async (filters) => {
    setLoading(true);
    try { setData(await api.adminInsights(qs(filters))); } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load({}); }, [load]);
  const cities = [...new Set(libraries.map(l => l.city).filter(Boolean))];
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const t = data?.totals;
  return (
    <div id="library-insights" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div className="premium-card" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text-secondary)' }}>
        <Lock size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{data?.privacy || 'Aggregated statistics only. Access is logged.'} Customer fee collections are the libraries' own money and are kept separate from our software revenue.</span>
      </div>
      <form className="premium-card" onSubmit={(e) => { e.preventDefault(); load(f); }} style={{ padding: 12, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', alignItems: 'end' }}>
        <label className="form-label" style={{ margin: 0 }}>From<input className="form-input" type="date" value={f.from} onChange={set('from')} /></label>
        <label className="form-label" style={{ margin: 0 }}>To<input className="form-input" type="date" value={f.to} onChange={set('to')} /></label>
        <label className="form-label" style={{ margin: 0 }}>Library
          <select className="form-input" value={f.libraryId} onChange={set('libraryId')}><option value="">All libraries</option>{libraries.map(l => <option key={l.libraryId} value={l.libraryId}>{l.name}</option>)}</select>
        </label>
        <label className="form-label" style={{ margin: 0 }}>City
          <select className="form-input" value={f.city} onChange={set('city')}><option value="">All cities</option>{cities.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" type="submit" disabled={loading}><Filter size={14} /> <span>Apply</span></button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => downloadFile(`/admin/insights/export.csv${qs(f)}`, 'library-insights.csv').catch(e => toast.error(e.message))}><Download size={14} /> <span>CSV</span></button>
        </div>
      </form>
      {t && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Stat label="Libraries" value={t.libraries} />
            <Stat label="Active students" value={t.studentsActive} sub={`${t.studentsTotal} total`} />
            <Stat label="Seat utilization" value={t.seatUtilization == null ? '—' : `${t.seatUtilization}%`} sub={`${t.seatsOccupied} / ${t.seatsTotal} seats`} />
            <Stat label="Customer fee collections" value={inr(t.customerFeeCollections)} sub={`${t.payments} payments`} />
            <Stat label="Customer expenses" value={inr(t.customerExpenses)} />
            <Stat label="Customer net" value={inr(t.customerNet)} />
          </div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div className="premium-card" style={{ padding: 14, minWidth: 0 }}><strong style={{ fontSize: 14 }}>Collections by month</strong><div style={{ marginTop: 8 }}><Bars rows={data.trend} label="month" value="collections" fmt={inr} /></div></div>
            <div className="premium-card" style={{ padding: 14, minWidth: 0 }}><strong style={{ fontSize: 14 }}>Popular plans</strong><div style={{ marginTop: 8 }}><Bars rows={data.popularPlans} label="name" value="students" /></div></div>
            <div className="premium-card" style={{ padding: 14, minWidth: 0 }}><strong style={{ fontSize: 14 }}>Cities (active students)</strong><div style={{ marginTop: 8 }}><Bars rows={data.cities} label="city" value="studentsActive" /></div></div>
          </div>
          <div className="premium-card sa-table-card" style={{ padding: 0 }}>
            <div className="table-container">
              <table className="data-grid" style={{ width: '100%' }}>
                <thead><tr><th>Library</th><th>City</th><th>Active / total students</th><th>Seats used</th><th>Fee collections</th><th>Expenses</th><th>Net</th></tr></thead>
                <tbody>
                  {data.perLibrary.map(r => (
                    <tr key={r.libraryId}>
                      <td><strong>{r.name}</strong></td><td>{r.city || '—'}</td><td>{r.studentsActive} / {r.studentsTotal}</td>
                      <td>{r.seatsOccupied} / {r.seatsTotal}{r.seatUtilization != null && ` (${r.seatUtilization}%)`}</td>
                      <td>{inr(r.collections)}</td><td>{inr(r.expenses)}</td><td>{inr(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Eye, LogOut, Handshake, KeyRound } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Partner / agent home: assigned clients, own commissions, password change, read-only Access Library. */
export function PartnerPortal({ onOpenLibrary }) {
  const { user, logout } = useAuth();
  const [me, setMe] = useState(null);
  const [libs, setLibs] = useState([]);
  const [recs, setRecs] = useState([]);
  const [pw, setPw] = useState({ cur: '', next: '' });
  useEffect(() => {
    Promise.all([api.partnerMe(), api.partnerLibraries(), api.partnerCommissions()])
      .then(([m, l, c]) => { setMe(m); setLibs(l); setRecs(c); }).catch(e => toast.error(e.message));
  }, []);
  const earned = recs.filter(r => r.status === 'earned').reduce((a, r) => a + r.amount, 0);
  const change = async (e) => {
    e.preventDefault();
    try { await api.changePassword(pw.cur, pw.next); toast.success('Password changed'); setPw({ cur: '', next: '' }); } catch (err) { toast.error(err.message); }
  };
  return (
    <div style={{ minHeight: '100vh', overflowY: 'auto' }}>
      <header className="glass-panel sa-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 10, gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
          <Handshake size={22} style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700 }}>{me?.kind === 'agent' ? 'Agent' : 'Partner'} — {me?.name || user?.name || ''}</h1>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>{user?.email}</p>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={14} /> <span>Sign out</span></button>
      </header>
      <main className="sa-main" style={{ padding: 24, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="premium-card" style={{ padding: 16, flex: '1 1 150px' }}><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>My libraries</div><div style={{ fontSize: 22, fontWeight: 700 }}>{libs.length}</div></div>
          <div className="premium-card" style={{ padding: 16, flex: '1 1 150px' }}><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Commission earned</div><div style={{ fontSize: 22, fontWeight: 700 }}>{inr(earned)}</div></div>
        </div>
        <div className="premium-card sa-table-card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 14px' }}><strong>My libraries</strong></div>
          <div className="table-container">
            <table className="data-grid" style={{ width: '100%' }}>
              <thead><tr><th>Library</th><th>Owner</th><th>City</th><th>Status</th><th>Relation</th><th></th></tr></thead>
              <tbody>
                {libs.length === 0 && <tr><td colSpan={6}>No libraries assigned yet.</td></tr>}
                {libs.map(l => (
                  <tr key={l.libraryId}>
                    <td><strong>{l.name}</strong></td><td style={{ fontSize: 12 }}>{l.owner?.email || '—'}</td><td>{l.city || '—'}</td>
                    <td><span className={`badge ${l.status === 'Active' ? 'badge-active' : 'badge-expired'}`}>{l.status}</span></td>
                    <td style={{ fontSize: 12 }}>{[l.managedByMe && 'Managed', l.soldByMe && 'Sold by me'].filter(Boolean).join(' • ')}</td>
                    <td>{l.canAccess && <button className="btn btn-secondary btn-sm" onClick={() => onOpenLibrary(l)}><Eye size={14} /> <span>Access Library</span></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="premium-card sa-table-card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 14px' }}><strong>My commissions</strong></div>
          <div className="table-container">
            <table className="data-grid" style={{ width: '100%' }}>
              <thead><tr><th>Date</th><th>Type</th><th>Sale</th><th>Rate</th><th>Commission</th><th>Status</th></tr></thead>
              <tbody>
                {recs.length === 0 && <tr><td colSpan={6}>No commissions yet.</td></tr>}
                {recs.map(r => (
                  <tr key={r.id}><td>{r.saleDate}</td><td>{r.kind === 'initial' ? 'New sale' : 'Renewal'}</td><td>{inr(r.saleAmount)}</td>
                    <td>{r.basis?.mode === 'percent' ? `${r.basis.value}%` : inr(r.basis?.value)}</td><td><strong>{inr(r.amount)}</strong></td><td>{r.status}{r.statusReason ? ` (${r.statusReason})` : ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <form className="premium-card" onSubmit={change} style={{ padding: 16, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
          <strong style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, alignItems: 'center' }}><KeyRound size={16} /> Change password</strong>
          <label className="form-label" style={{ margin: 0 }}>Current password<input className="form-input" type="password" autoComplete="current-password" value={pw.cur} onChange={e => setPw(p => ({ ...p, cur: e.target.value }))} /></label>
          <label className="form-label" style={{ margin: 0 }}>New password (8+ characters)<input className="form-input" type="password" autoComplete="new-password" minLength={8} required value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} /></label>
          <button className="btn btn-primary btn-sm" type="submit">Update password</button>
        </form>
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}

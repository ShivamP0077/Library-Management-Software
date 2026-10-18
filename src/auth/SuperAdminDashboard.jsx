import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Eye, LogOut, Plus, RefreshCw, Shield, UserPlus, Power } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';

const inr = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;

const Stat = ({ label, value, sub }) => (
  <div className="premium-card" style={{ padding: 16, minWidth: 150, flex: 1 }}>
    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{sub}</div>}
  </div>
);

export function SuperAdminDashboard({ onOpenLibrary }) {
  const { user, logout } = useAuth();
  const [libraries, setLibraries] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', adminEmail: '', adminName: '' });
  const [inviteFor, setInviteFor] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [libs, metrics] = await Promise.all([api.adminLibraries(), api.adminMetrics()]);
      setLibraries(libs); setTotals(metrics.totals);
    } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const createLibrary = async (e) => {
    e.preventDefault();
    try {
      const r = await api.adminCreateLibrary({ name: form.name, adminEmail: form.adminEmail || undefined, adminName: form.adminName || undefined });
      toast.success(`Created ${r.library.name}${r.admin ? ` — ${r.admin.email} can now sign in with Google` : ''}`);
      setForm({ name: '', adminEmail: '', adminName: '' });
      load();
    } catch (err) { toast.error(err.message); }
  };

  const toggleStatus = async (lib) => {
    const status = lib.status === 'Active' ? 'Disabled' : 'Active';
    if (status === 'Disabled' && !window.confirm(`Disable ${lib.name}? Its users will be locked out.`)) return;
    try { await api.adminUpdateLibrary(lib.libraryId, { status }); load(); } catch (e) { toast.error(e.message); }
  };

  const addAdmin = async (e) => {
    e.preventDefault();
    try {
      await api.adminAddLibraryUser(inviteFor.libraryId, { email: inviteEmail, role: 'client_admin' });
      toast.success(`${inviteEmail} added as client admin`);
      setInviteFor(null); setInviteEmail(''); load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div style={{ minHeight: '100vh', overflowY: 'auto' }}>
      <header className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Shield size={22} />
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700 }}>Super Admin — All Libraries</h1>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{user?.email}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> <span>Refresh</span></button>
          <button className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={14} /> <span>Sign out</span></button>
        </div>
      </header>

      <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {totals && (
          <div id="sa-totals" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="Libraries" value={totals.libraries} />
            <Stat label="Seats occupied" value={`${totals.seatsOccupied} / ${totals.seatsTotal}`} />
            <Stat label="Active students" value={totals.studentsActive} sub={`${totals.studentsTotal} total`} />
            <Stat label="Revenue collected" value={inr(totals.revenue)} sub={`${totals.paymentsCount} payments`} />
            <Stat label="Expenses" value={inr(totals.expenses)} />
            <Stat label="Net" value={inr(totals.net)} />
          </div>
        )}

        <div className="premium-card" style={{ padding: 0 }}>
          <div className="table-container">
            <table className="data-grid" style={{ width: '100%' }}>
              <thead>
                <tr><th>Library</th><th>Status</th><th>Client admins</th><th>Seats</th><th>Active students</th><th>Revenue</th><th>Expenses</th><th>Net</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9}>Loading…</td></tr>}
                {!loading && libraries.length === 0 && <tr><td colSpan={9}>No client libraries yet.</td></tr>}
                {libraries.map(l => (
                  <tr key={l.libraryId}>
                    <td><strong>{l.name}</strong><div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{l.libraryId}</div></td>
                    <td><span className={`badge ${l.status === 'Active' ? 'badge-active' : 'badge-expired'}`}>{l.status}</span></td>
                    <td style={{ fontSize: 12 }}>{l.admins.map(a => a.email).join(', ') || '—'}</td>
                    <td>{l.metrics?.seatsOccupied ?? 0} / {l.metrics?.seatsTotal ?? 0}</td>
                    <td>{l.metrics?.studentsActive ?? 0}</td>
                    <td>{inr(l.metrics?.revenue)}</td>
                    <td>{inr(l.metrics?.expenses)}</td>
                    <td>{inr(l.metrics?.net)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" title="View read-only" onClick={() => onOpenLibrary(l, true)}><Eye size={14} /></button>
                      <button className="btn btn-secondary btn-sm" title="Open as admin" onClick={() => onOpenLibrary(l, false)}><Building2 size={14} /> <span>Manage</span></button>
                      <button className="btn btn-ghost btn-sm" title="Add client admin" onClick={() => setInviteFor(l)}><UserPlus size={14} /></button>
                      <button className="btn btn-ghost btn-sm" title={l.status === 'Active' ? 'Disable' : 'Enable'} onClick={() => toggleStatus(l)}><Power size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {inviteFor && (
          <form className="premium-card" style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={addAdmin}>
            <div className="form-group" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
              <label className="form-label">Add client admin to {inviteFor.name} (Google account email)</label>
              <input className="form-input" type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            </div>
            <button className="btn btn-primary" type="submit"><UserPlus size={14} /> <span>Add</span></button>
            <button className="btn btn-ghost" type="button" onClick={() => setInviteFor(null)}>Cancel</button>
          </form>
        )}

        <form className="premium-card" style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={createLibrary}>
          <div className="form-group" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label className="form-label">New library name</label>
            <input className="form-input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label className="form-label">Client admin email (Google)</label>
            <input className="form-input" type="email" value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))} />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label className="form-label">Admin name</label>
            <input className="form-input" value={form.adminName} onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))} />
          </div>
          <button className="btn btn-primary" type="submit"><Plus size={14} /> <span>Create library</span></button>
        </form>
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}

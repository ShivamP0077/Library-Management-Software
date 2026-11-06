import { confirmNameMatches } from '../utils/confirmName';
import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Eye, LogOut, Plus, RefreshCw, Shield, UserPlus, Power, Trash2 } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';
import { LibraryInsights } from './LibraryInsights';
import { PartnersAdmin } from './PartnersAdmin';
import { SupportDesk } from './SupportDesk';
import { PlansAdmin } from './PlansAdmin';
import { PaymentsAdmin } from './PaymentsAdmin';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

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
  const [summary, setSummary] = useState(null);
  const [view, setView] = useState('business');
  const [cityEdit, setCityEdit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', adminEmail: '', adminName: '' });
  const [inviteFor, setInviteFor] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  // Issue #16: permanent delete with the library name typed back.
  const [deleteFor, setDeleteFor] = useState(null);
  const [deleteName, setDeleteName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const nameOk = !!deleteFor && confirmNameMatches(deleteName, deleteFor.name);
  const confirmDelete = async (e) => {
    e.preventDefault();
    if (!deleteFor) return;
    if (!confirmNameMatches(deleteName, deleteFor.name)) { setDeleteError(`Type "${deleteFor.name}" to confirm.`); return; }
    setDeleting(true); setDeleteError('');
    try {
      await api.adminDeleteLibrary(deleteFor.libraryId, deleteName);
      toast.success(`${deleteFor.name} deleted`);
      setDeleteFor(null); setDeleteName(''); load();
    } catch (err) {
      // Shown inside the dialog: a toast can sit behind the full-screen dialog on phones.
      setDeleteError(err?.message || 'Delete failed. Nothing was deleted. Please try again.');
    } finally { setDeleting(false); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [libs, sum] = await Promise.all([api.adminLibraries(), api.adminSaasSummary()]);
      const extra = Object.fromEntries(sum.list.map(x => [x.libraryId, x]));
      setLibraries(libs.map(l => ({ ...l, ...extra[l.libraryId] })));
      setSummary(sum);
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
      <header className="glass-panel sa-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Shield size={22} />
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700 }}>Super Admin — Library OS</h1>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{user?.email}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> <span>Refresh</span></button>
          <button className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={14} /> <span>Sign out</span></button>
        </div>
      </header>

      <main className="sa-main" style={{ padding: 24, maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button role="tab" aria-selected={view === 'business'} className={`btn btn-sm ${view === 'business' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('business')}>Business dashboard</button>
          <button role="tab" aria-selected={view === 'insights'} className={`btn btn-sm ${view === 'insights' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('insights')}>Library Insights &amp; Analytics</button>
          <button role="tab" aria-selected={view === 'partners'} className={`btn btn-sm ${view === 'partners' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('partners')}>Partners &amp; Commissions</button>
          <button role="tab" aria-selected={view === 'plans'} className={`btn btn-sm ${view === 'plans' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('plans')}>Software plans</button>
          <button role="tab" aria-selected={view === 'payments'} className={`btn btn-sm ${view === 'payments' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('payments')}>Payments</button>
          <button role="tab" aria-selected={view === 'support'} className={`btn btn-sm ${view === 'support' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('support')}>Support tickets{summary?.kpis?.support?.value ? ` (${summary.kpis.support.value})` : ''}</button>
        </div>

        {view === 'insights' && <LibraryInsights libraries={libraries} />}
        {view === 'plans' && <PlansAdmin libraries={libraries} onChanged={load} />}
        {view === 'payments' && <PaymentsAdmin />}
        {view === 'partners' && <PartnersAdmin libraries={libraries} onChanged={load} />}
        {view === 'support' && <SupportDesk libraries={libraries} onAccessLibrary={(id) => { const l = libraries.find(x => x.libraryId === id); if (l) onOpenLibrary(l, true); }} />}

        {view === 'business' && summary && (
          <div id="sa-totals" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="Customer libraries" value={summary.libraries.total} sub={`${summary.libraries.active} active • ${summary.libraries.disabled} disabled`} />
            <Stat label="New this month" value={summary.libraries.newThisMonth} />
            <Stat label="Active in last 7 days" value={summary.libraries.activeLast7Days} sub="libraries with a login" />
            <Stat label="Owner / staff logins" value={`${summary.accounts.owners} / ${summary.accounts.staff}`} />
            {Object.entries(summary.kpis || {}).map(([k, v]) => v && !v.error && <Stat key={k} label={v.label || k} value={v.value} sub={v.sub} />)}
          </div>
        )}
        {view === 'business' && summary && (
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
            Subscriptions, trials, upcoming expiries, software revenue, WhatsApp add-on revenue and overdue invoices will appear here once billing is set up. Customer students, seats and fee collections are in Library Insights.
          </p>
        )}

        {view === 'business' && (
        <div className="premium-card sa-table-card" style={{ padding: 0 }}>
          <div className="table-container">
            <table className="data-grid" style={{ width: '100%' }}>
              <thead>
                <tr><th>Owner</th><th>Library</th><th>Subscription</th><th>Expiry</th><th>Payment</th><th>Partner</th><th>Status</th><th>Last active</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9}>Loading…</td></tr>}
                {!loading && libraries.length === 0 && <tr><td colSpan={9}>No client libraries yet.</td></tr>}
                {libraries.map(l => (
                  <tr key={l.libraryId}>
                    <td style={{ fontSize: 12 }}>{l.owner ? <><strong>{l.owner.name || l.owner.email}</strong><div style={{ color: 'var(--text-tertiary)' }}>{l.owner.email}</div></> : (l.admins.map(a => a.email).join(', ') || '—')}</td>
                    <td><strong>{l.name}</strong><div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{l.libraryId}{' • '}
                      {cityEdit?.id === l.libraryId
                        ? <input className="form-input" autoFocus style={{ display: 'inline-block', width: 110, padding: '2px 6px', fontSize: 11 }} value={cityEdit.v} onChange={e => setCityEdit({ id: l.libraryId, v: e.target.value })}
                            onBlur={async () => { try { await api.adminUpdateLibrary(l.libraryId, { city: cityEdit.v }); } catch (e) { toast.error(e.message); } setCityEdit(null); load(); }}
                            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
                        : <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, fontSize: 11, minHeight: 0 }} onClick={() => setCityEdit({ id: l.libraryId, v: l.city || '' })}>{l.city || 'add city'}</button>}
                    </div></td>
                    <td>{l.subscription || '—'}</td>
                    <td>{l.expiry ? fmtDate(l.expiry) : '—'}</td>
                    <td>{l.paymentStatus || '—'}</td>
                    <td style={{ fontSize: 12 }}>{l.partner?.name || '—'}</td>
                    <td><span className={`badge ${l.status === 'Active' ? 'badge-active' : 'badge-expired'}`}>{l.status}</span>{l.deletionRequested && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }} title={l.deletionRequest?.reason || ''}>Deletion requested</div>}</td>
                    <td style={{ fontSize: 12 }}>{fmtDate(l.lastActiveAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" title="View read-only" onClick={() => onOpenLibrary(l, true)}><Eye size={14} /></button>
                      <button className="btn btn-secondary btn-sm" title="Access Library" onClick={() => onOpenLibrary(l, false)}><Building2 size={14} /> <span>Access Library</span></button>
                      <button className="btn btn-ghost btn-sm" title="Add client admin" onClick={() => setInviteFor(l)}><UserPlus size={14} /></button>
                      <button className="btn btn-ghost btn-sm" title={l.status === 'Active' ? 'Disable' : 'Enable'} onClick={() => toggleStatus(l)}><Power size={14} /></button>
                      <button className="btn btn-ghost btn-sm" title="Delete library" aria-label={`Delete ${l.name}`} style={{ color: '#dc2626' }} onClick={() => { setDeleteFor(l); setDeleteName(''); setDeleteError(''); }}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {deleteFor && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Delete library" onClick={() => !deleting && setDeleteFor(null)}>
            <form className="modal-content" style={{ maxWidth: 440, padding: 20 }} onClick={e => e.stopPropagation()} onSubmit={confirmDelete}>
              <h3 style={{ margin: '0 0 8px', color: '#b91c1c' }}>Delete {deleteFor.name}?</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                This permanently deletes this library (ID <strong>{deleteFor.libraryId}</strong>): its students, payments, settings, staff accounts and other data. It cannot be undone. Other libraries are not touched. To only block access, use Disable instead.
              </p>
              <label className="form-label" htmlFor="delete-lib-name">Type <strong>{deleteFor.name}</strong> to confirm</label>
              <input id="delete-lib-name" className="form-input" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" value={deleteName} onChange={e => { setDeleteName(e.target.value); setDeleteError(''); }} aria-describedby="delete-lib-hint" />
              <div id="delete-lib-hint" role={deleteError ? 'alert' : undefined} style={{ fontSize: 12, marginTop: 6, minHeight: 16, color: deleteError ? '#b91c1c' : nameOk ? '#15803d' : 'var(--text-tertiary)' }}>
                {deleteError || (nameOk ? 'Name matches.' : deleteName ? 'Name does not match yet (spelling, capitals and spacing must match exactly).' : '')}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" disabled={deleting} onClick={() => setDeleteFor(null)}>Cancel</button>
                <button type="submit" className="btn btn-danger" style={{ background: '#dc2626', color: '#fff' }} disabled={deleting || !nameOk}>{deleting ? 'Deleting…' : 'Delete permanently'}</button>
              </div>
            </form>
          </div>
        )}
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

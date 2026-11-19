import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';

const STATUSES = ['NEW', 'CONTACTED', 'CLOSED'];
const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function DemoRequestsAdmin() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (applied.trim()) params.set('search', applied.trim());
      const qs = params.toString();
      const list = await api.adminDemoRequests(qs ? `?${qs}` : '');
      const items = Array.isArray(list) ? list : [];
      setRows(items);
      setDrafts(Object.fromEntries(items.map((row) => [row.id, { status: row.status, note: row.note || '' }])));
    } catch (e) {
      toast.error(e.message || 'Could not load demo requests');
    } finally {
      setLoading(false);
    }
  }, [status, applied]);

  useEffect(() => { load(); }, [load]);

  const save = async (id) => {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    try {
      const updated = await api.adminUpdateDemoRequest(id, { status: draft.status, note: draft.note });
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...updated } : row)));
      toast.success('Demo request saved');
    } catch (e) {
      toast.error(e.message || 'Could not save');
    } finally {
      setSavingId('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <form
        onSubmit={(e) => { e.preventDefault(); setApplied(search); }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input
          className="form-input"
          aria-label="Search demo requests"
          placeholder="Search name, mobile, email or city"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 220px', minWidth: 0 }}
        />
        <select className="form-input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ flex: '0 1 160px' }}>
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="submit" className="btn btn-secondary btn-sm">Search</button>
      </form>

      {loading && <p style={{ color: 'var(--text-tertiary)', margin: 0 }}>Loading…</p>}
      {!loading && rows.length === 0 && <p style={{ color: 'var(--text-tertiary)', margin: 0 }}>No demo requests.</p>}

      <div style={{ display: 'grid', gap: 12 }}>
        {rows.map((row) => {
          const draft = drafts[row.id] || { status: row.status, note: row.note || '' };
          return (
            <article key={row.id} className="premium-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{row.libraryName}</h2>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                    {row.city} · {row.seatCapacity} seats · {row.source || 'landing'} · {fmtDate(row.createdAt)}
                  </p>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>{row.status}</span>
              </div>
              <p style={{ margin: 0, fontSize: 14 }}>
                {row.mobile || 'No mobile'} · {row.email || 'No email'}
              </p>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  Status
                  <select
                    className="form-input"
                    aria-label={`Status for ${row.libraryName}`}
                    value={draft.status}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: { ...draft, status: e.target.value } }))}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, gridColumn: '1 / -1' }}>
                  Note
                  <textarea
                    className="form-input"
                    aria-label={`Note for ${row.libraryName}`}
                    rows={2}
                    value={draft.note}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: { ...draft, note: e.target.value } }))}
                  />
                </label>
              </div>
              <div>
                <button type="button" className="btn btn-primary btn-sm" disabled={savingId === row.id} onClick={() => save(row.id)}>
                  {savingId === row.id ? 'Saving…' : 'Save'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, RefreshCw, Search, Lock } from 'lucide-react';
import { api } from '../utils/api';
import { Thread, ReplyBox, StatusBadge, when, formatTicketNumber, priorityLabel, STATUS_LABELS, PRIORITY_LABELS } from '../components/SupportCenter';

const STATUSES = Object.keys(STATUS_LABELS);
const PRIORITIES = Object.keys(PRIORITY_LABELS).filter(k => k !== 'normal');
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** Super Admin support desk: every library's tickets, reply, assign, change status/priority. */
export const SupportDesk = ({ libraries = [], onAccessLibrary }) => {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [lib, setLib] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState(null);
  const [replyStatus, setReplyStatus] = useState('waiting_on_customer');
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const load = useCallback(async ({ append = false, pageNo = 1 } = {}) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (priority) q.set('priority', priority);
    if (lib) q.set('libraryId', lib);
    if (search.trim()) q.set('search', search.trim());
    q.set('page', String(pageNo));
    q.set('limit', '50');
    try {
      const rows = await api.adminTickets(`?${q}`);
      setList(prev => append ? [...prev, ...rows] : rows);
      setPage(pageNo);
      setHasMore(rows.length >= 50);
    } catch (e) { toast.error(e.message); }
  }, [status, priority, lib, search]);
  useEffect(() => { load({ pageNo: 1 }); }, [load]);
  const update = async (patch) => { try { setOpen(await api.adminUpdateTicket(open.id, patch)); toast.success('Updated'); } catch (e) { toast.error(e.message); } };
  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim() || noteBusy) return;
    setNoteBusy(true);
    try { setOpen(await api.adminInternalNote(open.id, { body: note })); setNote(''); toast.success('Internal note saved'); }
    catch (err) { toast.error(err.message || 'Could not save note'); }
    finally { setNoteBusy(false); }
  };

  if (open) return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }} onClick={() => { setOpen(null); load({ pageNo: 1 }); }}><ArrowLeft size={14} /> All tickets</button>
      <div className="glass-panel" style={{ padding: 16, display: 'grid', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{formatTicketNumber(open.number)} {open.subject}</strong><StatusBadge s={open.status} /><span className="badge" style={{ background: '#f3f4f6', color: '#374151' }}>{priorityLabel(open.priority)}</span></div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{libraries.find(l => l.libraryId === open.tenantId)?.name || open.tenantId} • Library ID {open.tenantId} • {open.createdByEmail} • opened {when(open.createdAt)}{open.firstResponseAt && ` • first reply ${when(open.firstResponseAt)}`}{open.legacyAliases?.length ? ` • old #${open.legacyAliases[open.legacyAliases.length - 1].number}` : ''}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <label style={{ fontSize: 13 }}>Status<select className="input-field" value={open.status} onChange={e => update({ status: e.target.value })}>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
          <label style={{ fontSize: 13 }}>Priority<select className="input-field" value={open.priority} onChange={e => update({ priority: e.target.value })}>{PRIORITIES.map(s => <option key={s} value={s}>{PRIORITY_LABELS[s]}</option>)}{!PRIORITIES.includes(open.priority) && <option value={open.priority}>{priorityLabel(open.priority)}</option>}</select></label>
          <label style={{ fontSize: 13 }}>Assigned to<input className="input-field" defaultValue={open.assignedTo || ''} placeholder="support email" onBlur={e => e.target.value !== (open.assignedTo || '') && update({ assignedTo: e.target.value })} /></label>
        </div>
        {onAccessLibrary && <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }} onClick={() => onAccessLibrary(open.tenantId)}>Access Library (read-only, audited)</button>}
      </div>
      <Thread ticket={open} viewer="support" fetchAttachment={(m, a) => api.adminTicketAttachment(open.id, m, a)} />
      <div className="glass-panel" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}><Lock size={14} /> Private internal notes <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: 12 }}>— never visible to the library</span></strong>
        {(open.internalNotes || []).map(n => (
          <div key={n.id} style={{ padding: 8, borderLeft: '3px solid #a855f7', background: '#faf5ff', borderRadius: 6, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.authorEmail} • {when(n.at)}</div>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>{n.body}</div>
          </div>
        ))}
        <form onSubmit={addNote} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="input-field" value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note only the support team can see" style={{ flex: '1 1 220px', minWidth: 0 }} />
          <button className="btn btn-secondary btn-sm" disabled={noteBusy || !note.trim()}>{noteBusy ? 'Saving…' : 'Add internal note'}</button>
        </form>
      </div>
      <ReplyBox placeholder="Reply as Library OS Support…" onSend={async (b) => setOpen(await api.adminReplyTicket(open.id, { ...b, status: replyStatus }))}
        extra={<select className="input-field" style={{ width: 'auto', maxWidth: '100%', minWidth: 0 }} value={replyStatus} onChange={e => setReplyStatus(e.target.value)} aria-label="Status after reply">{STATUSES.map(s => <option key={s} value={s}>then: {STATUS_LABELS[s]}</option>)}</select>} />
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 220px', minWidth: 0 }}>
          <Search size={15} style={{ flexShrink: 0 }} />
          <input className="input-field" value={search} onChange={e => setSearch(e.target.value)} placeholder="Ticket #, subject, library name or ID" style={{ minWidth: 0 }} />
        </label>
        <select className="input-field" style={{ width: 'auto', maxWidth: '100%' }} value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select>
        <select className="input-field" style={{ width: 'auto', maxWidth: '100%' }} value={priority} onChange={e => setPriority(e.target.value)}><option value="">All priorities</option>{PRIORITIES.map(s => <option key={s} value={s}>{PRIORITY_LABELS[s]}</option>)}</select>
        <select className="input-field" style={{ width: 'auto', maxWidth: '100%' }} value={lib} onChange={e => setLib(e.target.value)}><option value="">All libraries</option>{libraries.map(l => <option key={l.libraryId} value={l.libraryId}>{l.name}</option>)}</select>
        <button className="btn btn-secondary btn-sm" onClick={() => load({ pageNo: 1 })}><RefreshCw size={14} /> Refresh</button>
      </div>
      {list.length === 0 ? <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>No tickets.</div>
        : <div style={{ display: 'grid', gap: 8 }}>{list.map(t => (
          <button key={t.id} className="glass-panel" onClick={async () => { try { setOpen(await api.adminTicket(t.id)); } catch (e) { toast.error(e.message); } }} style={{ padding: 12, textAlign: 'left', cursor: 'pointer', border: 0, display: 'grid', gap: 4, minWidth: 0, width: '100%' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ overflowWrap: 'anywhere' }}>{formatTicketNumber(t.number)} {t.subject}</strong><StatusBadge s={t.status} />{['high', 'urgent', 'critical'].includes(t.priority) && <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>{priorityLabel(t.priority)}</span>}</div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{t.libraryName} • {titleCase(t.category)} • {t.assignedTo ? `assigned to ${t.assignedTo}` : 'unassigned'} • updated {when(t.lastMessageAt)}{t.legacyAliases?.length ? ` • old #${t.legacyAliases[t.legacyAliases.length - 1].number}` : ''}</span>
          </button>))}</div>}
      {hasMore && <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'center' }} onClick={() => load({ append: true, pageNo: page + 1 })}>Load more</button>}
    </div>
  );
};

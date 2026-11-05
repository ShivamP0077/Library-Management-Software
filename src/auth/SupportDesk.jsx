import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api } from '../utils/api';
import { Thread, ReplyBox, StatusBadge, when } from '../components/SupportCenter';

const STATUSES = ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** Super Admin support desk: every library's tickets, reply, assign, change status/priority. */
export const SupportDesk = ({ libraries = [], onAccessLibrary }) => {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState('');
  const [lib, setLib] = useState('');
  const [open, setOpen] = useState(null);
  const [replyStatus, setReplyStatus] = useState('waiting_on_customer');
  const load = useCallback(async () => {
    const q = new URLSearchParams(); if (status) q.set('status', status); if (lib) q.set('libraryId', lib);
    try { setList(await api.adminTickets(q.toString() ? `?${q}` : '')); } catch (e) { toast.error(e.message); }
  }, [status, lib]);
  useEffect(() => { load(); }, [load]);
  const update = async (patch) => { try { setOpen(await api.adminUpdateTicket(open.id, patch)); toast.success('Updated'); } catch (e) { toast.error(e.message); } };

  if (open) return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }} onClick={() => { setOpen(null); load(); }}><ArrowLeft size={14} /> All tickets</button>
      <div className="glass-panel" style={{ padding: 16, display: 'grid', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ fontSize: 18, overflowWrap: 'anywhere' }}>#{open.number} {open.subject}</strong><StatusBadge s={open.status} /></div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{libraries.find(l => l.libraryId === open.tenantId)?.name || open.tenantId} • {open.createdByEmail} • opened {when(open.createdAt)}{open.firstResponseAt && ` • first reply ${when(open.firstResponseAt)}`}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <label style={{ fontSize: 13 }}>Status<select className="input-field" value={open.status} onChange={e => update({ status: e.target.value })}>{STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}</select></label>
          <label style={{ fontSize: 13 }}>Priority<select className="input-field" value={open.priority} onChange={e => update({ priority: e.target.value })}>{PRIORITIES.map(s => <option key={s} value={s}>{label(s)}</option>)}</select></label>
          <label style={{ fontSize: 13 }}>Assigned to<input className="input-field" defaultValue={open.assignedTo || ''} placeholder="support email" onBlur={e => e.target.value !== (open.assignedTo || '') && update({ assignedTo: e.target.value })} /></label>
        </div>
        {onAccessLibrary && <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }} onClick={() => onAccessLibrary(open.tenantId)}>Access Library (read-only, audited)</button>}
      </div>
      <Thread ticket={open} fetchAttachment={(m, a) => api.adminTicketAttachment(open.id, m, a)} />
      <ReplyBox placeholder="Reply as Library OS Support…" onSend={async (b) => setOpen(await api.adminReplyTicket(open.id, { ...b, status: replyStatus }))}
        extra={<select className="input-field" style={{ width: 'auto', maxWidth: '100%', minWidth: 0 }} value={replyStatus} onChange={e => setReplyStatus(e.target.value)} aria-label="Status after reply">{STATUSES.map(s => <option key={s} value={s}>then: {label(s)}</option>)}</select>} />
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input-field" style={{ width: 'auto', maxWidth: '100%' }} value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select className="input-field" style={{ width: 'auto', maxWidth: '100%' }} value={lib} onChange={e => setLib(e.target.value)}><option value="">All libraries</option>{libraries.map(l => <option key={l.libraryId} value={l.libraryId}>{l.name}</option>)}</select>
        <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
      </div>
      {list.length === 0 ? <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>No tickets.</div>
        : <div style={{ display: 'grid', gap: 8 }}>{list.map(t => (
          <button key={t.id} className="glass-panel" onClick={async () => { try { setOpen(await api.adminTicket(t.id)); } catch (e) { toast.error(e.message); } }} style={{ padding: 12, textAlign: 'left', cursor: 'pointer', border: 0, display: 'grid', gap: 4, minWidth: 0, width: '100%' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ overflowWrap: 'anywhere' }}>#{t.number} {t.subject}</strong><StatusBadge s={t.status} />{['high', 'urgent'].includes(t.priority) && <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>{t.priority}</span>}</div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{t.libraryName} • {label(t.category)} • {t.assignedTo ? `assigned to ${t.assignedTo}` : 'unassigned'} • updated {when(t.lastMessageAt)}</span>
          </button>))}</div>}
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw, Search, Lock } from 'lucide-react';
import { api } from '../utils/api';
import { ChatThread, StatusBadge, when, formatTicketNumber, priorityLabel, STATUS_LABELS, PRIORITY_LABELS, useWide } from '../components/SupportCenter';

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
  const [notesOpen, setNotesOpen] = useState(false);
  const wide = useWide();
  const load = useCallback(async ({ append = false, pageNo = 1, silent = false } = {}) => {
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
    } catch (e) { if (!silent) toast.error(e.message); }
  }, [status, priority, lib, search]);
  useEffect(() => { load({ pageNo: 1 }); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { load({ pageNo: 1, silent: true }); }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!open?.id) return undefined;
    const id = open.id;
    const timer = setInterval(async () => {
      try {
        const fresh = await api.adminTicket(id, { poll: true });
        setOpen(cur => (cur && cur.id === id ? fresh : cur));
      } catch { /* next poll retries */ }
    }, 10000);
    return () => clearInterval(timer);
  }, [open?.id]);
  const update = async (patch) => { try { setOpen(await api.adminUpdateTicket(open.id, patch)); toast.success('Updated'); } catch (e) { toast.error(e.message); } };
  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim() || noteBusy) return;
    setNoteBusy(true);
    try { setOpen(await api.adminInternalNote(open.id, { body: note })); setNote(''); toast.success('Internal note saved'); }
    catch (err) { toast.error(err.message || 'Could not save note'); }
    finally { setNoteBusy(false); }
  };
  const openTicket = async (id) => {
    try { setOpen(await api.adminTicket(id)); setNotesOpen(false); }
    catch (e) { toast.error(e.message); }
  };
  const showList = !open || wide;
  const libraryName = open ? (libraries.find(l => l.libraryId === open.tenantId)?.name || open.libraryName || open.tenantId) : '';

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {showList && (
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
      )}
      <div className={`support-layout${open && wide ? ' split' : ''}`}>
        {showList && (
          <div className="support-list-col">
            {list.length === 0 ? <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>No tickets.</div>
              : <div style={{ display: 'grid', gap: 8 }}>{list.map(t => (
                <button key={t.id} className="glass-panel" onClick={() => openTicket(t.id)} aria-current={open?.id === t.id ? 'true' : undefined} style={{ padding: 12, textAlign: 'left', cursor: 'pointer', border: open?.id === t.id ? '1px solid #86efac' : 0, display: 'grid', gap: 4, minWidth: 0, width: '100%' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ overflowWrap: 'anywhere' }}>{formatTicketNumber(t.number)} {t.subject}</strong><StatusBadge s={t.status} />{t.unreadCount > 0 && <span className="chat-unread" aria-label={`${t.unreadCount} unread`}>{t.unreadCount}</span>}{['high', 'urgent', 'critical'].includes(t.priority) && <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>{priorityLabel(t.priority)}</span>}</div>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{t.libraryName} • {titleCase(t.category)} • {t.assignedTo ? `assigned to ${t.assignedTo}` : 'unassigned'} • updated {when(t.lastMessageAt)}{t.legacyAliases?.length ? ` • old #${t.legacyAliases[t.legacyAliases.length - 1].number}` : ''}</span>
                </button>))}</div>}
            {hasMore && <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'center' }} onClick={() => load({ append: true, pageNo: page + 1 })}>Load more</button>}
          </div>
        )}
        {open && (
          <ChatThread
            ticket={open}
            viewer="support"
            libraryName={libraryName}
            onBack={() => { setOpen(null); load({ pageNo: 1, silent: true }); }}
            fetchAttachment={(m, a) => api.adminTicketAttachment(open.id, m, a)}
            onSend={async (b) => setOpen(await api.adminReplyTicket(open.id, { ...b, status: replyStatus }))}
            placeholder="Reply as My Library OS Support…"
            headerExtra={(
              <label className="chat-status-control">
                <span className="sr-only">Status</span>
                <select className="input-field" value={open.status} onChange={e => update({ status: e.target.value })} aria-label="Ticket status">{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select>
              </label>
            )}
            toolbar={(
              <div className="chat-toolbar">
                <label style={{ fontSize: 12 }}>Priority<select className="input-field" value={open.priority} onChange={e => update({ priority: e.target.value })}>{PRIORITIES.map(s => <option key={s} value={s}>{PRIORITY_LABELS[s]}</option>)}{!PRIORITIES.includes(open.priority) && <option value={open.priority}>{priorityLabel(open.priority)}</option>}</select></label>
                <label style={{ fontSize: 12, flex: '1 1 140px' }}>Assigned to<input key={open.assignedTo || ''} className="input-field" defaultValue={open.assignedTo || ''} placeholder="support email" onBlur={e => e.target.value !== (open.assignedTo || '') && update({ assignedTo: e.target.value })} /></label>
                {onAccessLibrary && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAccessLibrary(open.tenantId)}>Access Library</button>}
              </div>
            )}
            belowThread={(
              <div className="chat-notes">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotesOpen(v => !v)}><Lock size={14} /> Internal notes ({(open.internalNotes || []).length}) — never visible to the library</button>
                {notesOpen && (
                  <div className="chat-notes-body">
                    {(open.internalNotes || []).map(n => (
                      <div key={n.id} className="chat-note">
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{n.authorEmail} • {when(n.at)}</div>
                        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>{n.body}</div>
                      </div>
                    ))}
                    <form onSubmit={addNote} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input className="input-field" value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note only the support team can see" style={{ flex: '1 1 160px', minWidth: 0 }} />
                      <button className="btn btn-secondary btn-sm" disabled={noteBusy || !note.trim()}>{noteBusy ? 'Saving…' : 'Add internal note'}</button>
                    </form>
                  </div>
                )}
              </div>
            )}
            composerExtra={<select className="input-field chat-reply-status" value={replyStatus} onChange={e => setReplyStatus(e.target.value)} aria-label="Status after reply">{STATUSES.map(s => <option key={s} value={s}>then: {STATUS_LABELS[s]}</option>)}</select>}
          />
        )}
      </div>
    </div>
  );
};

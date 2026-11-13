import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { LifeBuoy, Plus, X, Paperclip, Send, ArrowLeft, Download, Search, RefreshCw } from 'lucide-react';
import { api, downloadFile } from '../utils/api';
import { useLibrary } from '../context/LibraryContext';

export const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 3;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export const STATUS_LABELS = {
  open: 'Open', in_progress: 'In progress', waiting_on_customer: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed',
};
export const PRIORITY_LABELS = {
  low: 'Low', medium: 'Medium', normal: 'Medium', high: 'High', urgent: 'Critical', critical: 'Critical',
};
export const label = (s) => STATUS_LABELS[s] || titleCase(s);
export const priorityLabel = (s) => PRIORITY_LABELS[s] || titleCase(s);
export const formatTicketNumber = (n) => `#${String(Math.max(0, Number(n) || 0)).padStart(6, '0')}`;
export const newClientId = () => (globalThis.crypto?.randomUUID?.() || `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const STATUS_COLORS = { open: ['#eff6ff', '#1e40af'], in_progress: ['#fef9c3', '#854d0e'], waiting_on_customer: ['#ffedd5', '#9a3412'], resolved: ['#dcfce7', '#166534'], closed: ['#f3f4f6', '#374151'] };
export const StatusBadge = ({ s }) => { const [bg, fg] = STATUS_COLORS[s] || STATUS_COLORS.closed; return <span className="badge" style={{ background: bg, color: fg }}>{label(s)}</span>; };

export async function readFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files per message`);
  if (files.reduce((total, f) => total + f.size, 0) > MAX_TOTAL_BYTES) throw new Error('Attachments must be 8 MB or less in total');
  for (const f of files) {
    if (!TYPES.includes(f.type)) throw new Error('Only JPG, PNG, WEBP or PDF files are allowed');
    if (f.size > MAX_BYTES) throw new Error(`${f.name} is larger than 5 MB`);
  }
  return Promise.all(files.map(f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok({ name: f.name, data: r.result }); r.onerror = bad; r.readAsDataURL(f); })));
}

const clock = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
const dayLabel = (d) => {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const today = new Date();
  const yday = new Date();
  yday.setDate(today.getDate() - 1);
  if (dt.toDateString() === today.toDateString()) return 'Today';
  if (dt.toDateString() === yday.toDateString()) return 'Yesterday';
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
export function useWide(min = 960) {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(`(min-width: ${min}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${min}px)`);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [min]);
  return wide;
}

const senderName = (m, mine) => {
  if (mine) return 'You';
  if (m.fromSupport) return 'My Library OS Support';
  return m.authorEmail || 'Library';
};

/** WhatsApp-style ticket thread shared by the library Help & Support screen and the Super Admin desk. */
export const ChatThread = ({
  ticket, viewer = 'owner', onBack, onSend, fetchAttachment,
  libraryName, headerExtra, toolbar, belowThread, composerExtra, placeholder = 'Message',
  disabled = false, successText = 'Sent',
}) => {
  const scrollRef = useRef(null);
  const sig = (ticket.messages || []).map(m => m.id).join('|');
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [ticket.id, sig]);

  let lastDay = '';
  return (
    <section className="chat-thread" aria-label={`Ticket ${formatTicketNumber(ticket.number)}`}>
      <header className="chat-header">
        <button type="button" className="btn btn-ghost btn-sm chat-back" onClick={onBack} aria-label="Back to tickets"><ArrowLeft size={18} /></button>
        <div className="chat-header-main">
          <div className="chat-header-title">
            <strong>{formatTicketNumber(ticket.number)}</strong>
            <span className="chat-subject">{ticket.subject}</span>
            <StatusBadge s={ticket.status} />
          </div>
          {libraryName && <div className="chat-header-sub">{libraryName}</div>}
        </div>
        {headerExtra}
      </header>
      {toolbar}
      <div
        className="chat-scroll support-thread"
        ref={scrollRef}
      >
        {(ticket.messages || []).map(m => {
          const mine = viewer === 'support' ? !!m.fromSupport : !m.fromSupport;
          const day = dayLabel(m.at);
          const showDay = day && day !== lastDay;
          lastDay = day || lastDay;
          return (
            <React.Fragment key={m.id}>
              {showDay && <div className="chat-day"><span>{day}</span></div>}
              <div className={`support-bubble chat-bubble ${mine ? 'mine' : 'theirs'}`}>
                <div className="chat-bubble-name">{senderName(m, mine)}</div>
                {m.body && <div className="chat-bubble-body">{m.body}</div>}
                {m.attachments?.length > 0 && (
                  <div className="chat-bubble-files">
                    {m.attachments.map(a => (
                      <button key={a.id} type="button" className="btn btn-secondary btn-sm" onClick={async () => {
                        try { const f = await fetchAttachment(m.id, a.id); const link = document.createElement('a'); link.href = f.data; link.download = f.name; link.click(); } catch (e) { toast.error(e.message); }
                      }}><Paperclip size={14} /> <span>{a.name}</span></button>
                    ))}
                  </div>
                )}
                <div className="chat-bubble-time">{clock(m.at)}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {belowThread}
      {disabled
        ? <div className="chat-composer chat-composer-note">{composerExtra}</div>
        : <ChatComposer onSend={onSend} placeholder={placeholder} extra={composerExtra} successText={successText} />}
    </section>
  );
};

export const ChatComposer = ({ onSend, disabled, placeholder = 'Message', extra, successText = 'Sent' }) => {
  const [text, setText] = useState('');
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key, setKey] = useState(0);
  const fileId = useId();
  // Kept across retries: a duplicate request returns the already-saved message instead of adding a second one.
  const clientMessageId = useRef(newClientId());
  const send = async (e) => {
    e?.preventDefault?.();
    if (busy || disabled) return;
    if (!String(text || '').trim() && !(files && files.length)) return;
    setBusy(true); setError('');
    try {
      const attachments = await readFiles(files);
      await onSend({ message: text, attachments, clientMessageId: clientMessageId.current });
      // Only after the server confirms the DB write: clear the box and show Sent.
      setText(''); setFiles(null); setKey(k => k + 1);
      clientMessageId.current = newClientId();
      toast.success(successText);
    } catch (err) {
      // Keep the draft and selected files so the user can retry without losing work.
      setError(err.message || 'Could not send');
      toast.error(err.message || 'Could not send');
    } finally { setBusy(false); }
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (!window.matchMedia('(min-width: 768px)').matches) return;
    e.preventDefault();
    send(e);
  };
  const names = Array.from(files || []).map(f => f.name);
  return (
    <form onSubmit={send} className="chat-composer support-composer">
      <input key={key} id={fileId} className="chat-file-input" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={e => setFiles(e.target.files)} disabled={disabled || busy} />
      <label htmlFor={fileId} className="chat-attach" aria-label="Attach a file"><Paperclip size={18} /></label>
      <textarea className="chat-input" rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} disabled={disabled || busy} />
      {extra}
      <button className="chat-send" type="submit" disabled={busy || disabled || (!text.trim() && !files?.length)} aria-label={busy ? 'Sending' : 'Send'} aria-busy={busy}><Send size={18} /></button>
      {(names.length > 0 || error) && (
        <div className="chat-composer-meta">
          {names.length > 0 && <span>{names.join(', ')}</span>}
          {error && <span role="alert">Not sent: {error} <button type="button" className="btn btn-secondary btn-sm" onClick={() => send()} disabled={busy}>Retry</button></span>}
        </div>
      )}
    </form>
  );
};

const NewTicket = ({ meta, onDone }) => {
  const [f, setF] = useState({ subject: '', category: 'general', priority: 'normal', message: '' });
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const clientRequestId = useRef(newClientId());
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const t = await api.createTicket({ ...f, attachments: await readFiles(files), clientRequestId: clientRequestId.current });
      toast.success(`Ticket ${formatTicketNumber(t.number)} created`);
      clientRequestId.current = newClientId();
      onDone(t);
    } catch (err) {
      setError(err.message || 'Could not create ticket');
      toast.error(err.message || 'Could not create ticket');
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="glass-panel" style={{ padding: 16, display: 'grid', gap: 10 }}>
      <strong>New support ticket</strong>
      <input className="input-field" placeholder="Subject" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} required minLength={3} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <label style={{ fontSize: 13 }}>Category<select className="input-field" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{(meta?.categories || ['general']).map(c => <option key={c} value={c}>{titleCase(c)}</option>)}</select></label>
        <label style={{ fontSize: 13 }}>Priority<select className="input-field" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>{(meta?.priorities || ['normal']).map(c => <option key={c} value={c}>{priorityLabel(c)}</option>)}</select></label>
      </div>
      <textarea className="input-field" rows={4} placeholder="What happened? What did you expect?" value={f.message} onChange={e => setF({ ...f, message: e.target.value })} required />
      <label style={{ fontSize: 13 }}>Screenshots or files (JPG, PNG, WEBP, PDF · up to {MAX_FILES} · 5 MB each, 8 MB total)
        <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={e => setFiles(e.target.files)} style={{ display: 'block', maxWidth: '100%', marginTop: 4 }} />
      </label>
      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #dc2626)' }}>Not created: {error}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Create ticket'}</button>
    </form>
  );
};

const ExportCard = () => {
  const { hasPermission } = useLibrary();
  const items = [['students', 'Students'], ['payments', 'Payments'], ['expenses', 'Expenses']].filter(([k]) => hasPermission?.(k, 'view'));
  if (!items.length) return null;
  return (
    <div className="glass-panel" style={{ padding: 16, display: 'grid', gap: 8, minWidth: 0 }}>
      <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Download size={16} /> Export my data</strong>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>CSV files open in Excel or Google Sheets. Only your library's data is included.</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {items.map(([k, l]) => <button key={k} className="btn btn-secondary btn-sm" onClick={() => downloadFile(`/export/${k}.csv`, `${k}.csv`).catch(e => toast.error(e.message))}>{l} (CSV)</button>)}
      </div>
    </div>
  );
};

export const SupportCenter = () => {
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState(null);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', priority: '', search: '' });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const wide = useWide();
  const load = useCallback(async ({ append = false, pageNo = 1, silent = false } = {}) => {
    if (!append && !silent) setLoading(true);
    const q = new URLSearchParams();
    if (filters.status) q.set('status', filters.status);
    if (filters.priority) q.set('priority', filters.priority);
    if (filters.search.trim()) q.set('search', filters.search.trim());
    q.set('page', String(pageNo));
    q.set('limit', '50');
    try {
      const rows = await api.tickets(`?${q}`);
      setList(prev => append ? [...prev, ...rows] : rows);
      setPage(pageNo);
      setHasMore(rows.length >= 50);
    } catch (e) { if (!silent) toast.error(e.message || 'Could not load tickets'); } finally { if (!silent) setLoading(false); }
  }, [filters]);
  const openTicket = useCallback(async (id) => { try { setOpen(await api.ticket(id)); } catch (e) { toast.error(e.message); } }, []);
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
        const fresh = await api.ticket(id);
        setOpen(cur => (cur && cur.id === id ? fresh : cur));
      } catch { /* next poll retries */ }
    }, 10000);
    return () => clearInterval(timer);
  }, [open?.id]);
  useEffect(() => { api.supportMeta().then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    const fromHash = () => { const id = new URLSearchParams(window.location.hash.slice(1)).get('ticket'); if (id) openTicket(id); };
    fromHash(); window.addEventListener('hashchange', fromHash); return () => window.removeEventListener('hashchange', fromHash);
  }, [openTicket]);

  const closeChat = () => {
    setOpen(null);
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    load({ pageNo: 1, silent: true });
  };
  const showList = !open || wide;
  const chat = open && (
    <ChatThread
      ticket={open}
      viewer="owner"
      onBack={closeChat}
      fetchAttachment={(m, a) => api.ticketAttachment(open.id, m, a)}
      onSend={async (b) => setOpen(await api.replyTicket(open.id, b))}
      disabled={open.status === 'closed'}
      placeholder="Message"
      composerExtra={open.status === 'closed'
        ? <><span>This ticket is closed.</span><button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { setOpen(await api.updateTicket(open.id, { status: 'open' })); } catch (e) { toast.error(e.message); } }}>Reopen</button></>
        : <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { setOpen(await api.updateTicket(open.id, { status: 'closed' })); } catch (e) { toast.error(e.message); } }}>Close</button>}
    />
  );

  return (
    <div className="support-center" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      {showList && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><LifeBuoy size={22} /> Help &amp; Support</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Raise a ticket and chat with the My Library OS support team.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(c => !c)}>{creating ? <X size={14} /> : <Plus size={14} />} New ticket</button>
      </div>}
      {creating && showList && <NewTicket meta={meta} onDone={(t) => { setCreating(false); setOpen(t); load({ pageNo: 1 }); }} />}
      <div className={`support-layout${open && wide ? ' split' : ''}`}>
      {showList && <div className="support-list-col">
      <div className="support-filters" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 220px', minWidth: 0 }}>
          <Search size={15} style={{ flexShrink: 0 }} />
          <input className="input-field" placeholder="Search number or subject" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} style={{ minWidth: 0 }} />
        </label>
        <select className="input-field" style={{ width: 'auto', maxWidth: '100%' }} value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">All statuses</option>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input-field" style={{ width: 'auto', maxWidth: '100%' }} value={filters.priority} onChange={e => setFilters({ ...filters, priority: e.target.value })}><option value="">All priorities</option>{Object.entries(PRIORITY_LABELS).filter(([k]) => k !== 'normal').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn btn-secondary btn-sm" onClick={() => load({ pageNo: 1 })} aria-label="Refresh tickets"><RefreshCw size={14} /> Refresh</button>
      </div>
      {loading ? <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
        : list.length === 0 ? <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>No tickets yet.</div>
        : <div style={{ display: 'grid', gap: 8 }}>{list.map(t => (
          <button key={t.id} className="glass-panel" onClick={() => openTicket(t.id)} aria-current={open?.id === t.id ? 'true' : undefined} style={{ padding: 12, textAlign: 'left', cursor: 'pointer', border: open?.id === t.id ? '1px solid #86efac' : 0, display: 'grid', gap: 4, minWidth: 0, width: '100%' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ overflowWrap: 'anywhere' }}>{formatTicketNumber(t.number)} {t.subject}</strong><StatusBadge s={t.status} />{t.unreadCount > 0 && <span className="chat-unread" aria-label={`${t.unreadCount} unread`}>{t.unreadCount}</span>}{(t.priority === 'high' || t.priority === 'urgent' || t.priority === 'critical') && <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>{priorityLabel(t.priority)}</span>}</div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{titleCase(t.category)} • {t.messageCount} message(s) • updated {when(t.lastMessageAt)}{t.legacyAliases?.length ? ` • old #${t.legacyAliases[t.legacyAliases.length - 1].number}` : ''}</span>
          </button>))}</div>}
      {hasMore && <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'center' }} onClick={() => load({ append: true, pageNo: page + 1 })}>Load more</button>}
      <ExportCard />
      </div>}
      {chat}
      </div>
    </div>
  );
};

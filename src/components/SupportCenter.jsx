import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { LifeBuoy, Plus, X, Paperclip, Send, ArrowLeft, Download, Search, RefreshCw } from 'lucide-react';
import { api, downloadFile } from '../utils/api';
import { SUPPORT_EMAIL } from '../utils/support';
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

export const Thread = ({ ticket, fetchAttachment, viewer = 'owner' }) => (
  <div className="support-thread" style={{ display: 'grid', gap: 10, minWidth: 0 }}>
    {(ticket.messages || []).map(m => {
      const mine = viewer === 'support' ? m.fromSupport : !m.fromSupport;
      return (
        <div key={m.id} className="glass-panel support-bubble" style={{
          padding: 12, minWidth: 0, maxWidth: 'min(88%, 720px)', justifySelf: mine ? 'end' : 'start',
          borderLeft: mine ? '4px solid #9ca3af' : '4px solid #2563eb',
          background: mine ? 'var(--bg-surface, #fff)' : '#f8fbff',
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{m.fromSupport ? 'My Library OS Support' : (m.authorEmail || 'Library')}</strong>
            <span>• {when(m.at)}</span>
            <span>• {m.status === 'sent' ? 'Sent' : titleCase(m.status || 'sent')}</span>
          </div>
          {m.body && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 6, fontSize: 14 }}>{m.body}</div>}
          {m.attachments?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {m.attachments.map(a => (
                <button key={a.id} type="button" className="btn btn-secondary btn-sm" style={{ maxWidth: '100%' }} onClick={async () => {
                  try { const f = await fetchAttachment(m.id, a.id); const link = document.createElement('a'); link.href = f.data; link.download = f.name; link.click(); } catch (e) { toast.error(e.message); }
                }}><Paperclip size={14} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span></button>
              ))}
            </div>
          )}
        </div>
      );
    })}
  </div>
);

export const ReplyBox = ({ onSend, disabled, placeholder = 'Write a reply…', extra, successText = 'Reply sent', viewer = 'owner' }) => {
  const [text, setText] = useState('');
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key, setKey] = useState(0);
  // Kept across retries: a duplicate request returns the already-saved message instead of adding a second one.
  const clientMessageId = useRef(newClientId());
  const send = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
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
  return (
    <form onSubmit={send} className="glass-panel support-composer" style={{ padding: 12, display: 'grid', gap: 8, minWidth: 0 }}>
      <textarea className="input-field" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} disabled={disabled} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <input key={key} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={e => setFiles(e.target.files)} disabled={disabled} style={{ maxWidth: '100%', fontSize: 13 }} />
        <div className="reply-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>{extra}<button className="btn btn-primary btn-sm" disabled={busy || disabled || (!text.trim() && !files?.length)} aria-busy={busy}><Send size={14} /> {busy ? 'Sending…' : 'Send'}</button></div>
      </div>
      {error && <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', fontSize: 13, color: 'var(--danger, #dc2626)' }}>
        <span>Not sent: {error}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => send()} disabled={busy}>Retry</button>
      </div>}
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
  const load = useCallback(async ({ append = false, pageNo = 1 } = {}) => {
    if (!append) setLoading(true);
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
    } catch (e) { toast.error(e.message || 'Could not load tickets'); } finally { setLoading(false); }
  }, [filters]);
  const openTicket = useCallback(async (id) => { try { setOpen(await api.ticket(id)); } catch (e) { toast.error(e.message); } }, []);
  useEffect(() => { load({ pageNo: 1 }); }, [load]);
  useEffect(() => { api.supportMeta().then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    const fromHash = () => { const id = new URLSearchParams(window.location.hash.slice(1)).get('ticket'); if (id) openTicket(id); };
    fromHash(); window.addEventListener('hashchange', fromHash); return () => window.removeEventListener('hashchange', fromHash);
  }, [openTicket]);

  if (open) return (
    <div className="support-center" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }} onClick={() => { setOpen(null); if (window.location.hash) window.history.replaceState(null, '', window.location.pathname); load({ pageNo: 1 }); }}><ArrowLeft size={14} /> All tickets</button>
      <div className="glass-panel" style={{ padding: 16, display: 'grid', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{formatTicketNumber(open.number)} {open.subject}</strong><StatusBadge s={open.status} /><span className="badge" style={{ background: '#f3f4f6', color: '#374151' }}>{priorityLabel(open.priority)}</span></div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{titleCase(open.category)} • {priorityLabel(open.priority)} priority • opened {when(open.createdAt)} by {open.createdByEmail}{open.firstResponseAt && ` • first reply ${when(open.firstResponseAt)}`}{open.resolvedAt && ` • resolved ${when(open.resolvedAt)}`}{open.closedAt && ` • closed ${when(open.closedAt)}`}</div>
      </div>
      <Thread ticket={open} viewer="owner" fetchAttachment={(m, a) => api.ticketAttachment(open.id, m, a)} />
      {open.status === 'closed'
        ? <div className="glass-panel" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><span style={{ fontSize: 13 }}>This ticket is closed.</span><button className="btn btn-secondary btn-sm" onClick={async () => { try { setOpen(await api.updateTicket(open.id, { status: 'open' })); } catch (e) { toast.error(e.message); } }}>Reopen</button></div>
        : <ReplyBox viewer="owner" onSend={async (b) => setOpen(await api.replyTicket(open.id, b))}
            extra={<button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { setOpen(await api.updateTicket(open.id, { status: 'closed' })); } catch (e) { toast.error(e.message); } }}>Close ticket</button>} />}
    </div>
  );

  return (
    <div className="support-center" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><LifeBuoy size={22} /> Help &amp; Support</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Raise a ticket and chat with the My Library OS support team. Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(c => !c)}>{creating ? <X size={14} /> : <Plus size={14} />} New ticket</button>
      </div>
      {creating && <NewTicket meta={meta} onDone={(t) => { setCreating(false); setOpen(t); load({ pageNo: 1 }); }} />}
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
          <button key={t.id} className="glass-panel" onClick={() => openTicket(t.id)} style={{ padding: 12, textAlign: 'left', cursor: 'pointer', border: 0, display: 'grid', gap: 4, minWidth: 0, width: '100%' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ overflowWrap: 'anywhere' }}>{formatTicketNumber(t.number)} {t.subject}</strong><StatusBadge s={t.status} />{(t.priority === 'high' || t.priority === 'urgent' || t.priority === 'critical') && <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>{priorityLabel(t.priority)}</span>}</div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{titleCase(t.category)} • {t.messageCount} message(s) • updated {when(t.lastMessageAt)}{t.legacyAliases?.length ? ` • old #${t.legacyAliases[t.legacyAliases.length - 1].number}` : ''}</span>
          </button>))}</div>}
      {hasMore && <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'center' }} onClick={() => load({ append: true, pageNo: page + 1 })}>Load more</button>}
      <ExportCard />
    </div>
  );
};

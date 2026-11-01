import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { LifeBuoy, Plus, X, Paperclip, Send, ArrowLeft, Download } from 'lucide-react';
import { api, downloadFile } from '../utils/api';
import { useLibrary } from '../context/LibraryContext';

export const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_BYTES = 5 * 1024 * 1024;
const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const STATUS_COLORS = { open: ['#eff6ff', '#1e40af'], in_progress: ['#fef9c3', '#854d0e'], waiting_on_customer: ['#ffedd5', '#9a3412'], resolved: ['#dcfce7', '#166534'], closed: ['#f3f4f6', '#374151'] };
export const StatusBadge = ({ s }) => { const [bg, fg] = STATUS_COLORS[s] || STATUS_COLORS.closed; return <span className="badge" style={{ background: bg, color: fg }}>{label(s)}</span>; };

export async function readFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length > 3) throw new Error('At most 3 files per message');
  for (const f of files) {
    if (!TYPES.includes(f.type)) throw new Error('Only JPG, PNG, WEBP or PDF files are allowed');
    if (f.size > MAX_BYTES) throw new Error(`${f.name} is larger than 5 MB`);
  }
  return Promise.all(files.map(f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok({ name: f.name, data: r.result }); r.onerror = bad; r.readAsDataURL(f); })));
}

export const Thread = ({ ticket, fetchAttachment }) => (
  <div style={{ display: 'grid', gap: 10 }}>
    {(ticket.messages || []).map(m => (
      <div key={m.id} className="glass-panel" style={{ padding: 12, minWidth: 0, borderLeft: `4px solid ${m.fromSupport ? '#2563eb' : '#9ca3af'}`, background: m.fromSupport ? '#f8fbff' : undefined }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{m.fromSupport ? 'Library OS Support' : m.authorEmail}</strong><span>• {when(m.at)}</span>
        </div>
        {m.body && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 6, fontSize: 14 }}>{m.body}</div>}
        {m.attachments?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {m.attachments.map(a => (
              <button key={a.id} className="btn btn-secondary btn-sm" style={{ maxWidth: '100%' }} onClick={async () => {
                try { const f = await fetchAttachment(m.id, a.id); const link = document.createElement('a'); link.href = f.data; link.download = f.name; link.click(); } catch (e) { toast.error(e.message); }
              }}><Paperclip size={14} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span></button>
            ))}
          </div>
        )}
      </div>
    ))}
  </div>
);

export const ReplyBox = ({ onSend, disabled, placeholder = 'Write a reply…', extra }) => {
  const [text, setText] = useState('');
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const attachments = await readFiles(files); await onSend({ message: text, attachments }); setText(''); setFiles(null); setKey(k => k + 1); }
    catch (err) { toast.error(err.message || 'Could not send'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={send} className="glass-panel" style={{ padding: 12, display: 'grid', gap: 8 }}>
      <textarea className="input-field" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} disabled={disabled} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <input key={key} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={e => setFiles(e.target.files)} disabled={disabled} style={{ maxWidth: '100%', fontSize: 13 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{extra}<button className="btn btn-primary btn-sm" disabled={busy || disabled || (!text.trim() && !files?.length)}><Send size={14} /> Send</button></div>
      </div>
    </form>
  );
};

const NewTicket = ({ meta, onDone }) => {
  const [f, setF] = useState({ subject: '', category: 'general', priority: 'normal', message: '' });
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const t = await api.createTicket({ ...f, attachments: await readFiles(files) }); toast.success(`Ticket #${t.number} created`); onDone(t); }
    catch (err) { toast.error(err.message || 'Could not create ticket'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="glass-panel" style={{ padding: 16, display: 'grid', gap: 10 }}>
      <strong>New support ticket</strong>
      <input className="input-field" placeholder="Subject" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} required minLength={3} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <label style={{ fontSize: 13 }}>Category<select className="input-field" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{(meta?.categories || ['general']).map(c => <option key={c} value={c}>{label(c)}</option>)}</select></label>
        <label style={{ fontSize: 13 }}>Priority<select className="input-field" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>{(meta?.priorities || ['normal']).map(c => <option key={c} value={c}>{label(c)}</option>)}</select></label>
      </div>
      <textarea className="input-field" rows={4} placeholder="What happened? What did you expect?" value={f.message} onChange={e => setF({ ...f, message: e.target.value })} required />
      <label style={{ fontSize: 13 }}>Screenshots or files (JPG, PNG, WEBP, PDF · up to 3 · 5 MB each)
        <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={e => setFiles(e.target.files)} style={{ display: 'block', maxWidth: '100%', marginTop: 4 }} />
      </label>
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
  const load = useCallback(async () => {
    setLoading(true);
    try { setList(await api.tickets()); } catch (e) { toast.error(e.message || 'Could not load tickets'); } finally { setLoading(false); }
  }, []);
  const openTicket = useCallback(async (id) => { try { setOpen(await api.ticket(id)); } catch (e) { toast.error(e.message); } }, []);
  useEffect(() => { load(); api.supportMeta().then(setMeta).catch(() => {}); }, [load]);
  useEffect(() => {
    const fromHash = () => { const id = new URLSearchParams(window.location.hash.slice(1)).get('ticket'); if (id) openTicket(id); };
    fromHash(); window.addEventListener('hashchange', fromHash); return () => window.removeEventListener('hashchange', fromHash);
  }, [openTicket]);

  if (open) return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }} onClick={() => { setOpen(null); if (window.location.hash) window.history.replaceState(null, '', window.location.pathname); load(); }}><ArrowLeft size={14} /> All tickets</button>
      <div className="glass-panel" style={{ padding: 16, display: 'grid', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ fontSize: 18, overflowWrap: 'anywhere' }}>#{open.number} {open.subject}</strong><StatusBadge s={open.status} /></div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label(open.category)} • {label(open.priority)} priority • opened {when(open.createdAt)} by {open.createdByEmail}{open.firstResponseAt && ` • first reply ${when(open.firstResponseAt)}`}{open.resolvedAt && ` • resolved ${when(open.resolvedAt)}`}{open.closedAt && ` • closed ${when(open.closedAt)}`}</div>
      </div>
      <Thread ticket={open} fetchAttachment={(m, a) => api.ticketAttachment(open.id, m, a)} />
      {open.status === 'closed'
        ? <div className="glass-panel" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><span style={{ fontSize: 13 }}>This ticket is closed.</span><button className="btn btn-secondary btn-sm" onClick={async () => { try { setOpen(await api.updateTicket(open.id, { status: 'open' })); } catch (e) { toast.error(e.message); } }}>Reopen</button></div>
        : <ReplyBox onSend={async (b) => setOpen(await api.replyTicket(open.id, b))}
            extra={<button type="button" className="btn btn-secondary btn-sm" onClick={async () => { try { setOpen(await api.updateTicket(open.id, { status: 'closed' })); } catch (e) { toast.error(e.message); } }}>Close ticket</button>} />}
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><LifeBuoy size={22} /> Help &amp; Support</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Raise a ticket and chat with the Library OS support team.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(c => !c)}>{creating ? <X size={14} /> : <Plus size={14} />} New ticket</button>
      </div>
      {creating && <NewTicket meta={meta} onDone={(t) => { setCreating(false); setOpen(t); load(); }} />}
      {loading ? <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
        : list.length === 0 ? <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>No tickets yet.</div>
        : <div style={{ display: 'grid', gap: 8 }}>{list.map(t => (
          <button key={t.id} className="glass-panel" onClick={() => openTicket(t.id)} style={{ padding: 12, textAlign: 'left', cursor: 'pointer', border: 0, display: 'grid', gap: 4, minWidth: 0, width: '100%' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ overflowWrap: 'anywhere' }}>#{t.number} {t.subject}</strong><StatusBadge s={t.status} /></div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label(t.category)} • {t.messageCount} message(s) • updated {when(t.lastMessageAt)}</span>
          </button>))}</div>}
      <ExportCard />
    </div>
  );
};

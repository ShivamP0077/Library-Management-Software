import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Bell, AlertTriangle, CheckCircle2, RefreshCw, Paperclip, Plus, X } from 'lucide-react';
import { api } from '../utils/api';
import { openNotificationLink } from '../utils/notificationLinks';
import { DocPreview } from './DocPreview';

const SEV = { critical: { bg: '#fee2e2', fg: '#991b1b' }, important: { bg: '#fef9c3', fg: '#854d0e' }, info: { bg: '#eff6ff', fg: '#1e40af' } };
const FILTERS = [
  { id: 'action', label: 'Action Required' },
  { id: 'unread', label: 'Unread' },
  { id: 'all', label: 'All' },
  { id: 'resolved', label: 'Resolved' },
];
const changed = () => window.dispatchEvent(new Event('notifications:changed'));
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');

const NoticeForm = ({ onDone }) => {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return undefined; }
    const u = URL.createObjectURL(file); setPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const submit = async (e) => {
    e.preventDefault();
    if (file && !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) return toast.error('Only JPG, PNG, WEBP or PDF files are allowed');
    if (file && file.size > 5 * 1024 * 1024) return toast.error('File is larger than 5 MB');
    setBusy(true);
    try {
      let attachment;
      if (file) attachment = { name: file.name, data: await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); }) };
      await api.createNotice({ title, summary, attachment });
      toast.success('Notice added to Action Required');
      onDone();
    } catch (err) { toast.error(err.message || 'Could not save notice'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="glass-panel" style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 10 }}>
      <strong>New notice / letter</strong>
      <input className="form-input" placeholder="Title (e.g. Electricity board letter)" value={title} onChange={e => setTitle(e.target.value)} required minLength={3} maxLength={140} />
      <textarea className="form-input" placeholder="Short summary (optional)" rows={3} value={summary} onChange={e => setSummary(e.target.value)} maxLength={2000} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="btn btn-secondary btn-sm" style={{ margin: 0, cursor: 'pointer' }}>{file ? 'Change file' : 'Attach file'}
          <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={e => { setFile(e.target.files?.[0] || null); e.target.value = ''; }} style={{ display: 'none' }} />
        </label>
        <label className="btn btn-secondary btn-sm" style={{ margin: 0, cursor: 'pointer' }} aria-label="Take photo of notice">Camera
          <input type="file" accept="image/*" capture="environment" onChange={e => { setFile(e.target.files?.[0] || null); e.target.value = ''; }} style={{ display: 'none' }} />
        </label>
        {file && <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(true)} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)} style={{ color: 'var(--status-error, #dc2626)' }}>Remove</button>
        </>}
      </div>
      {preview && file && <DocPreview src={previewUrl} name={file.name} fileType={file.type} onClose={() => setPreview(false)} onRemove={() => { setFile(null); setPreview(false); }} />}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save notice'}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
};

export const NotificationItem = ({ n, setActiveTab, onChanged, compact = false }) => {
  const sev = SEV[n.severity] || SEV.info;
  const act = async (fn, msg) => { try { await fn(); if (msg) toast.success(msg); onChanged(); changed(); } catch (e) { toast.error(e.message || 'Failed'); } };
  const open = async () => {
    if (!n.read) api.markNotificationRead(n.id).then(changed).catch(() => {});
    openNotificationLink(n.link, setActiveTab);
  };
  const download = async () => {
    try {
      const a = await api.notificationAttachment(n.id);
      const link = document.createElement('a'); link.href = a.data; link.download = a.name; link.click();
    } catch (e) { toast.error(e.message || 'Could not open file'); }
  };
  return (
    <div className="glass-panel notification-item" style={{ padding: compact ? 12 : 14, display: 'flex', gap: 12, alignItems: 'flex-start', borderLeft: `4px solid ${sev.fg}`, opacity: n.status === 'resolved' ? 0.7 : 1, minWidth: 0 }}>
      <div style={{ color: sev.fg, flexShrink: 0, paddingTop: 2 }}>{n.actionRequired && n.status === 'open' ? <AlertTriangle size={18} /> : <Bell size={18} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={open} style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: n.link?.tab ? 'pointer' : 'default', fontWeight: n.read ? 500 : 700, color: 'var(--text-primary)', fontSize: 14, overflowWrap: 'anywhere' }}>{n.title}</button>
          <span className="badge" style={{ background: sev.bg, color: sev.fg }}>{n.severity}</span>
          {n.notifyCount > 1 && <span className="badge" style={{ background: '#f3f4f6', color: '#374151' }}>×{n.notifyCount}</span>}
        </div>
        {n.body && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, overflowWrap: 'anywhere' }}>{n.body}</div>}
        <div style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)', marginTop: 4 }}>
          {n.category} • {when(n.at || n.createdAt)}{n.status === 'resolved' && ` • resolved by ${n.resolvedBy || '—'}${n.resolution ? `: ${n.resolution}` : ''}`}
        </div>
        {!compact && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {n.attachment && <button className="btn btn-secondary btn-sm" onClick={download}><Paperclip size={14} /> {n.attachment.name}</button>}
            {n.status === 'open' && <button className="btn btn-secondary btn-sm" onClick={() => act(() => api.markNotificationRead(n.id, n.read), n.read ? 'Marked unread' : null)}>{n.read ? 'Mark unread' : 'Mark read'}</button>}
            {n.status === 'open' && n.actionRequired && (
              <button className="btn btn-primary btn-sm" onClick={() => { const r = window.prompt('How was this resolved? (optional)', ''); if (r !== null) act(() => api.resolveNotification(n.id, r), 'Marked resolved'); }}>
                <CheckCircle2 size={14} /> Resolve
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const NotificationsCenter = ({ setActiveTab }) => {
  const [filter, setFilter] = useState('action');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const q = filter === 'action' ? '?actionRequired=true' : filter === 'unread' ? '?unread=true&status=open' : filter === 'resolved' ? '?status=resolved' : '';
    try { setList(await api.notifications(q)); } catch (e) { toast.error(e.message || 'Could not load notifications'); } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  const refresh = async () => { try { await api.refreshNotifications(); await load(); changed(); } catch (e) { toast.error(e.message || 'Refresh failed'); } };
  const readAll = async () => { try { await api.markAllNotificationsRead(); await load(); changed(); } catch (e) { toast.error(e.message); } };
  return (
    <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Notifications</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Alerts, reminders and notices that need your attention.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={refresh}><RefreshCw size={14} /> Check now</button>
          <button className="btn btn-secondary btn-sm" onClick={readAll}>Mark all read</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>{showForm ? <X size={14} /> : <Plus size={14} />} Notice</button>
        </div>
      </div>
      {showForm && <NoticeForm onDone={() => { setShowForm(false); load(); changed(); }} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.id} className={`btn btn-sm ${filter === f.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      {loading ? <div style={{ color: 'var(--text-secondary)' }}>Loading…</div>
        : list.length === 0 ? <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>Nothing here. You're all caught up.</div>
        : <div style={{ display: 'grid', gap: 10 }}>{list.map(n => <NotificationItem key={n.id} n={n} setActiveTab={setActiveTab} onChanged={load} />)}</div>}
    </div>
  );
};

/** Compact Action Required card for the Dashboard. */
export const ActionRequiredCard = ({ setActiveTab }) => {
  const [list, setList] = useState(null);
  const load = useCallback(() => { api.notifications('?actionRequired=true&limit=5').then(setList).catch(() => setList([])); }, []);
  useEffect(() => { load(); window.addEventListener('notifications:changed', load); return () => window.removeEventListener('notifications:changed', load); }, [load]);
  if (!list || list.length === 0) return null;
  return (
    <div className="glass-panel" id="action-required-card" style={{ padding: 16, display: 'grid', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#991b1b' }}><AlertTriangle size={18} /> Action Required ({list.length}{list.length === 5 ? '+' : ''})</strong>
        <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('notifications')}>View all</button>
      </div>
      {list.map(n => <NotificationItem key={n.id} n={n} compact setActiveTab={setActiveTab} onChanged={load} />)}
    </div>
  );
};

import React, { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Bell, AlertTriangle, CheckCircle2, RefreshCw, Paperclip, Plus, X } from 'lucide-react';
import { api } from '../utils/api';
import { openNotificationLink } from '../utils/notificationLinks';
import { DocPreview } from './DocPreview';
import { useLibrary } from '../context/LibraryContext';
import { todayIST } from '../utils/dateUtils';
import {
  dismissalStorageKey, normalizeDismissals, partitionActions, restoreItem, skipItem, snoozeItem,
} from '../utils/actionDismissals';

const SEV = { critical: { bg: '#fee2e2', fg: '#991b1b' }, important: { bg: '#fef9c3', fg: '#854d0e' }, info: { bg: '#eff6ff', fg: '#1e40af' } };
const FILTERS = [
  { id: 'action', label: 'Action Required' },
  { id: 'unread', label: 'Unread' },
  { id: 'all', label: 'All' },
  { id: 'resolved', label: 'Resolved' },
];
const changed = () => window.dispatchEvent(new Event('notifications:changed'));
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');

const NOTICE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_NOTICE_FILES = 8;
const MAX_NOTICE_BYTES = 5 * 1024 * 1024;
const MAX_NOTICE_TOTAL = 10 * 1024 * 1024;
const newRequestId = () => (globalThis.crypto?.randomUUID?.() || `notice-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const validateNoticeFiles = (files) => {
  if (files.length > MAX_NOTICE_FILES) throw new Error(`At most ${MAX_NOTICE_FILES} files per notice`);
  files.forEach(validateNoticeFile);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_NOTICE_TOTAL) throw new Error('Files must be 10 MB or less in total. Remove a file or use smaller files.');
};
const validateNoticeFile = (file) => {
  if (!NOTICE_TYPES.includes(file.type)) throw new Error('Only JPG, PNG, WEBP or PDF files are allowed');
  if (file.size > MAX_NOTICE_BYTES) throw new Error(`${file.name} is larger than 5 MB`);
};
const readNoticeFile = (file) => new Promise((ok, bad) => {
  const r = new FileReader(); r.onload = () => ok({ name: file.name, data: r.result }); r.onerror = bad; r.readAsDataURL(file);
});
const FileThumb = ({ file }) => {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file.type.startsWith('image/')) { setUrl(null); return undefined; }
    const u = URL.createObjectURL(file); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <img src={url} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6 }} /> : <Paperclip size={18} />;
};

const NoticeForm = ({ onDone }) => {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [files, setFiles] = useState([]); // [{ key, file }]
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // { key, file }
  const [previewUrl, setPreviewUrl] = useState(null);
  // Stable across retries: the server returns the existing notice instead of creating duplicates.
  const clientRequestId = useRef(newRequestId());
  const nextKey = useRef(0);
  useEffect(() => {
    if (!preview) { setPreviewUrl(null); return undefined; }
    const u = URL.createObjectURL(preview.file); setPreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [preview]);
  const addFiles = (list) => {
    const arr = Array.from(list || []);
    if (!arr.length) return;
    try {
      validateNoticeFiles([...files.map(f => f.file), ...arr]);
      const next = [...files, ...arr.map(file => ({ key: nextKey.current++, file }))];
      if (next.length > MAX_NOTICE_FILES) throw new Error(`At most ${MAX_NOTICE_FILES} files per notice`);
      setFiles(next);
    } catch (e) { toast.error(e.message); }
  };
  const removeFile = (key) => {
    setFiles(prev => prev.filter(f => f.key !== key));
    setPreview(prev => (prev?.key === key ? null : prev));
  };
  const replaceFile = (key, file) => {
    if (!file) return;
    try { validateNoticeFiles(files.map(f => f.key === key ? file : f.file)); setFiles(prev => prev.map(f => (f.key === key ? { ...f, file } : f))); }
    catch (e) { toast.error(e.message); }
  };
  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const attachments = await Promise.all(files.map(f => readNoticeFile(f.file)));
      await api.createNotice({ title, summary, attachments, clientRequestId: clientRequestId.current }, { retries: 3 });
      toast.success('Notice added to Action Required');
      clientRequestId.current = newRequestId();
      onDone();
    } catch (err) {
      // Keep the title, summary and every selected file so the user can retry safely.
      setError(err.message || 'Could not save notice');
      toast.error(err.message || 'Could not save notice');
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="glass-panel" style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 10 }}>
      <strong>New notice / letter</strong>
      <input className="form-input" placeholder="Title (e.g. Electricity board letter)" value={title} onChange={e => setTitle(e.target.value)} required minLength={3} maxLength={140} />
      <textarea className="form-input" placeholder="Short summary (optional)" rows={3} value={summary} onChange={e => setSummary(e.target.value)} maxLength={2000} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="btn btn-secondary btn-sm" style={{ margin: 0, cursor: 'pointer' }}>Attach files
          <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
        </label>
        <label className="btn btn-secondary btn-sm" style={{ margin: 0, cursor: 'pointer' }} aria-label="Take photo of notice">Camera
          <input type="file" accept="image/*" capture="environment" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
        </label>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Up to {MAX_NOTICE_FILES} files · 5 MB each · 10 MB total</span>
      </div>
      {files.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {files.map(({ key, file }) => (
            <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 6, border: '1px solid var(--border-light)', borderRadius: 8, minWidth: 0 }}>
              <FileThumb file={file} />
              <span style={{ flex: '1 1 140px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{file.name}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview({ key, file })}>Preview</button>
              <label className="btn btn-ghost btn-sm" style={{ margin: 0, cursor: 'pointer' }}>Replace
                <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={e => { replaceFile(key, e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
              </label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeFile(key)} style={{ color: 'var(--status-error, #dc2626)' }}>Remove</button>
            </div>
          ))}
        </div>
      )}
      {preview && previewUrl && <DocPreview src={previewUrl} name={preview.file.name} fileType={preview.file.type} onClose={() => setPreview(null)} onRemove={() => removeFile(preview.key)} />}
      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #dc2626)' }}>Not saved: {error}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save notice'}</button>
        {error && <button type="button" className="btn btn-secondary btn-sm" onClick={submit} disabled={busy}>Retry</button>}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDone} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
};

export const NotificationItem = ({ n, setActiveTab, onChanged, compact = false, onLater, onSkip, onRestore }) => {
  const sev = SEV[n.severity] || SEV.info;
  const act = async (fn, msg) => { try { await fn(); if (msg) toast.success(msg); onChanged(); changed(); } catch (e) { toast.error(e.message || 'Failed'); } };
  const open = async () => {
    if (!n.read) api.markNotificationRead(n.id).then(changed).catch(() => {});
    openNotificationLink(n.link, setActiveTab);
  };
  const noticeFiles = n.attachments?.length ? n.attachments : (n.attachment ? [n.attachment] : []);
  const download = async (attachmentId) => {
    try {
      const a = attachmentId === 'legacy' ? await api.notificationAttachment(n.id) : await api.notificationAttachments(n.id, attachmentId);
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
        {compact && (onLater || onSkip || onRestore) && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {onLater && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onLater(n)}>Later</button>}
            {onSkip && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSkip(n)}>Skip</button>}
            {onRestore && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRestore(n)}>Restore</button>}
          </div>
        )}
        {!compact && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {noticeFiles.map(a => <button key={a.id} className="btn btn-secondary btn-sm" onClick={() => download(a.id)}><Paperclip size={14} /> {a.name}</button>)}
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
  const { settings } = useLibrary();
  const libraryId = settings?.libraryId;
  const [list, setList] = useState(null);
  const [dismissals, setDismissals] = useState({ snoozes: [], skips: [] });
  const [showHidden, setShowHidden] = useState(false);
  const load = useCallback(() => { api.notifications('?actionRequired=true&limit=40').then(setList).catch(() => setList([])); }, []);
  useEffect(() => { load(); window.addEventListener('notifications:changed', load); return () => window.removeEventListener('notifications:changed', load); }, [load]);
  useEffect(() => {
    let cancelled = false;
    const today = todayIST();
    const readLocal = () => {
      try { return normalizeDismissals(JSON.parse(localStorage.getItem(dismissalStorageKey(libraryId)) || '{}'), today); }
      catch { return { snoozes: [], skips: [] }; }
    };
    api.actionDismissals()
      .then(remote => {
        const next = normalizeDismissals(remote, today);
        try { localStorage.setItem(dismissalStorageKey(libraryId), JSON.stringify(next)); } catch { /* ignore quota */ }
        if (!cancelled) setDismissals(next);
      })
      .catch(() => { if (!cancelled) setDismissals(readLocal()); });
    return () => { cancelled = true; };
  }, [libraryId]);
  const persist = (next) => {
    const today = todayIST();
    const saved = normalizeDismissals(next, today);
    setDismissals(saved);
    try { localStorage.setItem(dismissalStorageKey(libraryId), JSON.stringify(saved)); } catch { /* UI still updated */ }
    api.saveActionDismissals(saved).catch(() => { /* localStorage already has the choice */ });
  };
  if (!list) return null;
  const today = todayIST();
  const { shown, hidden } = partitionActions(list, dismissals, today);
  const visible = shown.slice(0, 5);
  if (visible.length === 0 && hidden.length === 0) return null;
  return (
    <div className="glass-panel" id="action-required-card" style={{ padding: 16, display: 'grid', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#991b1b' }}><AlertTriangle size={18} /> Action Required ({visible.length}{shown.length > 5 ? '+' : ''})</strong>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {hidden.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowHidden(v => !v)}>
              {showHidden ? 'Hide hidden' : `Show hidden (${hidden.length})`}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('notifications')}>View all</button>
        </span>
      </div>
      {visible.map(n => (
        <NotificationItem
          key={n.id}
          n={n}
          compact
          setActiveTab={setActiveTab}
          onChanged={load}
          onLater={() => persist(snoozeItem(dismissals, n, today))}
          onSkip={() => persist(skipItem(dismissals, n, today))}
        />
      ))}
      {showHidden && hidden.map(n => (
        <NotificationItem
          key={`hidden-${n.id}`}
          n={n}
          compact
          setActiveTab={setActiveTab}
          onChanged={load}
          onRestore={() => persist(restoreItem(dismissals, n, today))}
        />
      ))}
    </div>
  );
};

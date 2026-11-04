import React, { useCallback, useEffect, useState } from 'react';
import { MessageCircle, RefreshCw, RotateCcw, Inbox } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, getToken } from '../utils/api';

export const TYPE_LABELS = {
  admission_receipt: 'Admission receipt',
  renewal_receipt: 'Renewal receipt',
  fee_reminder: 'Fee reminder',
  expiry_reminder: 'Expiry reminder',
  otp: 'OTP',
  test: 'Test'
};

const STATUS_STYLES = {
  queued: { label: 'Sending', bg: '#f3f4f6', color: '#4b5563' },
  sent: { label: 'Sent', bg: '#e0f2fe', color: '#0369a1' },
  delivered: { label: 'Delivered', bg: '#dcfce7', color: '#15803d' },
  read: { label: 'Read', bg: '#d1fae5', color: '#047857' },
  failed: { label: 'Failed', bg: '#fee2e2', color: '#b91c1c' },
  skipped: { label: 'Not sent', bg: '#fef3c7', color: '#b45309' }
};

const REASON_TEXT = {
  no_student: 'Student was not found when the receipt was sent',
  no_phone: 'Student has no phone number',
  disabled: 'This message type is turned off in WhatsApp settings',
  no_consent: 'Student opted out of WhatsApp messages',
  invalid_number: 'Phone number is not valid'
};

export const reasonText = (m) => (m.reason ? (REASON_TEXT[m.reason] || m.reason) : m.error || '');

const stripLibraryPrefix = (text) => String(text || '').replace(/^\*[^*\n]*\*\n/, '');

const formatTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export const StatusBadge = ({ status }) => {
  const s = STATUS_STYLES[status] || STATUS_STYLES.queued;
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
};

const Note = ({ children }) => (
  <div className="premium-card" style={{ padding: '20px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
    <MessageCircle size={20} color="var(--text-secondary)" style={{ flexShrink: 0, marginTop: '2px' }} />
    <div>
      <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>WhatsApp messages</h3>
      <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>{children}</p>
    </div>
  </div>
);

const MessageRow = ({ m, showStudent, onResend, resending }) => {
  const why = reasonText(m);
  return (
    <div style={{ padding: '14px 0', borderTop: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
          {showStudent && (
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {m.studentName || m.studentId || m.to || 'Unknown student'}
            </span>
          )}
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{TYPE_LABELS[m.type] || m.type}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatTime(m.createdAt)}</span>
          <StatusBadge status={m.status} />
        </div>
      </div>
      {m.text && (
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-line', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>
          {stripLibraryPrefix(m.text)}
        </p>
      )}
      {(why || m.canResend) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          {why ? <span style={{ fontSize: '12px', color: m.status === 'failed' ? '#b91c1c' : '#b45309' }}>{why}</span> : <span />}
          {m.canResend && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={resending} onClick={() => onResend(m)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <RotateCcw size={14} /> {resending ? 'Sending…' : 'Resend'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const selectStyle = { flex: '1 1 140px', minWidth: 0, fontSize: '16px' }; // 16px stops iOS Safari zooming in

/** Log of WhatsApp messages sent by the library. Pass studentId to show one student's messages. */
export const WhatsAppMessages = ({ studentId, compact = false }) => {
  if (!getToken()) {
    return <Note>WhatsApp needs a cloud account. Tap "Connect / Sign In" at the top and sign in to see sent messages.</Note>;
  }
  return <MessagesList studentId={studentId} compact={compact} />;
};

const MessagesList = ({ studentId, compact }) => {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resendingId, setResendingId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ page: String(page) });
      if (studentId) q.set('studentId', String(studentId));
      if (type) q.set('type', type);
      if (status) q.set('status', status);
      const r = await api.whatsappMessages(`?${q}`);
      setData({ items: r?.items || [], total: r?.total || 0, pages: r?.pages || 1 });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [studentId, type, status, page]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const resend = async (m) => {
    setResendingId(m.id);
    try {
      const r = await api.whatsappResend(m.id);
      if (r?.status === 'sent' || r?.status === 'duplicate') toast.success('Message sent.');
      else if (r?.status === 'skipped') toast.error(REASON_TEXT[r.reason] || 'Message was not sent.');
      else toast.error(r?.error || 'Message could not be sent.');
    } catch (err) {
      toast.error(err?.message || 'Message could not be sent.');
    } finally {
      setResendingId(null);
      setReloadKey(k => k + 1);
    }
  };

  if (error?.status === 403) return <Note>You don't have permission to view WhatsApp messages.</Note>;

  return (
    <div className={compact ? '' : 'premium-card'} style={compact ? {} : { padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <div>
          <h3 style={{ fontSize: compact ? '14px' : '16px', fontWeight: compact ? 600 : 700, margin: 0, color: 'var(--text-primary)' }}>WhatsApp messages</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
            Receipts and reminders sent from this library, with their delivery status.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReloadKey(k => k + 1)} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
        <select className="form-select" aria-label="Message type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).filter(([k]) => k !== 'otp' && k !== 'test').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="form-select" aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All statuses</option>
          {['sent', 'delivered', 'read', 'failed', 'skipped'].map(k => <option key={k} value={k}>{STATUS_STYLES[k].label}</option>)}
        </select>
      </div>

      {loading && !data.items.length ? (
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', padding: '16px 0', margin: 0 }}>Loading messages…</p>
      ) : error ? (
        <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ fontSize: '14px', color: '#b91c1c', margin: 0 }}>{error.message || 'Could not load messages.'}</p>
          <div><button type="button" className="btn btn-primary btn-sm" onClick={() => setReloadKey(k => k + 1)}>Retry</button></div>
        </div>
      ) : data.items.length === 0 ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Inbox size={28} style={{ opacity: 0.6 }} />
          <p style={{ fontSize: '14px', fontWeight: 600, margin: '8px 0 2px 0', color: 'var(--text-primary)' }}>No messages yet</p>
          <p style={{ fontSize: '13px', margin: 0 }}>
            {type || status ? 'No messages match these filters.' : studentId ? 'No WhatsApp messages have been sent to this student.' : 'Receipts and reminders will show here once they are sent.'}
          </p>
        </div>
      ) : (
        <div>
          {data.items.map(m => (
            <MessageRow key={m.id} m={m} showStudent={!studentId} onResend={resend} resending={resendingId === m.id} />
          ))}
        </div>
      )}

      {data.pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Page {page} of {data.pages}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= data.pages || loading} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
};

export default WhatsAppMessages;

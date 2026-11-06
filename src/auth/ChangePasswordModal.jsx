import React, { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';

// Issue #15: current password is mandatory when one exists. Google-only users must prove a
// verified email/mobile with an OTP before setting their first password.
export const ChangePasswordModal = ({ onClose, hasPassword = true }) => {
  const [f, setF] = useState({ cur: '', next: '', confirm: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');

  const sendCode = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.setupPasswordStart();
      setSentTo(r.sentTo || r.via || 'your verified contact');
      toast.success('Verification code sent');
    } catch (err) { setError(err.message || 'Could not send code'); }
    finally { setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (f.next.length < 8) return setError('New password must be at least 8 characters');
    if (f.next !== f.confirm) return setError('New passwords do not match');
    if (hasPassword && f.next === f.cur) return setError('New password must be different from the current one');
    if (!hasPassword && !/^\d{6}$/.test(f.code.trim())) return setError('Enter the 6-digit code');
    setBusy(true);
    try {
      if (hasPassword) await api.changePassword(f.cur, f.next);
      else await api.setupPasswordComplete(f.code.trim(), f.next);
      toast.success(hasPassword ? 'Password changed' : 'Password set');
      onClose();
    } catch (err) { setError(err.message || 'Could not save password'); }
    finally { setBusy(false); }
  };
  const field = (k, label, ac) => (
    <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>{label}
      <input className="input-field" type="password" autoComplete={ac} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} required={k !== 'cur' || hasPassword} />
    </label>
  );
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Change password" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <form onSubmit={submit} className="glass-panel" style={{ background: 'var(--bg-surface, #fff)', width: '100%', maxWidth: 400, padding: 20, display: 'grid', gap: 12, alignContent: 'start', color: 'var(--text-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>{hasPassword ? 'Change password' : 'Set password'}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {hasPassword && field('cur', 'Current password', 'current-password')}
        {!hasPassword && (
          <div style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>We will send a 6-digit code to your verified email or mobile.</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={sendCode} disabled={busy}>{sentTo ? 'Resend code' : 'Send code'}</button>
            {sentTo && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Sent to {sentTo}</div>}
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>6-digit code
              <input className="input-field" inputMode="numeric" maxLength={6} value={f.code} onChange={e => setF({ ...f, code: e.target.value.replace(/\D/g, '') })} required />
            </label>
          </div>
        )}
        {field('next', 'New password (min 8 characters)', 'new-password')}
        {field('confirm', 'Confirm new password', 'new-password')}
        {error && <div role="alert" style={{ color: 'var(--danger, #dc2626)', fontSize: 13 }}>{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}</button>
      </form>
    </div>
  );
};

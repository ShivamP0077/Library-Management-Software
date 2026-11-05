import React, { useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';

// Issue #15: change password from inside the account. Current password is required
// when the account already has one (Google-only accounts can set a first password).
export const ChangePasswordModal = ({ onClose, hasPassword = true }) => {
  const [f, setF] = useState({ cur: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (f.next.length < 8) return setError('New password must be at least 8 characters');
    if (f.next !== f.confirm) return setError('New passwords do not match');
    if (hasPassword && f.next === f.cur) return setError('New password must be different from the current one');
    setBusy(true);
    try { await api.changePassword(f.cur, f.next); toast.success('Password changed'); onClose(); }
    catch (err) { setError(err.message || 'Could not change password'); }
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
          <h3 style={{ margin: 0 }}>Change password</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {hasPassword && field('cur', 'Current password', 'current-password')}
        {field('next', 'New password (min 8 characters)', 'new-password')}
        {field('confirm', 'Confirm new password', 'new-password')}
        {error && <div role="alert" style={{ color: 'var(--danger, #dc2626)', fontSize: 13 }}>{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </div>
  );
};

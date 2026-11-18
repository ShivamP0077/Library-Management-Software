import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { PASSWORD_ONLY_WARNING } from './assistedResetCopy';

export function AssistedPasswordReset({ library, onClose }) {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('email');
  const [challengeId, setChallengeId] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [proof, setProof] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancel = false;
    api.adminLibraryUsers(library.libraryId).then(list => {
      if (cancel) return;
      const allowed = (list || []).filter(u => u.role === 'client_admin' || u.role === 'staff');
      setUsers(allowed);
      if (allowed[0]) setUserId(allowed[0].id);
    }).catch(e => setError(e.message));
    return () => { cancel = true; };
  }, [library.libraryId]);

  const start = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.adminAssistedResetStart({ userId, libraryId: library.libraryId, method, reason });
      setChallengeId(r.challengeId);
      setSentTo(r.sentTo || '');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const complete = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.adminAssistedResetComplete({ challengeId, proof, newPassword });
      setDone(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Reset password" onClick={() => !busy && onClose()}>
      <form className="modal-content" style={{ maxWidth: 480, padding: 20 }} onClick={e => e.stopPropagation()} onSubmit={challengeId ? complete : start}>
        <h3 style={{ margin: '0 0 8px' }}>Reset password — {library.name}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          This sets a new My Library OS password for an owner or staff member. You confirm with your own Super Admin password, email code, or WhatsApp code. Google Authenticator is not used.
        </p>
        {done ? (
          <p style={{ fontSize: 14 }}>Password updated. Existing sessions for that person are signed out. Share the new password with them directly.</p>
        ) : (
          <>
            <label className="form-label" htmlFor="sa-reset-user">Person</label>
            <select id="sa-reset-user" className="form-input" value={userId} disabled={!!challengeId} onChange={e => setUserId(e.target.value)}>
              {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email || u.mobile} ({u.role === 'client_admin' ? 'owner' : 'staff'})</option>)}
            </select>
            <label className="form-label" htmlFor="sa-reset-reason" style={{ marginTop: 10 }}>Reason</label>
            <textarea id="sa-reset-reason" className="form-input" required minLength={3} maxLength={500} value={reason} disabled={!!challengeId} onChange={e => setReason(e.target.value)} />
            <fieldset style={{ border: 'none', padding: 0, margin: '10px 0' }}>
              <legend className="form-label">Verify yourself</legend>
              {[['email', 'Email code to my Super Admin email'], ['whatsapp', 'WhatsApp code to my Super Admin number'], ['password', 'My Super Admin password']].map(([id, label]) => (
                <label key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 4 }}>
                  <input type="radio" name="sa-reset-method" value={id} checked={method === id} disabled={!!challengeId} onChange={() => setMethod(id)} />
                  {label}
                </label>
              ))}
            </fieldset>
            {method === 'password' && (
              <p role="alert" style={{ fontSize: 13, background: '#fef3c7', color: '#92400e', padding: 8, borderRadius: 6 }}>{PASSWORD_ONLY_WARNING}</p>
            )}
            {challengeId && (
              <>
                {sentTo && <p style={{ fontSize: 13 }}>Code sent to {sentTo}.</p>}
                <label className="form-label" htmlFor="sa-reset-proof">{method === 'password' ? 'Your Super Admin password' : 'Verification code'}</label>
                <input id="sa-reset-proof" className="form-input" type={method === 'password' ? 'password' : 'text'} autoComplete="off" required value={proof} onChange={e => setProof(e.target.value)} />
                <label className="form-label" htmlFor="sa-reset-new" style={{ marginTop: 10 }}>New password for this person</label>
                <input id="sa-reset-new" className="form-input" type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              </>
            )}
          </>
        )}
        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
          {!done && <button type="submit" className="btn btn-primary" disabled={busy || !userId}>{busy ? 'Working…' : challengeId ? 'Reset password' : 'Continue'}</button>}
        </div>
      </form>
    </div>
  );
}

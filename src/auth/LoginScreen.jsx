import React, { useEffect, useState } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import { useAuth, googleOAuthErrorMessage } from './AuthContext';
import { api } from '../utils/api';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export function LoginScreen({ onContinueOffline }) {
  const { loginWithPassword, oauthError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.authConfig()
      .then(cfg => { if (!cancelled) setGoogleEnabled(Boolean(cfg?.googleEnabled)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try { await loginWithPassword(email, password); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const alertMessage = error || (oauthError ? googleOAuthErrorMessage(oauthError) : '');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg-primary, #f8fafc)' }}>
      <style>{`
        #google-signin:hover { background: #f8fafc !important; }
        #google-signin:focus-visible { outline: 2px solid var(--brand-accent, #2563eb); outline-offset: 2px; }
      `}</style>
      <div className="premium-card" style={{ width: '100%', maxWidth: 400, padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 40 }}>📖</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>Library Management OS</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Sign in to continue</p>
        </div>

        {googleEnabled && (
          <>
            <a
              id="google-signin"
              href={api.googleStartUrl()}
              onClick={() => setRedirecting(true)}
              style={{
                display: 'flex', width: '100%', minHeight: 44, boxSizing: 'border-box',
                alignItems: 'center', justifyContent: 'center', gap: 10, padding: '8px 16px',
                background: '#ffffff', border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8,
                color: 'var(--text-primary, #111827)', fontSize: 14, fontWeight: 600,
                textDecoration: 'none', cursor: 'pointer',
              }}
            >
              <GoogleIcon />
              <span>{redirecting ? 'Redirecting…' : 'Continue with Google'}</span>
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0', color: 'var(--text-tertiary)', fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border-light, #e5e7eb)' }} /> or use email <div style={{ flex: 1, height: 1, background: 'var(--border-light, #e5e7eb)' }} />
            </div>
          </>
        )}

        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">Email</label>
            <input id="login-email" className="form-input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="login-password">Password</label>
            <input id="login-password" className="form-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {alertMessage && <div role="alert" style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{alertMessage}</div>}
          <button id="login-submit" className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
            <LogIn size={16} /> <span>{busy ? 'Signing in…' : 'Sign in'}</span>
          </button>
        </form>

        {onContinueOffline && (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 10px', color: 'var(--text-tertiary)', fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border-light, #e5e7eb)' }} /> or <div style={{ flex: 1, height: 1, background: 'var(--border-light, #e5e7eb)' }} />
            </div>
            <button
              id="continue-offline-btn"
              type="button"
              className="btn btn-secondary"
              onClick={onContinueOffline}
              style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
            >
              ⚡ Continue in Local / Offline Mode
            </button>
          </div>
        )}

        <p style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 16, color: 'var(--text-tertiary)', fontSize: 12 }}>
          <ShieldCheck size={14} /> Accounts are created by your administrator.
        </p>
      </div>
    </div>
  );
}

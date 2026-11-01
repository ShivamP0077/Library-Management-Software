import React, { useEffect, useRef, useState } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from './AuthContext';

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.getElementById('gsi-client');
    if (existing) { existing.addEventListener('load', resolve); return; }
    const s = document.createElement('script');
    s.id = 'gsi-client';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = resolve; s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
}

export function LoginScreen({ onContinueOffline }) {
  const { loginWithPassword, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const googleBtnRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return; // Google button only when configured
    let cancelled = false;
    loadGoogleScript().then(() => {
      if (cancelled || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setError(''); setBusy(true);
          try { await loginWithGoogle(credential); } catch (e) { setError(e.message); } finally { setBusy(false); }
        },
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, { theme: 'outline', size: 'large', width: 320, text: 'signin_with' });
    }).catch(e => setError(e.message));
    return () => { cancelled = true; };
  }, [loginWithGoogle]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try { await loginWithPassword(email, password); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg-primary, #f8fafc)' }}>
      <div className="premium-card" style={{ width: '100%', maxWidth: 400, padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 40 }}>📖</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>Library Management OS</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Sign in to continue</p>
        </div>

        {GOOGLE_CLIENT_ID && (
          <>
            <div ref={googleBtnRef} id="google-signin-button" style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
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
          {error && <div role="alert" style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
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

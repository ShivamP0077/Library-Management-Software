import React, { useEffect, useState } from 'react';
import { LogIn, ShieldCheck, ArrowLeft, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth, googleOAuthErrorMessage } from './AuthContext';
import { api } from '../utils/api';
import { SignupPanel } from './SignupPanel';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

const ROLE_LABELS = { staff: 'Staff', client_admin: 'Co-admin', superadmin: 'Super Admin' };
const roleLabel = (role) => ROLE_LABELS[role] || role || 'Staff';

/** Reads `invite=<token>` from the URL fragment, if present. */
const readInviteToken = () => {
  if (typeof window === 'undefined') return '';
  const hash = window.location.hash || '';
  const match = hash.match(/invite=([^&]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

export function LoginScreen({ onContinueOffline }) {
  const { loginWithPassword, completeLogin, oauthError, googleSignupPending, clearGoogleSignupPending } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [signup, setSignup] = useState(null);

  // 'login' | 'forgot' | 'invite'
  const [mode, setMode] = useState(() => (readInviteToken() ? 'invite' : 'login'));
  const [inviteToken] = useState(readInviteToken);

  // Forgot password (2-step) state
  const [forgotStep, setForgotStep] = useState(1);
  const [forgotMessage, setForgotMessage] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Invite acceptance state
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken));
  const [inviteError, setInviteError] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteConfirm, setInviteConfirm] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.authConfig()
      .then(cfg => { if (!cancelled) setGoogleEnabled(Boolean(cfg?.googleEnabled)); })
      .catch(() => {});
    // Issue #15: the signup link only appears when the server has signup switched on.
    api.signupConfig?.()
      .then(cfg => { if (!cancelled) setSignup(cfg?.enabled ? cfg : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (googleSignupPending && signup) {
      setMode('signup');
    }
  }, [googleSignupPending, signup]);

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    setInviteLoading(true);
    setInviteError('');
    api.inviteInfo(inviteToken)
      .then(info => {
        if (cancelled) return;
        setInviteInfo(info);
        setInviteName(info?.name || '');
      })
      .catch(() => {
        if (!cancelled) setInviteError('This invite link is invalid, expired or already used.');
      })
      .finally(() => { if (!cancelled) setInviteLoading(false); });
    return () => { cancelled = true; };
  }, [inviteToken]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try { await loginWithPassword(email, password); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const backToLogin = () => {
    if (typeof window !== 'undefined' && (window.location.hash || '').includes('invite=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    setMode('login');
    setError('');
    setForgotStep(1);
    setForgotMessage('');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setPassword('');
    setInvitePassword('');
    setInviteConfirm('');
  };

  const openForgot = () => {
    setError('');
    setMode('forgot');
    setForgotStep(1);
    setForgotMessage('');
  };

  const sendCode = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = await api.forgotPassword(email);
      setForgotMessage(res?.message || 'If that email is registered, a 6-digit code has been sent.');
      setForgotStep(2);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(email, otp.trim(), newPassword);
      toast.success('Password changed. Please sign in.');
      setMode('login');
      setForgotStep(1);
      setForgotMessage('');
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
      setPassword('');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const submitInvite = async (e) => {
    e.preventDefault();
    setError('');
    if (!inviteName.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (invitePassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (invitePassword !== inviteConfirm) {
      setError('Passwords do not match.');
      return;
    }
    setInviteBusy(true);
    try {
      const result = await api.acceptInvite({ token: inviteToken, name: inviteName.trim(), password: invitePassword });
      window.history.replaceState(null, '', window.location.pathname);
      completeLogin(result);
    } catch (err) {
      setError(err.message);
    } finally { setInviteBusy(false); }
  };

  const alertMessage = error || (mode === 'login' && oauthError ? googleOAuthErrorMessage(oauthError) : '');
  const subtitle = mode === 'signup' ? 'Start your library' : mode === 'invite' ? 'Accept your invitation' : mode === 'forgot' ? 'Recover your account' : 'Sign in to continue';
  const inviteLibraryName = typeof inviteInfo?.library === 'string' ? inviteInfo.library : inviteInfo?.library?.name;

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
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{subtitle}</p>
        </div>

        {mode === 'login' && googleEnabled && (
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

        {mode === 'login' && (
          <>
            <form onSubmit={submit}>
              <div className="form-group">
                <label className="form-label" htmlFor="login-email">Email or mobile</label>
                <input id="login-email" className="form-input" type="text" autoComplete="username" placeholder="you@example.com or 98765 43210" value={email} onChange={e => setEmail(e.target.value)} required />
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

            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <button
                id="forgot-password-link"
                type="button"
                className="btn btn-ghost"
                onClick={openForgot}
                style={{ fontSize: 13, color: 'var(--brand-primary, #2563eb)', padding: '4px 8px' }}
              >
                Forgot password?
              </button>
            </div>
            {signup && (
              <div style={{ marginTop: 4, textAlign: 'center', fontSize: 13 }}>
                New library?{' '}
                <button id="signup-link" type="button" className="btn btn-ghost" onClick={() => { setError(''); setMode('signup'); }} style={{ fontSize: 13, color: 'var(--brand-primary, #2563eb)', padding: '4px 8px' }}>Create an account</button>
              </div>
            )}
          </>
        )}

        {mode === 'signup' && signup && (
          <SignupPanel
            plans={signup.plans || []}
            googleSignup={Boolean(signup.googleSignup)}
            paymentsConfigured={Boolean(signup.paymentsConfigured)}
            googlePendingToken={googleSignupPending || ''}
            onBack={() => { clearGoogleSignupPending?.(); backToLogin(); }}
            onDone={(result) => { clearGoogleSignupPending?.(); completeLogin(result); }}
          />
        )}

        {mode === 'forgot' && (
          <div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={backToLogin}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 8px', marginBottom: 8 }}
            >
              <ArrowLeft size={15} /> Back to sign in
            </button>

            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <KeyRound size={16} /> {forgotStep === 1 ? 'Reset your password' : 'Enter your reset code'}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 16px 0' }}>
              {forgotStep === 1
                ? 'Enter your account email and we will send you a 6-digit code.'
                : `Enter the 6-digit code sent to ${email || 'your email'} and choose a new password.`}
            </p>

            {forgotStep === 2 && forgotMessage && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', fontSize: 13, borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                {forgotMessage}
              </div>
            )}

            <form onSubmit={forgotStep === 1 ? sendCode : submitReset}>
              {forgotStep === 1 ? (
                <div className="form-group">
                  <label className="form-label" htmlFor="forgot-email">Email</label>
                  <input id="forgot-email" className="form-input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label" htmlFor="forgot-otp">6-digit code</label>
                    <input
                      id="forgot-otp"
                      className="form-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      pattern="\d{6}"
                      placeholder="123456"
                      value={otp}
                      onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="forgot-new-password">New password</label>
                    <input id="forgot-new-password" className="form-input" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="forgot-confirm-password">Confirm password</label>
                    <input id="forgot-confirm-password" className="form-input" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
                  </div>
                </>
              )}

              {alertMessage && <div role="alert" style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{alertMessage}</div>}

              <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
                <span>{busy ? 'Please wait…' : (forgotStep === 1 ? 'Send code' : 'Reset password')}</span>
              </button>
            </form>
          </div>
        )}

        {mode === 'invite' && (
          <div>
            {inviteLoading && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center' }}>Loading invitation…</p>
            )}

            {!inviteLoading && inviteError && (
              <div>
                <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, borderRadius: 8, padding: '12px', marginBottom: 16 }}>
                  {inviteError}
                </div>
                <button type="button" className="btn btn-secondary" onClick={backToLogin} style={{ width: '100%', justifyContent: 'center' }}>
                  Go to sign in
                </button>
              </div>
            )}

            {!inviteLoading && !inviteError && inviteInfo && (
              <>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px 0' }}>Accept invitation</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 16px 0' }}>
                  You've been invited to <strong>{inviteLibraryName || 'this library'}</strong> as <strong>{roleLabel(inviteInfo.role)}</strong> ({inviteInfo.email})
                </p>

                {googleEnabled && (
                  <>
                    <a
                      id="google-invite"
                      href={`${api.googleStartUrl()}?invite=${encodeURIComponent(inviteToken)}`}
                      onClick={() => setRedirecting(true)}
                      style={{
                        display: 'flex', width: '100%', minHeight: 44, boxSizing: 'border-box',
                        alignItems: 'center', justifyContent: 'center', gap: 10, padding: '8px 16px',
                        background: '#ffffff', border: '1px solid var(--border-light, #e5e7eb)', borderRadius: 8,
                        color: 'var(--text-primary, #111827)', fontSize: 14, fontWeight: 600, textDecoration: 'none',
                      }}
                    >
                      <GoogleIcon />
                      <span>{redirecting ? 'Redirecting…' : `Join with Google (${inviteInfo.email})`}</span>
                    </a>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0', color: 'var(--text-tertiary)', fontSize: 12 }}>
                      <div style={{ flex: 1, height: 1, background: 'var(--border-light, #e5e7eb)' }} /> or set a password <div style={{ flex: 1, height: 1, background: 'var(--border-light, #e5e7eb)' }} />
                    </div>
                  </>
                )}
                <form onSubmit={submitInvite}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="invite-name">Your name</label>
                    <input id="invite-name" className="form-input" type="text" autoComplete="name" value={inviteName} onChange={e => setInviteName(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="invite-password">Password</label>
                    <input id="invite-password" className="form-input" type="password" autoComplete="new-password" value={invitePassword} onChange={e => setInvitePassword(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="invite-confirm-password">Confirm password</label>
                    <input id="invite-confirm-password" className="form-input" type="password" autoComplete="new-password" value={inviteConfirm} onChange={e => setInviteConfirm(e.target.value)} required />
                  </div>

                  {alertMessage && <div role="alert" style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{alertMessage}</div>}

                  <button className="btn btn-primary" type="submit" disabled={inviteBusy} style={{ width: '100%', justifyContent: 'center' }}>
                    <span>{inviteBusy ? 'Joining…' : 'Join library'}</span>
                  </button>
                </form>

                <div style={{ marginTop: 12, textAlign: 'center' }}>
                  <button type="button" className="btn btn-ghost" onClick={backToLogin} style={{ fontSize: 13, padding: '4px 8px' }}>
                    Back to sign in
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {mode === 'login' && onContinueOffline && (
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

        {mode === 'login' && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 16, color: 'var(--text-tertiary)', fontSize: 12 }}>
            <ShieldCheck size={14} /> Accounts are created by your administrator.
          </p>
        )}
      </div>
    </div>
  );
}

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, setTenantContext, onUnauthorized } from '../utils/api';
import { setCacheScope, clearCacheScope } from '../utils/tenantCache';

const AuthContext = createContext(null);

export const OAUTH_ERROR_MESSAGES = {
  not_registered: "This Google account isn't registered with My Library OS. Ask your library owner or administrator to add your email, then try again.",
  email_unverified: 'Your Google email address is not verified.',
  account_mismatch: 'This email is linked to a different Google account.',
  account_disabled: 'Your account is disabled.',
  library_disabled: 'Your library is disabled. Contact support.',
  invalid_state: 'Your sign-in session expired. Please try again.',
  invalid_request: 'Your sign-in session expired. Please try again.',
  access_denied: 'Google sign-in was cancelled.',
  not_configured: 'Google sign-in is not available right now.',
  invite_invalid: 'This invite link is invalid, expired or already used.',
  invite_email_mismatch: 'That Google account does not match the invited email. Use the invited email.',
  account_exists: 'An account with this email already exists. Sign in instead.',
};

/** Maps a `google_error` code from the OAuth redirect to a friendly message. */
export function googleOAuthErrorMessage(code) {
  return OAUTH_ERROR_MESSAGES[code] || 'Google sign-in failed. Please try again.';
}

/**
 * Issue #2: picks this library's own browser cache before the workspace mounts.
 * Each library has its own namespace; read-only drill-in uses memory only.
 * Nothing is deleted, and the old owner marker is no longer changed (it is
 * the proof used to move old unprefixed data into the library it belongs to).
 */
export function prepareLocalCacheFor(libraryId, { readOnly = false } = {}) {
  if (!libraryId) return clearCacheScope();
  return setCacheScope({ tenantId: libraryId, readOnly });
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { user, library }
  const [oauthError, setOauthError] = useState('');
  const [googleSignupPending, setGoogleSignupPending] = useState(''); // Issue #15
  const [status, setStatus] = useState(() => {
    const hasHashToken = typeof window !== 'undefined' && window.location.hash.includes('google_token=');
    return getToken() || hasHashToken ? 'loading' : 'anonymous';
  });

  const logout = useCallback(() => {
    api.logout();
    setTenantContext({});
    clearCacheScope();
    setSession(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => { onUnauthorized(logout); }, [logout]);

  useEffect(() => {
    // The OAuth callback returns the token (or an error code) in the URL fragment.
    // Consume it before the normal session check, then remove it from the address bar.
    const hash = window.location.hash || '';
    if (hash.includes('google_token=') || hash.includes('google_error=') || hash.includes('google_signup=')) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const token = params.get('google_token');
      const code = params.get('google_error');
      const signupTok = params.get('google_signup');
      if (token) setToken(token);
      if (code) setOauthError(code);
      if (signupTok) setGoogleSignupPending(signupTok);
      if (token || code || signupTok) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }


    if (!getToken()) return;
    api.me()
      .then(r => { setSession(r); setStatus('authenticated'); })
      .catch(() => { setToken(null); setStatus('anonymous'); });
  }, []);

  const completeLogin = (r) => { setSession({ user: r.user, library: r.library, subscriptionAccess: r.subscriptionAccess || null }); setStatus('authenticated'); };
  const loginWithPassword = async (email, password) => completeLogin(await api.login({ email, password }));
  const loginWithGoogle = async (credential) => completeLogin(await api.loginWithGoogle(credential));

  return (
    <AuthContext.Provider value={{ ...session, status, oauthError, googleSignupPending, clearGoogleSignupPending: () => setGoogleSignupPending(''), completeLogin, loginWithPassword, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

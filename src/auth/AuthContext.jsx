import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, setTenantContext, onUnauthorized } from '../utils/api';

const AuthContext = createContext(null);
const CACHE_OWNER_KEY = 'library_cache_owner';
const PRESERVED_KEYS = new Set(['library_api_token', CACHE_OWNER_KEY]);

export const OAUTH_ERROR_MESSAGES = {
  not_registered: "This Google account isn't registered with Library OS. Ask your library owner or administrator to add your email, then try again.",
  email_unverified: 'Your Google email address is not verified.',
  account_mismatch: 'This email is linked to a different Google account.',
  account_disabled: 'Your account is disabled.',
  library_disabled: 'Your library is disabled. Contact support.',
  invalid_state: 'Your sign-in session expired. Please try again.',
  invalid_request: 'Your sign-in session expired. Please try again.',
  access_denied: 'Google sign-in was cancelled.',
  not_configured: 'Google sign-in is not available right now.',
};

/** Maps a `google_error` code from the OAuth redirect to a friendly message. */
export function googleOAuthErrorMessage(code) {
  return OAUTH_ERROR_MESSAGES[code] || 'Google sign-in failed. Please try again.';
}

/** Local cache (localStorage) is per library: safely preserve existing local data without destructive deletion. */
export function prepareLocalCacheFor(ownerKey) {
  if (!ownerKey || localStorage.getItem(CACHE_OWNER_KEY) === ownerKey) return;
  // Non-destructive: preserve existing local state so user records and offline data are never wiped
  localStorage.setItem(CACHE_OWNER_KEY, ownerKey);
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { user, library }
  const [oauthError, setOauthError] = useState('');
  const [status, setStatus] = useState(() => {
    const hasHashToken = typeof window !== 'undefined' && window.location.hash.includes('google_token=');
    return getToken() || hasHashToken ? 'loading' : 'anonymous';
  });

  const logout = useCallback(() => {
    api.logout();
    setTenantContext({});
    setSession(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => { onUnauthorized(logout); }, [logout]);

  useEffect(() => {
    // The OAuth callback returns the token (or an error code) in the URL fragment.
    // Consume it before the normal session check, then remove it from the address bar.
    const hash = window.location.hash || '';
    if (hash.includes('google_token=') || hash.includes('google_error=')) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const token = params.get('google_token');
      const code = params.get('google_error');
      if (token) setToken(token);
      if (code) setOauthError(code);
      if (token || code) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    if (!getToken()) return;
    api.me()
      .then(r => { setSession(r); setStatus('authenticated'); })
      .catch(() => { setToken(null); setStatus('anonymous'); });
  }, []);

  const completeLogin = (r) => { setSession({ user: r.user, library: r.library }); setStatus('authenticated'); };
  const loginWithPassword = async (email, password) => completeLogin(await api.login({ email, password }));
  const loginWithGoogle = async (credential) => completeLogin(await api.loginWithGoogle(credential));

  return (
    <AuthContext.Provider value={{ ...session, status, oauthError, loginWithPassword, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

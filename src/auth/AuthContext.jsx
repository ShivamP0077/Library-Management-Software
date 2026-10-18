import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, setTenantContext, onUnauthorized } from '../utils/api';

const AuthContext = createContext(null);
const CACHE_OWNER_KEY = 'library_cache_owner';
const PRESERVED_KEYS = new Set(['library_api_token', CACHE_OWNER_KEY]);

/** Local cache (localStorage) is per library: clear it when a different library is opened. */
export function prepareLocalCacheFor(ownerKey) {
  if (localStorage.getItem(CACHE_OWNER_KEY) === ownerKey) return;
  Object.keys(localStorage).forEach(k => {
    if ((k.startsWith('library_') || k === 'wizardDraft') && !PRESERVED_KEYS.has(k)) localStorage.removeItem(k);
  });
  localStorage.setItem(CACHE_OWNER_KEY, ownerKey);
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { user, library }
  const [status, setStatus] = useState(getToken() ? 'loading' : 'anonymous');

  const logout = useCallback(() => {
    api.logout();
    setTenantContext({});
    setSession(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => { onUnauthorized(logout); }, [logout]);

  useEffect(() => {
    if (!getToken()) return;
    api.me()
      .then(r => { setSession(r); setStatus('authenticated'); })
      .catch(() => { setToken(null); setStatus('anonymous'); });
  }, []);

  const completeLogin = (r) => { setSession({ user: r.user, library: r.library }); setStatus('authenticated'); };
  const loginWithPassword = async (email, password) => completeLogin(await api.login({ email, password }));
  const loginWithGoogle = async (credential) => completeLogin(await api.loginWithGoogle(credential));

  return (
    <AuthContext.Provider value={{ ...session, status, loginWithPassword, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

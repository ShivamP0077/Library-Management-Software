/**
 * Backend API client.
 * - Production (e.g. Vercel): set VITE_API_URL to the backend origin, e.g. https://lms-api.onrender.com
 * - Local dev: leave it unset; requests go to /api and Vite proxies them to the local server.
 */
const RAW_BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
export const API_BASE = RAW_BASE ? (RAW_BASE.endsWith('/api') ? RAW_BASE : `${RAW_BASE}/api`) : '/api';

const TOKEN_KEY = 'library_api_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Tenant context used by super admin drill-in (client admins are scoped server-side by their token)
let tenantContext = { libraryId: null, readOnly: false };
export const setTenantContext = (ctx) => { tenantContext = { libraryId: null, readOnly: false, ...ctx }; };
export const getTenantContext = () => tenantContext;

let unauthorizedHandler = null;
export const onUnauthorized = (fn) => { unauthorizedHandler = fn; };

export async function apiRequest(path, { method = 'GET', body, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenantContext.libraryId) headers['X-Library-Id'] = tenantContext.libraryId;
  if (tenantContext.readOnly) headers['X-Read-Only'] = '1';
  const res = await fetch(`${API_BASE}${path}`, { method, headers, signal, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && token && unauthorizedHandler) unauthorizedHandler();
  if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const api = {
  health: () => apiRequest('/health'),
  getState: () => apiRequest('/state'),
  saveSettings: (settings) => apiRequest('/settings', { method: 'PUT', body: settings }),
  syncCollection: (col, items) => apiRequest(`/${col}`, { method: 'PUT', body: items }),
  authConfig: () => apiRequest('/auth/config'),
  login: async (credentials) => { const r = await apiRequest('/auth/login', { method: 'POST', body: credentials }); setToken(r.token); return r; },
  loginWithGoogle: async (credential) => { const r = await apiRequest('/auth/google', { method: 'POST', body: { credential } }); setToken(r.token); return r; },
  me: () => apiRequest('/auth/me'),
  logout: () => setToken(null),
  // Super admin
  adminLibraries: () => apiRequest('/admin/libraries'),
  adminMetrics: () => apiRequest('/admin/metrics'),
  adminCreateLibrary: (body) => apiRequest('/admin/libraries', { method: 'POST', body }),
  adminUpdateLibrary: (libraryId, body) => apiRequest(`/admin/libraries/${encodeURIComponent(libraryId)}`, { method: 'PATCH', body }),
  adminAddLibraryUser: (libraryId, body) => apiRequest(`/admin/libraries/${encodeURIComponent(libraryId)}/users`, { method: 'POST', body }),
  adminUpdateUser: (id, body) => apiRequest(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  saveDocument: (key, data) => apiRequest(`/documents/${encodeURIComponent(key)}`, { method: 'PUT', body: { data } }),
  getDocument: (key) => apiRequest(`/documents/${encodeURIComponent(key)}`).then(r => r?.data ?? null),
  deleteDocument: (key) => apiRequest(`/documents/${encodeURIComponent(key)}`, { method: 'DELETE' }),
};

/** Collections persisted by LibraryContext, mapped to backend collection names. */
export const SYNCED_COLLECTIONS = [
  'branches', 'sections', 'seatTypes', 'seats', 'shifts', 'plans', 'staffMembers',
  'students', 'archivedStudents', 'expenses', 'payments', 'waitingList'
];

/**
 * Debounced, change-detecting sync of one piece of state to the backend.
 * Only runs once the initial load from the backend has completed (enable()).
 */
export function createSyncQueue({ delay = 400, onError } = {}) {
  const last = new Map();
  const timers = new Map();
  let enabled = false;
  const push = async (key, value) => {
    const json = JSON.stringify(value);
    if (last.get(key) === json) return;
    try {
      if (key === 'settings') await api.saveSettings(value);
      else await api.syncCollection(key, value);
      last.set(key, json);
    } catch (e) {
      onError?.(key, e);
    }
  };
  return {
    enable: () => { enabled = true; },
    isEnabled: () => enabled,
    markSynced: (key, value) => last.set(key, JSON.stringify(value)),
    push,
    queue(key, value) {
      if (!enabled) return;
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => push(key, value), delay));
    },
  };
}

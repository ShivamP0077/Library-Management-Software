/**
 * Staff invite token from the app URL.
 * Path (`/invite/<token>`) survives mail clients that drop the hash.
 * Query (`?invite=`) and hash (`#invite=`) still work for older links.
 */
export function readInviteToken(loc) {
  const location = loc || (typeof window !== 'undefined' ? window.location : null);
  if (!location) return '';
  const from = (raw) => {
    if (!raw) return '';
    try { return decodeURIComponent(raw); } catch { return raw; }
  };
  const path = String(location.pathname || '').match(/\/invite\/([^/]+)/);
  if (path) return from(path[1]);
  const query = new URLSearchParams(String(location.search || '').replace(/^\?/, '')).get('invite');
  if (query) return from(query);
  const hash = String(location.hash || '');
  const match = hash.match(/invite=([^&]+)/);
  return match ? from(match[1]) : '';
}

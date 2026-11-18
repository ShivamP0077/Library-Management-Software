/** True only when a Super Admin refresh returned both library list and summary. */
export function verifiedAdminRefresh(libraries, summary) {
  if (!Array.isArray(libraries) || !summary || typeof summary !== 'object' || !Array.isArray(summary.list)) {
    const err = new Error('Refresh did not return library data');
    err.code = 'REFRESH_UNVERIFIED';
    throw err;
  }
  return true;
}

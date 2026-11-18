/** Stable public link that carries the library's own referral code. */
export function referralShareUrl(code, origin) {
  const value = String(code || '').trim();
  if (!value) return '';
  const base = String(origin || '').replace(/\/$/, '');
  return `${base}/#signup?referral=${encodeURIComponent(value)}`;
}

/** Phones with a share sheet use it. Desktop and missing share copy the link. */
export function canUseNativeShare(nav = typeof navigator === 'undefined' ? undefined : navigator) {
  if (!nav || typeof nav.share !== 'function') return false;
  const touch = Number(nav.maxTouchPoints || 0) > 0;
  let coarse = false;
  try {
    coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches === true;
  } catch { coarse = false; }
  return touch || coarse;
}

/**
 * Share the referral link. Returns 'shared', 'copied', or 'cancelled'.
 * A dismissed share sheet does not also copy.
 */
export async function shareReferralLink({ code, url, nav = typeof navigator === 'undefined' ? undefined : navigator, clipboard } = {}) {
  const link = url || referralShareUrl(code);
  const text = code ? `Join My Library OS with my referral code ${code}` : 'Join My Library OS';
  if (canUseNativeShare(nav)) {
    try {
      await nav.share({ title: 'My Library OS', text, url: link });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const write = clipboard || nav?.clipboard?.writeText?.bind(nav.clipboard);
  if (!write) throw new Error('Could not copy');
  await write(link || code || '');
  return 'copied';
}

/** Pure helpers for the public enquiry form and the waiting list. */

export function indianMobileDigits(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/** Empty string when the value is a valid 10-digit Indian mobile (optional +91 or leading 0). */
export function indianMobileError(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Enter a 10-digit mobile number';
  const digits = indianMobileDigits(raw);
  if (!/^[6-9]\d{9}$/.test(digits)) return 'Enter a valid 10-digit Indian mobile number';
  return '';
}

/** 10-digit mobile, or '' when the value is not a valid Indian mobile. */
export function normalizeIndianMobile(value) {
  return indianMobileError(value) ? '' : indianMobileDigits(value);
}

/** Display form +91 XXXXX XXXXX. Falls back to the original text when invalid. */
export function formatIndianMobile(value) {
  const digits = normalizeIndianMobile(value);
  if (!digits) return String(value || '').trim();
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

export function telHref(value) {
  const digits = normalizeIndianMobile(value);
  return digits ? `tel:+91${digits}` : `tel:${String(value || '').replace(/\s/g, '')}`;
}

const plural = (n, word) => (n === 1 ? `1 ${word} ago` : `${n} ${word}s ago`);

/** Short relative time. `now` may be a Date or a millisecond timestamp. */
export function timeAgo(value, now = Date.now()) {
  const then = new Date(value).getTime();
  const current = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(then) || !Number.isFinite(current)) return '';
  const seconds = Math.floor((current - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return plural(days, 'day');
  const months = Math.floor(days / 30);
  if (months < 12) return plural(months, 'month');
  return plural(Math.floor(months / 12), 'year');
}

/** Badge text. Empty when there is nothing waiting. */
export function badgeCount(value) {
  const n = Number(value) || 0;
  if (n <= 0) return '';
  return n > 99 ? '99+' : String(n);
}

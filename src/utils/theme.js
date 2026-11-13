const KEY = 'library_os_theme';

export function readTheme() {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'dark' || value === 'light') return value;
  } catch { /* private mode */ }
  return 'light';
}

/** Sets data-theme on <html> and remembers the choice. */
export function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  return next;
}

export function toggleTheme(current = readTheme()) {
  return applyTheme(current === 'dark' ? 'light' : 'dark');
}

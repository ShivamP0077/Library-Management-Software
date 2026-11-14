import { useEffect, useRef, useState } from 'react';

/** Public origin used in canonical and social tags. Never empty. */
export const SITE_ORIGIN = (import.meta.env.VITE_SITE_URL || 'https://mylibraryos.in').replace(/\/$/, '');

export const HOME_TITLE = 'My Library OS – library management software for study libraries in India';
export const HOME_DESCRIPTION = HOME_TITLE;

/** Path → document title. These are the only client routes besides home. */
export const LEGAL_ROUTES = {
  '/privacy': 'Privacy Policy | My Library OS',
  '/terms': 'Terms & Conditions | My Library OS',
  '/refund': 'Refund & Cancellation Policy | My Library OS',
  '/contact': 'Contact Us | My Library OS',
};

const LEGAL_DESCRIPTIONS = {
  '/privacy': 'Privacy Policy for My Library OS. How we handle account, library, student and billing data in India.',
  '/terms': 'Terms and Conditions for My Library OS, a digital library management service priced in INR.',
  '/refund': 'Refund and Cancellation Policy for My Library OS subscriptions and wallet top-ups.',
  '/contact': 'Contact My Library OS by email. Bangalore, Karnataka, India.',
};

export function normalizePath(pathname) {
  if (!pathname) return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

function readPath() {
  return normalizePath(window.location.pathname);
}

function isKnownPath(path) {
  return path === '/' || Object.prototype.hasOwnProperty.call(LEGAL_ROUTES, path);
}

function setMeta(selector, attr, value) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

/**
 * Tiny path router: the page follows window.location.pathname.
 * Back/forward uses popstate. In-app links to / and the legal paths
 * call history.pushState so the landing bundle is not reloaded.
 * Hash links on the home page are left to the browser.
 */
export function usePathname() {
  const [path, setPath] = useState(readPath);
  const skipFirstScroll = useRef(true);

  useEffect(() => {
    const sync = () => setPath(readPath());

    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest?.('a');
      if (!anchor || anchor.hasAttribute('download')) return;
      if (anchor.target && anchor.target !== '_self') return;
      const raw = anchor.getAttribute('href') || '';
      if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:')) return;

      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      const next = normalizePath(url.pathname);
      if (!isKnownPath(next)) return;
      if (next === '/' && readPath() === '/') return;

      event.preventDefault();
      const clean = `${next}${url.search}${url.hash}`;
      const current = `${readPath()}${window.location.search}${window.location.hash}`;
      if (current !== clean) {
        history.pushState(null, '', clean);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      const scrollToHash = () => {
        if (!url.hash) {
          window.scrollTo(0, 0);
          return;
        }
        const el = document.getElementById(url.hash.slice(1));
        if (el) el.scrollIntoView();
        else window.scrollTo(0, 0);
      };
      window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToHash));
    };

    window.addEventListener('popstate', sync);
    document.addEventListener('click', onClick);

    const normalized = readPath();
    if (isKnownPath(normalized) && window.location.pathname !== normalized) {
      history.replaceState(null, '', `${normalized}${window.location.search}${window.location.hash}`);
    }

    return () => {
      window.removeEventListener('popstate', sync);
      document.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    const legalTitle = LEGAL_ROUTES[path];
    document.title = legalTitle || HOME_TITLE;
    const description = LEGAL_DESCRIPTIONS[path] || HOME_DESCRIPTION;
    const url = `${SITE_ORIGIN}${path === '/' ? '/' : path}`;
    setMeta('meta[name="description"]', 'content', description);
    setMeta('link[rel="canonical"]', 'href', url);
    setMeta('meta[property="og:url"]', 'content', url);
    setMeta('meta[property="og:title"]', 'content', legalTitle || HOME_TITLE);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[name="twitter:title"]', 'content', legalTitle || HOME_TITLE);
    setMeta('meta[name="twitter:description"]', 'content', description);
    const hashId = window.location.hash.slice(1);
    if (skipFirstScroll.current && path === '/' && !hashId) {
      skipFirstScroll.current = false;
      return;
    }
    skipFirstScroll.current = false;
    if (hashId) {
      window.requestAnimationFrame(() => document.getElementById(hashId)?.scrollIntoView());
    } else {
      window.scrollTo(0, 0);
    }
  }, [path]);

  return path;
}

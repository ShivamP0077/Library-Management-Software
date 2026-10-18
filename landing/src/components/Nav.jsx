import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { APP_URL, BRAND } from '../config.js';

const links = [
  ['Features', '#features'],
  ['Product', '#product'],
  ['How it works', '#how'],
  ['Multi-branch', '#branches'],
  ['Pricing', '#pricing'],
  ['FAQ', '#faq'],
];

export function Logo({ className = '' }) {
  return (
    <a href="#top" className={`flex cursor-pointer items-center gap-2.5 ${className}`} aria-label={`${BRAND} home`}>
      <img src="/favicon.svg" alt="" width="32" height="32" className="h-8 w-8" />
      <span className="font-display text-lg font-bold tracking-tight text-white">
        Library<span className="text-gold-400">OS</span>
      </span>
    </a>
  );
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled || open ? 'border-b border-white/10 bg-ink-950/80 backdrop-blur-xl' : 'border-b border-transparent'
      }`}
    >
      <nav className="container-x flex h-16 items-center justify-between" aria-label="Main">
        <Logo />
        <ul className="hidden items-center gap-1 lg:flex">
          {links.map(([l, h]) => (
            <li key={h}>
              <a href={h} className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-stone-300 transition-colors hover:text-white">
                {l}
              </a>
            </li>
          ))}
        </ul>
        <div className="hidden items-center gap-2 lg:flex">
          <a href={APP_URL} className="cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold text-stone-200 transition-colors hover:text-white">
            Sign in
          </a>
          <a href={APP_URL} className="btn-gold !px-4 !py-2 !text-sm">
            Start free trial
          </a>
        </div>
        <button
          type="button"
          className="cursor-pointer rounded-lg p-2 text-stone-200 lg:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>
      {open && (
        <div className="container-x pb-6 lg:hidden">
          <ul className="flex flex-col gap-1">
            {links.map(([l, h]) => (
              <li key={h}>
                <a onClick={() => setOpen(false)} href={h} className="block cursor-pointer rounded-lg px-3 py-3 text-base font-medium text-stone-200 hover:bg-white/5">
                  {l}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <a href={APP_URL} className="btn-ghost-dark">Sign in</a>
            <a href={APP_URL} className="btn-gold">Start free trial</a>
          </div>
        </div>
      )}
    </header>
  );
}

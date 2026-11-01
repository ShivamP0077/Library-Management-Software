import { ArrowRight, CalendarClock } from 'lucide-react';
import { APP_URL, DEMO_HREF, DEMO_EMAIL } from '../config.js';
import { Logo } from './Nav.jsx';
import { Reveal } from './ui.jsx';

export function FinalCTA() {
  return (
    <section className="relative bg-paper pb-24 sm:pb-32">
      <div className="container-x">
        <Reveal className="grain relative isolate overflow-hidden rounded-[2rem] bg-ink-950 px-6 py-16 text-center sm:px-16 sm:py-20">
          <div className="grid-lines absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
          <div className="absolute left-1/2 top-0 -z-10 h-80 w-[700px] -translate-x-1/2 rounded-full bg-gold-500/30 blur-[120px]" />
          <h2 className="text-balance mx-auto max-w-3xl font-display text-3xl font-black leading-tight text-white sm:text-5xl">
            Give your front desk <span className="text-gold-grad">its evenings back.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-stone-300 sm:text-lg">
            Set up your seats, shifts and fee plans, then run the whole library from one screen.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <a href={APP_URL} className="btn-gold group !px-7 !py-3.5 !text-base">
              Start free trial <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
            </a>
            <a href={DEMO_HREF} className="btn-ghost-dark !px-7 !py-3.5 !text-base">
              <CalendarClock size={18} /> Book a demo
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default function Footer() {
  const cols = [
    ['Product', [['Features', '#features'], ['Product tour', '#product'], ['Multi-branch', '#branches'], ['Pricing', '#pricing']]],
    ['Get started', [['Start free trial', APP_URL], ['Sign in', APP_URL], ['Book a demo', DEMO_HREF], ['FAQ', '#faq']]],
  ];
  return (
    <footer className="border-t border-white/10 bg-ink-950 py-14 text-stone-400">
      <div className="container-x grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-relaxed">
            Seat, shift, admission and fee management for reading libraries and study rooms.
          </p>
          <a href={`mailto:${DEMO_EMAIL}`} className="mt-4 inline-block cursor-pointer text-sm text-gold-300 hover:underline">
            {DEMO_EMAIL}
          </a>
        </div>
        {cols.map(([h, ls]) => (
          <div key={h}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">{h}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {ls.map(([l, href]) => (
                <li key={l}>
                  <a href={href} className="cursor-pointer transition-colors hover:text-white">{l}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="container-x mt-12 flex flex-col justify-between gap-3 border-t border-white/10 pt-6 text-xs sm:flex-row">
        <p>© {new Date().getFullYear()} Library OS. All rights reserved.</p>
        <p>Made for study rooms and reading libraries.</p>
      </div>
    </footer>
  );
}

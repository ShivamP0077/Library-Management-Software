import { useRef, useState, useEffect } from 'react';
import { m, useScroll, useTransform } from 'framer-motion';
import { ArrowRight, CalendarClock, Check, IndianRupee, Armchair } from 'lucide-react';
import Scene3D from './Scene3D.jsx';
import { APP_URL, DEMO_HREF } from '../config.js';

const ease = [0.22, 1, 0.36, 1];

function Chip({ className, icon: Icon, title, sub, delay, tone = 'gold' }) {
  const tones = { gold: 'bg-gold-400/15 text-gold-300', green: 'bg-emerald-400/15 text-emerald-300' };
  return (
    <m.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, delay, ease }}
      className={`glass pointer-events-none absolute hidden items-center gap-3 rounded-2xl px-3.5 py-3 shadow-2xl md:flex ${className}`}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${tones[tone]}`}>
        <Icon size={18} />
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold text-white">{title}</span>
        <span className="block text-xs text-stone-400">{sub}</span>
      </span>
    </m.div>
  );
}

export default function Hero() {
  const ref = useRef(null);
  const [eventSource, setEventSource] = useState(null);
  useEffect(() => setEventSource(ref.current), []);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const sceneY = useTransform(scrollYProgress, [0, 1], ['0%', '18%']);
  const sceneOpacity = useTransform(scrollYProgress, [0, 0.85], [1, 0.2]);
  const textY = useTransform(scrollYProgress, [0, 1], ['0%', '-12%']);

  return (
    <section id="top" ref={ref} className="grain relative isolate overflow-hidden bg-ink-950 pt-16">
      {/* backdrop */}
      <div className="grid-lines absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_60%_40%,black_20%,transparent_70%)]" />
      <div className="absolute -top-40 right-[-10%] -z-10 h-[620px] w-[620px] rounded-full bg-gold-500/20 blur-[140px]" />
      <div className="absolute bottom-[-20%] left-[-10%] -z-10 h-[480px] w-[480px] rounded-full bg-amber-900/30 blur-[120px]" />

      <div className="container-x relative grid min-h-[calc(100svh-4rem)] items-center gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:pb-0">
        <m.div style={{ y: textY }} className="relative z-10 pt-10 lg:pt-0">
          <m.span
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
            className="eyebrow border-gold-400/30 bg-gold-400/10 text-gold-300"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-gold-400" /> For reading libraries & study rooms
          </m.span>
          <m.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.08, ease }}
            className="mt-6 font-display text-[2.4rem] font-black leading-[1.02] text-white sm:text-6xl xl:text-7xl"
          >
            Every seat, shift <br />
            and rupee — <br />
            <span className="text-gold-grad">on one screen.</span>
          </m.h1>
          <m.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.16, ease }}
            className="mt-6 max-w-xl text-base leading-relaxed text-stone-300 sm:text-lg"
          >
            Library OS replaces registers and spreadsheets with a live seat map, shift-based admissions, split payments
            with printable receipts, expenses and P&amp;L — plus a super admin view across every branch you run.
          </m.p>
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.24, ease }}
            className="mt-8 grid grid-cols-2 gap-3 sm:flex sm:items-center"
          >
            <a href={APP_URL} className="btn-gold group !px-3 !py-3.5 !text-[15px] sm:!px-6 sm:!text-base">
              Start free trial <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
            </a>
            <a href={DEMO_HREF} className="btn-ghost-dark !px-3 !py-3.5 !text-[15px] sm:!px-6 sm:!text-base">
              <CalendarClock size={18} /> Book a demo
            </a>
          </m.div>
          <m.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.32 }}
            className="mt-4 text-sm text-stone-400"
          >
            Already have an account?{' '}
            <a href={APP_URL} className="cursor-pointer font-semibold text-gold-300 underline-offset-4 hover:underline">
              Sign in with Google
            </a>
          </m.p>
          <m.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-8 hidden flex-wrap gap-x-6 gap-y-2 text-sm text-stone-400 sm:flex"
          >
            {['Runs in the browser', 'Google sign-in', 'Each library’s data kept separate'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check size={16} className="text-gold-400" /> {t}
              </li>
            ))}
          </m.ul>
        </m.div>

        <m.div
          style={{ y: sceneY, opacity: sceneOpacity }}
          className="relative -mx-5 h-[380px] sm:mx-0 sm:h-[520px] lg:absolute lg:inset-y-0 lg:right-[-2%] lg:h-auto lg:w-[60%]"
        >
          <Scene3D eventSource={eventSource} />
          <Chip className="left-[8%] top-[20%]" icon={Armchair} title="Seat 14 · Morning shift" sub="Assigned just now" delay={1.1} />
          <Chip className="bottom-[22%] right-[12%]" icon={IndianRupee} title="Split payment recorded" sub="Cash + UPI · receipt ready" delay={1.35} tone="green" />
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5, duration: 0.8 }}
            className="glass pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-4 rounded-full px-4 py-2 text-xs text-stone-300 lg:bottom-[10%]"
          >
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-gold-400" />Occupied</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-400" />Vacant</span>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-rose-400" />Maintenance</span>
          </m.div>
        </m.div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-ink-950" />
    </section>
  );
}

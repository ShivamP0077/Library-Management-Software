import { useRef, useState, useEffect } from 'react';
import { m, useScroll, useTransform } from 'framer-motion';
import { ArrowRight, CalendarClock } from 'lucide-react';
import Scene3D from './Scene3D.jsx';
import { APP_URL, DEMO_HREF } from '../config.js';

const ease = [0.22, 1, 0.36, 1];

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
      <div className="grid-lines absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_60%_40%,black_20%,transparent_70%)]" />
      <div className="absolute -top-40 right-[-10%] -z-10 h-[420px] w-[420px] rounded-full bg-gold-500/20 blur-[140px] md:h-[620px] md:w-[620px]" />
      <div className="absolute bottom-[-20%] left-[-10%] -z-10 h-[320px] w-[320px] rounded-full bg-amber-900/30 blur-[120px] md:h-[480px] md:w-[480px]" />

      <div className="container-x relative grid items-center gap-8 pb-14 pt-8 md:gap-12 md:pb-20 md:pt-14 xl:min-h-[calc(100svh-4rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] xl:gap-6 xl:pb-8 xl:pt-6">
        <m.div style={{ y: textY }} className="relative z-10 mx-auto w-full max-w-xl text-center xl:mx-0 xl:max-w-none xl:pt-4 xl:text-left">
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
            className="mt-5 font-display text-[2rem] font-black leading-[1.05] text-white md:mt-6 md:text-5xl xl:text-[3.35rem] xl:leading-[1.02]"
          >
            Every seat, shift <br />
            and rupee — <br />
            <span className="text-gold-grad">on one screen.</span>
          </m.h1>
          <m.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.16, ease }}
            className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-stone-300 md:mt-6 md:max-w-lg md:text-lg xl:mx-0"
          >
            The front desk for reading libraries: seats, shifts, admissions and fees, live on one screen.
          </m.p>
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.24, ease }}
            className="mx-auto mt-7 grid w-full max-w-md grid-cols-2 gap-3 md:mt-8 xl:mx-0 xl:max-w-none xl:flex xl:items-center"
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
        </m.div>

        <m.div
          style={{ y: sceneY, opacity: sceneOpacity }}
          className="relative mx-auto h-[340px] w-full max-w-lg sm:h-[400px] md:h-[460px] md:max-w-2xl xl:absolute xl:inset-y-0 xl:right-[-2%] xl:mx-0 xl:h-auto xl:max-w-none xl:w-[56%]"
        >
          <Scene3D eventSource={eventSource} />
        </m.div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-ink-950 md:h-24" />
    </section>
  );
}

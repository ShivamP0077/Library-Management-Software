import { m } from 'framer-motion';

export function Reveal({ children, delay = 0, y = 24, className = '', as = 'div' }) {
  const M = m[as];
  return (
    <M
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </M>
  );
}

export function SectionHeading({ eyebrow, title, sub, dark = false, center = true }) {
  return (
    <div className={`${center ? 'mx-auto text-center' : ''} max-w-3xl`}>
      {eyebrow && (
        <Reveal>
          <span
            className={`eyebrow ${dark ? 'border-gold-400/30 bg-gold-400/10 text-gold-300' : 'border-gold-600/25 bg-gold-500/10 text-gold-700'}`}
          >
            {eyebrow}
          </span>
        </Reveal>
      )}
      <Reveal delay={0.05}>
        <h2 className={`text-balance mt-5 font-display text-3xl font-bold leading-[1.1] sm:text-5xl ${dark ? 'text-white' : 'text-ink-950'}`}>
          {title}
        </h2>
      </Reveal>
      {sub && (
        <Reveal delay={0.1}>
          <p className={`text-pretty mt-5 text-base leading-relaxed sm:text-lg ${dark ? 'text-stone-400' : 'text-stone-600'}`}>{sub}</p>
        </Reveal>
      )}
    </div>
  );
}

export function SampleBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-dashed border-current px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-70 ${className}`}>
      Sample data
    </span>
  );
}

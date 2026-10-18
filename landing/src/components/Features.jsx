import { m } from 'framer-motion';
import {
  LayoutGrid, Clock3, UserPlus, Wallet, ReceiptText, PiggyBank, BarChart3, ShieldCheck, Building2, KeyRound,
} from 'lucide-react';
import { Reveal, SectionHeading } from './ui.jsx';

function SeatMini() {
  const pick = (i) => {
    const r = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    return r < 0.6 ? 'bg-gold-400' : r < 0.85 ? 'bg-emerald-400' : r < 0.94 ? 'bg-rose-400' : 'bg-stone-500';
  };
  return (
    <div className="mt-7 grid grid-cols-10 gap-1.5 sm:gap-2" aria-hidden="true">
      {Array.from({ length: 50 }).map((_, i) => (
        <m.span
          key={i}
          initial={{ opacity: 0, scale: 0.6 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 + (i % 10) * 0.03 + Math.floor(i / 10) * 0.05, duration: 0.4 }}
          className={`aspect-square rounded-[5px] ${pick(i)}`}
        />
      ))}
    </div>
  );
}

function SplitMini() {
  const parts = [
    ['Cash', 'w-[40%]', 'bg-ink'],
    ['UPI', 'w-[45%]', 'bg-gold-500'],
    ['Card', 'w-[15%]', 'bg-stone-400'],
  ];
  return (
    <div className="mt-6" aria-hidden="true">
      <div className="flex h-3 overflow-hidden rounded-full bg-stone-200">
        {parts.map(([l, w, bg], i) => (
          <m.span
            key={l}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 + i * 0.15, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: 'left' }}
            className={`${w} ${bg} h-full`}
          />
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-stone-600">
        {parts.map(([l, , bg]) => (
          <span key={l} className="flex items-center gap-1.5">
            <i className={`h-2 w-2 rounded-full ${bg}`} /> {l}
          </span>
        ))}
      </div>
    </div>
  );
}

const features = [
  { icon: LayoutGrid, title: 'Live seat map', body: 'See every seat at a glance — occupied, vacant or under maintenance — and assign the right seat for the right shift in a click.', span: 'lg:col-span-2 lg:row-span-2', extra: <SeatMini />, feature: true },
  { icon: Clock3, title: 'Shifts & timings', body: 'Define morning, evening or full-day shifts with their own fees, and book seats per shift.' },
  { icon: UserPlus, title: 'Student admissions', body: 'Admission forms with ID documents, bulk import, PDF student lists and past records you can restore.' },
  { icon: Wallet, title: 'Payments & split payments', body: 'Collect fees in cash, UPI or card — or a mix of all three in a single payment.', span: 'lg:col-span-2', extra: <SplitMini /> },
  { icon: ReceiptText, title: 'Printable receipts', body: 'Print a clean receipt with your library’s details for every payment, right at the desk.' },
  { icon: PiggyBank, title: 'Expenses', body: 'Log rent, electricity, salaries and supplies so costs sit right beside collections.' },
  { icon: BarChart3, title: 'Reports & P&L', body: 'Collections, expenses and profit & loss for the month, side by side.' },
  { icon: ShieldCheck, title: 'Staff permissions', body: 'Give each staff member exactly the access they need — nothing more.' },
  { icon: Building2, title: 'Multi-branch + super admin', body: 'Run several branches; a super admin sees totals across all, branch admins see only theirs.', span: 'lg:col-span-2' },
  { icon: KeyRound, title: 'Google sign-in', body: 'Sign in with your Google account — your email decides your role. No extra passwords to remember or reset.', span: 'lg:col-span-2' },
];

export default function Features() {
  return (
    <section id="features" className="relative overflow-hidden bg-paper py-24 text-ink-950 sm:py-32">
      <div className="grid-lines-light absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_60%)]" />
      <div className="container-x relative">
        <SectionHeading
          eyebrow="Features"
          title="Everything a reading library runs on"
          sub="Built around how study rooms actually work: seats sold by shift, monthly plans, mixed payment modes and owners who manage more than one branch."
        />
        <div className="mt-16 grid auto-rows-auto gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => (
            <Reveal
              key={f.title}
              delay={(i % 4) * 0.06}
              className={`group relative overflow-hidden rounded-3xl border p-6 transition-all duration-300 hover:-translate-y-1 sm:p-7 ${
                f.feature
                  ? 'border-ink bg-ink text-white shadow-card'
                  : 'border-stone-200 bg-white shadow-card hover:border-gold-500/40 hover:shadow-glow'
              } ${f.span || ''}`}
            >
              {f.feature && <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-gold-500/25 blur-3xl" />}
              <span
                className={`relative grid h-11 w-11 place-items-center rounded-2xl ${
                  f.feature ? 'bg-gold-400 text-ink-950' : 'bg-ink text-gold-400'
                }`}
              >
                <f.icon size={20} />
              </span>
              <h3 className={`relative mt-5 font-display text-xl font-bold ${f.feature ? 'sm:text-3xl' : ''}`}>{f.title}</h3>
              <p className={`relative mt-2 text-[15px] leading-relaxed ${f.feature ? 'max-w-md text-stone-300' : 'text-stone-600'}`}>{f.body}</p>
              {f.extra && <div className="relative">{f.extra}</div>}
              {f.feature && (
                <div className="relative mt-5 flex flex-wrap gap-4 text-xs text-stone-300">
                  <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-gold-400" />Occupied</span>
                  <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-400" />Vacant</span>
                  <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-rose-400" />Maintenance</span>
                  <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-stone-500" />Unavailable</span>
                </div>
              )}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

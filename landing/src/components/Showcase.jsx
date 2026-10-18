import { useRef, useState } from 'react';
import { m, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Users, Grid3x3, CreditCard, Receipt, BarChart3, Settings, Search, Printer, TrendingUp,
} from 'lucide-react';
import { SectionHeading, SampleBadge } from './ui.jsx';

const nav = [
  ['Dashboard', LayoutDashboard],
  ['Students', Users],
  ['Seat Map', Grid3x3],
  ['Payments & Fees', CreditCard],
  ['Expenses', Receipt],
  ['Reports & P&L', BarChart3],
  ['Library Settings', Settings],
];

function Kpi({ label, value, tone = 'text-ink-950', foot }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">{label}</p>
      <p className={`mt-1.5 font-display text-lg font-bold sm:text-2xl ${tone}`}>{value}</p>
      {foot && <p className="mt-1 text-[11px] text-stone-500">{foot}</p>}
    </div>
  );
}

const bars = [42, 58, 51, 66, 72, 61, 79, 74, 83, 70, 88, 81];

function DashboardView() {
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Today’s collections" value="₹ 8,450" foot="Cash · UPI · Card" />
        <Kpi label="Active students" value="126" foot="Across all shifts" />
        <Kpi label="Seat occupancy" value="82%" tone="text-gold-700" foot="Morning shift" />
        <Kpi label="Monthly net profit" value="₹ 64,300" tone="text-emerald-700" foot="After expenses" />
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink-950">Collections vs expenses</p>
            <span className="flex items-center gap-1 text-xs text-stone-500"><TrendingUp size={14} /> Monthly</span>
          </div>
          <div className="mt-4 flex h-32 items-end gap-1.5 sm:h-40 sm:gap-2">
            {bars.map((h, i) => (
              <div key={i} className="flex h-full flex-1 flex-col justify-end gap-1">
                <m.div
                  initial={{ height: 0 }}
                  whileInView={{ height: `${h * 0.72}%` }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04, duration: 0.6 }}
                  className="rounded-t-md bg-gradient-to-t from-gold-600 to-gold-400"
                />
                <div className="rounded-sm bg-stone-300" style={{ height: `${h * 0.26}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-sm font-semibold text-ink-950">Fees due this week</p>
          <ul className="mt-3 space-y-2.5">
            {['Student 0142', 'Student 0087', 'Student 0203', 'Student 0019'].map((n, i) => (
              <li key={n} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-stone-100 text-[10px] font-bold text-stone-600">S{i + 1}</span>
                  <span>
                    <span className="block font-medium text-ink-950">{n}</span>
                    <span className="block text-stone-500">Seat {12 + i * 7} · {['Morning', 'Evening', 'Full day', 'Morning'][i]}</span>
                  </span>
                </span>
                <span className={`rounded-full px-2 py-0.5 font-semibold ${i === 0 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
                  {i === 0 ? 'Overdue' : `In ${i + 1}d`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SeatView() {
  const st = ['occ', 'occ', 'vac', 'occ', 'occ', 'mnt', 'occ', 'vac', 'occ', 'occ'];
  const tone = { occ: 'border-gold-500/40 bg-gold-50 text-gold-800', vac: 'border-emerald-300 bg-emerald-50 text-emerald-800', mnt: 'border-rose-200 bg-rose-50 text-rose-700' };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {['Morning', 'Evening', 'Full day'].map((s, i) => (
          <span key={s} className={`rounded-full px-3 py-1 text-xs font-semibold ${i === 0 ? 'bg-ink text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200'}`}>{s}</span>
        ))}
        <span className="ml-auto hidden gap-3 text-[11px] text-stone-600 sm:flex">
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-gold-500" />Occupied</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />Vacant</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-rose-400" />Maintenance</span>
        </span>
      </div>
      <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-10 sm:gap-2">
        {Array.from({ length: 50 }).map((_, i) => {
          const s = st[(i * 7 + 2) % st.length];
          return (
            <m.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.008 }}
              className={`grid aspect-square place-items-center rounded-lg border text-[10px] font-semibold sm:text-xs ${tone[s]}`}
            >
              {i + 1}
            </m.div>
          );
        })}
      </div>
    </div>
  );
}

function PaymentView() {
  const rows = [
    ['Student 0142', 'Monthly · Morning', 'Cash + UPI'],
    ['Student 0087', 'Monthly · Evening', 'UPI'],
    ['Student 0203', 'Quarterly · Full day', 'Card + Cash'],
    ['Student 0019', 'Monthly · Morning', 'Cash'],
    ['Student 0311', 'Admission + Monthly', 'UPI'],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-3">
        <Search size={14} className="text-stone-400" />
        <span className="text-xs text-stone-400">Search payments…</span>
      </div>
      <table className="w-full text-left text-xs">
        <thead className="bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Student</th>
            <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Plan</th>
            <th className="px-4 py-2.5 font-semibold">Mode</th>
            <th className="px-4 py-2.5 text-right font-semibold">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([n, p, mode]) => (
            <tr key={n} className="border-t border-stone-100">
              <td className="px-4 py-3 font-medium text-ink-950">{n}</td>
              <td className="hidden px-4 py-3 text-stone-600 sm:table-cell">{p}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${mode.includes("+") ? 'bg-gold-50 text-gold-800' : 'bg-stone-100 text-stone-700'}`}>{mode}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-stone-700"><Printer size={12} /> Print</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tabs = [
  ['Dashboard', DashboardView, 0],
  ['Seat Map', SeatView, 2],
  ['Payments', PaymentView, 3],
];

export default function Showcase() {
  const ref = useRef(null);
  const [tab, setTab] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center'] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [22, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.9, 1]);
  const View = tabs[tab][1];

  return (
    <section id="product" className="relative overflow-hidden bg-ink-950 py-24 sm:py-32">
      <div className="absolute left-1/2 top-1/3 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-gold-500/15 blur-[140px]" />
      <div className="container-x relative">
        <SectionHeading
          dark
          eyebrow="Product tour"
          title="One dashboard for the whole front desk"
          sub="The same screens your staff use every day: collections, occupancy, fees due, the seat map and every payment with a receipt one click away."
        />
        <div className="mt-10 flex justify-center">
          <div role="tablist" aria-label="Product views" className="glass inline-flex rounded-full p-1">
            {tabs.map(([label], i) => (
              <button
                key={label}
                role="tab"
                aria-selected={tab === i}
                onClick={() => setTab(i)}
                className={`cursor-pointer whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold transition-colors duration-200 sm:px-5 ${
                  tab === i ? 'bg-gold-400 text-ink-950' : 'text-stone-300 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div ref={ref} className="mt-10" style={{ perspective: '1600px' }}>
          <m.div
            style={{ rotateX, scale, transformOrigin: 'center top' }}
            className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-white/15 bg-ink-800 shadow-[0_40px_120px_-30px_rgba(202,138,4,.45)] sm:rounded-3xl"
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-rose-400/80" />
              <span className="h-3 w-3 rounded-full bg-amber-400/80" />
              <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
              <span className="mx-auto hidden rounded-md bg-white/5 px-24 py-1 text-xs text-stone-500 sm:block">your-library · Library OS</span>
              <SampleBadge className="ml-auto text-gold-300 sm:ml-0" />
            </div>
            <div className="flex bg-stone-100">
              <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-stone-200 bg-white p-3 md:flex">
                <div className="mb-3 flex items-center gap-2 px-2 py-2">
                  <img src="/favicon.svg" alt="" className="h-7 w-7" />
                  <div className="leading-tight">
                    <p className="text-sm font-bold text-ink-950">Your Library</p>
                    <p className="text-[11px] text-stone-500">Library Management OS</p>
                  </div>
                </div>
                {nav.map(([l, I], i) => {
                  const active = tabs[tab][2] === i;
                  return (
                    <div key={l} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium ${active ? 'bg-ink text-white' : 'text-stone-600'}`}>
                      <I size={15} className={active ? 'text-gold-400' : ''} /> {l}
                    </div>
                  );
                })}
              </aside>
              <div className="min-h-[420px] flex-1 p-3 text-ink-950 sm:min-h-[460px] sm:p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="font-display text-lg font-bold">{tabs[tab][0]}</p>
                  <span className="rounded-lg bg-white px-2.5 py-1 text-xs text-stone-500 ring-1 ring-stone-200">Main branch</span>
                </div>
                <AnimatePresence mode="wait">
                  <m.div
                    key={tab}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                  >
                    <View />
                  </m.div>
                </AnimatePresence>
              </div>
            </div>
          </m.div>
        </div>
        <p className="mt-6 text-center text-xs text-stone-500">Illustrative interface with placeholder data.</p>
      </div>
    </section>
  );
}

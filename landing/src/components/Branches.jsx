import { Crown, Building2, UserCog, Lock } from 'lucide-react';
import { m } from 'framer-motion';
import { Reveal, SectionHeading, SampleBadge } from './ui.jsx';

const roles = [
  { icon: Crown, title: 'Super admin', body: 'Sees every client library and branch in one overview — total seats, occupancy, students and revenue — and can drill into any of them.' },
  { icon: Building2, title: 'Library admin', body: 'Runs their own library end to end: students, seats, shifts, payments and expenses. Other libraries’ data is never visible to them.' },
  { icon: UserCog, title: 'Staff', body: 'Front-desk access shaped by permissions — admit students and collect fees without seeing what they don’t need.' },
];

const branches = [
  ['Library A — Main', 120, 0.86, '₹ 1.4L'],
  ['Library A — Annexe', 64, 0.71, '₹ 62K'],
  ['Library B', 90, 0.78, '₹ 98K'],
  ['Library C', 48, 0.54, '₹ 41K'],
];

export default function Branches() {
  return (
    <section id="branches" className="grain relative overflow-hidden bg-ink-950 py-24 sm:py-32">
      <div className="absolute -left-40 top-20 h-[420px] w-[420px] rounded-full bg-gold-500/15 blur-[120px]" />
      <div className="container-x relative grid items-center gap-14 lg:grid-cols-2">
        <div>
          <SectionHeading
            dark
            center={false}
            eyebrow="Multi-branch & roles"
            title="From one study room to a whole network"
            sub="A clear hierarchy keeps everyone in their lane. Data is separated per library on the server, so each client only ever sees their own records."
          />
          <div className="mt-10 space-y-4">
            {roles.map((r, i) => (
              <Reveal key={r.title} delay={i * 0.08} className="glass flex gap-4 rounded-2xl p-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gold-400/15 text-gold-300">
                  <r.icon size={20} />
                </span>
                <div>
                  <h3 className="font-display text-lg font-bold text-white">{r.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-stone-400">{r.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <Reveal delay={0.1} className="relative">
          <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-gold-400/20 via-transparent to-transparent blur-2xl" />
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-800/90 p-5 shadow-2xl backdrop-blur sm:p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown size={18} className="text-gold-400" />
                <p className="font-display font-bold text-white">Super admin overview</p>
              </div>
              <SampleBadge className="text-gold-300" />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                ['Libraries', '3'],
                ['Total seats', '322'],
                ['Revenue (mo.)', '₹ 3.4L'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">{k}</p>
                  <p className="mt-1 font-display text-xl font-bold text-white sm:text-2xl">{v}</p>
                </div>
              ))}
            </div>
            <ul className="mt-5 space-y-3">
              {branches.map(([name, seats, occ, rev], i) => (
                <li key={name} className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-stone-100">{name}</span>
                    <span className="font-semibold text-gold-300">{rev}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <m.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${occ * 100}%` }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.3 + i * 0.1, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                        className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-300"
                      />
                    </div>
                    <span className="w-28 text-right text-xs text-stone-400">{Math.round(occ * 100)}% of {seats} seats</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-5 flex items-center gap-2 text-xs text-stone-500">
              <Lock size={13} /> Library admins see only their own row.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

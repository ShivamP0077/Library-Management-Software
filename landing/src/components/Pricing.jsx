import { Check } from 'lucide-react';
import { APP_URL, DEMO_HREF } from '../config.js';
import { Reveal, SectionHeading } from './ui.jsx';

const tiers = [
  {
    name: 'Starter',
    price: '₹ —',
    note: 'per month',
    desc: 'For a single study room getting off registers.',
    features: ['1 library', 'Seat map, shifts & admissions', 'Payments, split payments & receipts', 'Expenses and monthly P&L', 'Google sign-in'],
    cta: ['Start free trial', APP_URL],
  },
  {
    name: 'Growth',
    price: '₹ —',
    note: 'per month',
    desc: 'For busy libraries with a front-desk team.',
    features: ['Everything in Starter', 'Multiple branches', 'Staff accounts & permissions', 'Bulk student import', 'Priority support'],
    cta: ['Start free trial', APP_URL],
    featured: true,
  },
  {
    name: 'Network',
    price: 'Custom',
    note: 'talk to us',
    desc: 'For operators running many client libraries.',
    features: ['Everything in Growth', 'Super admin overview across clients', 'Per-client data isolation', 'Onboarding help', 'Custom terms'],
    cta: ['Book a demo', DEMO_HREF],
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="relative overflow-hidden bg-paper py-24 text-ink-950 sm:py-32">
      <div className="container-x">
        <SectionHeading eyebrow="Pricing" title="Simple plans that grow with you" sub="Start with a free trial. Pick a plan when you’re ready." />
        <Reveal className="mx-auto mt-6 flex justify-center">
          <span className="rounded-full border border-dashed border-gold-600/50 bg-gold-500/10 px-3 py-1 text-xs font-semibold text-gold-800">
            Placeholder — plans and prices are not final
          </span>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-6xl gap-5 lg:grid-cols-3">
          {tiers.map((t, i) => (
            <Reveal
              key={t.name}
              delay={i * 0.08}
              className={`relative flex flex-col rounded-3xl p-7 sm:p-8 ${
                t.featured ? 'bg-ink text-white shadow-[0_30px_80px_-30px_rgba(161,98,7,.6)] ring-1 ring-gold-400/40 lg:-my-4 lg:py-12' : 'border border-stone-200 bg-white shadow-card'
              }`}
            >
              {t.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gold-400 px-3 py-1 text-xs font-bold text-ink-950">Recommended</span>
              )}
              <h3 className="font-display text-xl font-bold">{t.name}</h3>
              <p className={`mt-1 text-sm ${t.featured ? 'text-stone-400' : 'text-stone-600'}`}>{t.desc}</p>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="font-display text-4xl font-black">{t.price}</span>
                <span className={`text-sm ${t.featured ? 'text-stone-400' : 'text-stone-500'}`}>{t.note}</span>
              </p>
              <ul className="mt-6 flex-1 space-y-3">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-[15px]">
                    <Check size={18} className={`mt-0.5 shrink-0 ${t.featured ? 'text-gold-400' : 'text-gold-600'}`} />
                    <span className={t.featured ? 'text-stone-200' : 'text-stone-700'}>{f}</span>
                  </li>
                ))}
              </ul>
              <a href={t.cta[1]} className={`mt-8 w-full ${t.featured ? 'btn-gold' : 'btn-outline'}`}>
                {t.cta[0]}
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

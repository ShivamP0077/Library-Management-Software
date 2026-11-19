import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { APP_URL, DEMO_PATH } from '../config.js';
import { catalogueUrl, formatInrFromMinor, intervalPrice, recommendedId } from '../planCatalogue.js';
import { Reveal, SectionHeading } from './ui.jsx';

const DURATIONS = [
  ['month', '1 month'],
  ['quarter', '3 months'],
  ['year', '12 months'],
];

const custom = {
  name: 'Custom',
  price: 'Custom',
  note: 'talk to us',
  desc: 'For operators running many client libraries.',
  features: ['Everything in Growth', 'Super admin overview across clients', 'Per-client data isolation', 'Onboarding help', 'Custom terms'],
  cta: ['Book a demo', DEMO_PATH],
  secondary: ['Contact sales', DEMO_PATH],
};

export default function Pricing() {
  const [interval, setInterval] = useState('month');
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  const apiBase = import.meta.env.VITE_API_URL;

  useEffect(() => {
    const url = catalogueUrl(apiBase);
    if (!url) {
      setError('Live prices are unavailable because the pricing service is not configured.');
      setPlans([]);
      return undefined;
    }
    let cancel = false;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Could not load plans');
        return res.json();
      })
      .then(body => { if (!cancel) setPlans(body.plans || []); })
      .catch(() => { if (!cancel) { setPlans([]); setError('Live prices are unavailable right now.'); } });
    return () => { cancel = true; };
  }, [apiBase]);

  const featuredId = recommendedId(plans || []);
  const loading = plans == null;

  return (
    <section id="pricing" className="relative overflow-hidden bg-paper py-24 text-ink-950 sm:py-32">
      <div className="container-x">
        <SectionHeading eyebrow="Pricing" title="Simple plans that grow with you" sub="Start with a free trial. Pick a plan when you’re ready." />
        <Reveal className="mx-auto mt-8 flex max-w-md justify-center">
          <div role="group" aria-label="Billing duration" className="grid w-full grid-cols-3 gap-1 rounded-full bg-white p-1 shadow-card">
            {DURATIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={interval === value}
                onClick={() => setInterval(value)}
                className={`rounded-full px-3 py-2 text-sm font-bold ${interval === value ? 'bg-ink text-white' : 'text-stone-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Reveal>
        {loading && <p className="mt-8 text-center text-sm text-stone-600">Loading plans…</p>}
        {error && <p className="mt-8 text-center text-sm text-stone-600" role="status">{error}</p>}
        <div className="mx-auto mt-12 grid max-w-6xl gap-5 lg:grid-cols-3">
          {(plans || []).map((plan) => {
            const price = intervalPrice(plan, interval);
            const featured = plan.planId === featuredId;
            const trial = Number(plan.trialDays) > 0 ? `${plan.trialDays}-day free trial` : null;
            const lines = plan.highlights || [];
            return (
              <Reveal
                key={plan.planId}
                className={`relative flex flex-col rounded-3xl p-7 sm:p-8 ${
                  featured ? 'bg-ink text-white shadow-[0_30px_80px_-30px_rgba(161,98,7,.6)] ring-1 ring-gold-400/40 lg:-my-4 lg:py-12' : 'border border-stone-200 bg-white shadow-card'
                }`}
              >
                {featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gold-400 px-3 py-1 text-xs font-bold text-ink-950">Recommended</span>
                )}
                <h3 className="font-display text-xl font-bold">{plan.name}</h3>
                <p className={`mt-1 text-sm ${featured ? 'text-stone-400' : 'text-stone-600'}`}>{plan.description}</p>
                {price ? (
                  <div className="mt-6">
                    <p className="flex items-baseline gap-2">
                      <span className="font-display text-4xl font-black">{formatInrFromMinor(price.finalMinor)}</span>
                      <span className={`text-sm ${featured ? 'text-stone-400' : 'text-stone-500'}`}>/ {DURATIONS.find(row => row[0] === interval)?.[1]}</span>
                    </p>
                    {price.savingMinor > 0 && (
                      <p className={`mt-1 text-sm ${featured ? 'text-stone-300' : 'text-stone-500'}`}>
                        <span className="line-through">{formatInrFromMinor(price.originalMinor)}</span>
                        {' '}Save {formatInrFromMinor(price.savingMinor)}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className={`mt-6 text-sm ${featured ? 'text-stone-400' : 'text-stone-500'}`}>Not offered for this duration</p>
                )}
                {trial && <p className={`mt-3 text-sm font-semibold ${featured ? 'text-gold-300' : 'text-gold-700'}`}>{trial}</p>}
                <ul className="mt-6 flex-1 space-y-3">
                  {lines.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[15px]">
                      <Check size={18} className={`mt-0.5 shrink-0 ${featured ? 'text-gold-400' : 'text-gold-600'}`} />
                      <span className={featured ? 'text-stone-200' : 'text-stone-700'}>{f}</span>
                    </li>
                  ))}
                </ul>
                <a href={APP_URL} className={`mt-8 w-full ${featured ? 'btn-gold' : 'btn-outline'}`}>Start Free Trial</a>
              </Reveal>
            );
          })}
          <Reveal
            className="relative flex flex-col rounded-3xl border border-stone-200 bg-white p-7 shadow-card sm:p-8"
          >
            <h3 className="font-display text-xl font-bold">{custom.name}</h3>
            <p className="mt-1 text-sm text-stone-600">{custom.desc}</p>
            <p className="mt-6 flex items-baseline gap-2">
              <span className="font-display text-4xl font-black">{custom.price}</span>
              <span className="text-sm text-stone-500">{custom.note}</span>
            </p>
            <ul className="mt-6 flex-1 space-y-3">
              {custom.features.map((f) => (
                <li key={f} className="flex gap-2.5 text-[15px]">
                  <Check size={18} className="mt-0.5 shrink-0 text-gold-600" />
                  <span className="text-stone-700">{f}</span>
                </li>
              ))}
            </ul>
            <a href={custom.cta[1]} className="btn-outline mt-8 w-full">{custom.cta[0]}</a>
            <a href={custom.secondary[1]} className="mt-3 text-center text-sm font-semibold text-stone-600 underline">{custom.secondary[0]}</a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

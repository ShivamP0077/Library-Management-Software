import { useRef } from 'react';
import { m, useScroll, useTransform } from 'framer-motion';
import { Wand2, UserPlus, IndianRupee } from 'lucide-react';
import { Reveal, SectionHeading } from './ui.jsx';

const steps = [
  { icon: Wand2, title: 'Set up your library', body: 'A guided setup wizard captures your branches, seat layout, shifts and fee plans. Invite staff and choose what each person can access.' },
  { icon: UserPlus, title: 'Admit students & assign seats', body: 'Add students one by one or in bulk, attach their documents, pick a shift and drop them onto a free seat on the map.' },
  { icon: IndianRupee, title: 'Collect fees & watch the numbers', body: 'Record payments in any mix of cash, UPI and card, print receipts, log expenses and check your monthly P&L.' },
];

export default function HowItWorks() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 75%', 'end 60%'] });
  const width = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);

  return (
    <section id="how" className="relative bg-paper py-24 text-ink-950 sm:py-32">
      <div className="container-x">
        <SectionHeading eyebrow="How it works" title="Up and running in three steps" sub="No installs and no hardware — Library OS runs in the browser on the computer or phone you already have." />
        <div ref={ref} className="relative mt-16">
          <div className="absolute left-[16.66%] right-[16.66%] top-7 hidden h-px bg-stone-300 md:block">
            <m.div style={{ width }} className="h-full bg-gradient-to-r from-gold-500 to-gold-400" />
          </div>
          <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
            {steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 0.12} className="relative text-center">
                <div className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ink text-gold-400 shadow-card ring-8 ring-paper">
                  <s.icon size={22} />
                  <span className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-gold-400 text-xs font-bold text-ink-950">{i + 1}</span>
                </div>
                <h3 className="mt-6 font-display text-xl font-bold">{s.title}</h3>
                <p className="mx-auto mt-2 max-w-xs text-[15px] leading-relaxed text-stone-600">{s.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

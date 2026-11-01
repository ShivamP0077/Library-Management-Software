import { X, Check } from 'lucide-react';
import { Reveal, SectionHeading } from './ui.jsx';

const rows = [
  ['Seats tracked in a register — the same seat gets promised twice.', 'A live, colour-coded seat map shows which seats are taken and in which shift — before you promise one.'],
  ['Fee due dates live in someone’s head or a WhatsApp chat.', 'Each admission carries its plan and due date, so upcoming and overdue fees are easy to spot.'],
  ['Cash, UPI and card collections never quite add up at night.', 'Record a single fee across cash, UPI and card, and print a receipt on the spot.'],
  ['Rent, electricity and salaries sit in a separate notebook.', 'Expenses sit next to collections, so monthly profit & loss is a report, not a guess.'],
  ['Two or more branches means two or more sets of books.', 'A super admin sees every branch in one place; each branch admin sees only their own.'],
];

export default function Problem() {
  return (
    <section className="relative bg-ink-950 py-24 sm:py-32">
      <div className="container-x">
        <SectionHeading
          dark
          eyebrow="Why Library OS"
          title={<>Your study room is busy. <span className="text-stone-500">Your paperwork shouldn’t be.</span></>}
          sub="Running a reading library means juggling seats, shifts, admissions, fees and staff every single day. Library OS turns that juggling act into one calm, organised system."
        />
        <div className="mx-auto mt-16 max-w-5xl overflow-hidden rounded-3xl border border-white/10">
          <div className="hidden grid-cols-2 border-b border-white/10 bg-white/[0.03] text-xs font-semibold uppercase tracking-[0.14em] sm:grid">
            <div className="px-6 py-4 text-stone-500">The register way</div>
            <div className="border-l border-white/10 px-6 py-4 text-gold-300">With Library OS</div>
          </div>
          {rows.map(([before, after], i) => (
            <Reveal key={i} delay={i * 0.05} className="grid border-b border-white/10 last:border-b-0 sm:grid-cols-2">
              <div className="flex gap-3 px-6 py-5 text-stone-400">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-rose-500/10 text-rose-400">
                  <X size={12} strokeWidth={3} />
                </span>
                <p className="text-[15px] leading-relaxed">{before}</p>
              </div>
              <div className="flex gap-3 bg-gradient-to-r from-gold-500/[0.06] to-transparent px-6 py-5 text-stone-100 sm:border-l sm:border-white/10">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gold-400/15 text-gold-300">
                  <Check size={12} strokeWidth={3} />
                </span>
                <p className="text-[15px] leading-relaxed">{after}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

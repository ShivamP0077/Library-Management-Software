import { useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { Plus } from 'lucide-react';
import { SectionHeading } from './ui.jsx';

const faqs = [
  ['Who is Library OS for?', 'Owners and managers of reading libraries, study rooms and self-study halls where students rent a seat for a shift or a full day, usually on a monthly plan.'],
  ['Do I need to install anything?', 'No. Library OS is a web app — open it in a modern browser and sign in. There is no hardware or software to install.'],
  ['How does sign-in work?', 'You sign in with your Google account. Your email address is linked to your role — super admin or library admin — so there are no separate passwords to manage.'],
  ['Can I manage more than one branch?', 'Yes. You can set up multiple branches, and a super admin gets a combined overview of seats, occupancy and revenue across all of them.'],
  ['Can other libraries see my data?', 'No. Each client library’s records are kept separate on the server, and library admins can only access their own library.'],
  ['Can a student pay part in cash and part by UPI?', 'Yes. A single payment can be split across cash, UPI and card, and a printable receipt is generated for it.'],
  ['Can my staff use it without seeing everything?', 'Yes. Staff permissions let you decide which sections each team member can open and what they can change.'],
  ['How do I get started?', 'Start a free trial from this page, or book a demo and we’ll walk you through setting up your seats, shifts and fee plans.'],
];

function Item({ q, a, open, onToggle, id }) {
  return (
    <div className="border-b border-stone-200">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`faq-${id}`}
          className="flex w-full cursor-pointer items-center justify-between gap-6 py-5 text-left font-display text-lg font-bold text-ink-950"
        >
          {q}
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-all duration-300 ${open ? 'rotate-45 border-gold-600 bg-gold-500 text-white' : 'border-stone-300 text-stone-600'}`}>
            <Plus size={16} />
          </span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            id={`faq-${id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="pb-5 pr-12 text-[15px] leading-relaxed text-stone-600">{a}</p>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FAQ() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="bg-paper pb-24 text-ink-950 sm:pb-32">
      <div className="container-x grid gap-12 border-t border-stone-200 pt-24 sm:pt-32 lg:grid-cols-[1fr_1.5fr]">
        <SectionHeading center={false} eyebrow="FAQ" title="Questions, answered" sub="Anything else? Book a demo and ask us directly." />
        <div>
          {faqs.map(([q, a], i) => (
            <Item key={q} id={i} q={q} a={a} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </div>
      </div>
    </section>
  );
}

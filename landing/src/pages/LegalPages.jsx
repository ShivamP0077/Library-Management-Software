import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { DEMO_EMAIL } from '../config.js';

const EFFECTIVE = '14 November 2026';

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-bold text-ink-950">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-stone-700">{children}</div>
    </section>
  );
}

function LegalLayout({ title, intro, children }) {
  return (
    <>
      <a href="#main" className="sr-only z-[60] rounded-lg bg-gold-400 px-4 py-2 font-semibold text-ink-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <Nav home={false} />
      <main id="main" className="min-h-screen bg-paper pb-24 pt-28 text-ink-950">
        <article className="container-x">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm font-medium text-stone-500">Effective {EFFECTIVE}</p>
            <h1 className="mt-3 font-display text-4xl font-black tracking-tight text-ink-950 sm:text-5xl">{title}</h1>
            <p className="mt-5 text-base leading-relaxed text-stone-700">{intro}</p>
            {children}
          </div>
        </article>
      </main>
      <Footer home={false} />
    </>
  );
}

function DigitalNote() {
  return (
    <p>
      My Library OS is digital software (SaaS). We do not sell physical goods and we do not ship anything.
      After a successful payment, access to the paid plan is available straight away.
    </p>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      intro="This policy explains what My Library OS collects when you create an account, run your library, or pay for a plan. It applies to mylibraryos.in and the My Library OS app."
    >
      <Section title="Who we are">
        <p>
          My Library OS is library management software for study libraries and reading rooms.
          We operate from Bangalore, Karnataka, India. For privacy questions, email{' '}
          <a className="cursor-pointer font-medium text-gold-700 underline decoration-gold-600/40 underline-offset-2 hover:text-gold-600" href={`mailto:${DEMO_EMAIL}`}>{DEMO_EMAIL}</a>.
        </p>
      </Section>
      <Section title="Account data">
        <p>
          When you sign up or are invited, we store the details needed to run your login: name, email address,
          mobile number if you provide one, password (stored only as a hash) or Google sign-in identifier,
          library name, and role.
        </p>
      </Section>
      <Section title="Library and student data you enter">
        <p>
          The product stores what you and your staff type in for your library. That can include student names,
          contact details, photos, seat and shift assignments, admissions, fee plans, attendance, and notes.
          You decide what to enter. You are responsible for having a proper reason to keep your students’ information.
        </p>
      </Section>
      <Section title="Billing">
        <p>
          For paid plans and wallet top-ups we keep the plan you chose, the amount in Indian Rupees (INR),
          invoice and payment status, and a wallet balance if you use one. Card, UPI and net-banking details
          are collected by the payment processor, not typed into My Library OS. We do not store full card numbers.
        </p>
      </Section>
      <Section title="Cookies">
        <p>
          We use cookies and similar storage that are needed to keep you signed in, remember basic preferences,
          and protect the service. We do not use them to sell advertising profiles.
        </p>
      </Section>
      <Section title="Who we share data with">
        <p>
          We share billing information with payment processors such as Razorpay so they can take or reverse a payment.
          We may also use an email provider to send account messages, and a host to store the service.
          We do not sell account, library or student data.
        </p>
      </Section>
      <Section title="Where data is handled">
        <p>
          My Library OS is offered from India. We keep information for as long as your library account is active
          and as needed for billing records and legal duties. You can email us to ask about access or deletion.
        </p>
      </Section>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout
      title="Terms & Conditions"
      intro="These terms cover use of My Library OS, the library management software at mylibraryos.in. By creating an account or paying for a plan, you agree to them."
    >
      <Section title="The service">
        <p>
          My Library OS is software for study libraries and reading rooms: seats, shifts, admissions, fees,
          receipts and reports. Features depend on the plan you choose. We may update the product over time.
        </p>
        <DigitalNote />
      </Section>
      <Section title="Accounts">
        <p>
          You need an account to use the app. Keep your password private and tell us if you think someone else
          has used it. You are responsible for staff you invite and for the library and student records they add.
          One library’s data is not shared with another library’s users.
        </p>
      </Section>
      <Section title="Acceptable use">
        <p>
          Use the service for your own library. Do not break the law, upload content you have no right to store,
          attempt to access another library’s data, or interfere with the service. We may suspend an account that
          is used this way.
        </p>
      </Section>
      <Section title="Prices">
        <p>
          Plan fees and wallet top-ups are charged in Indian Rupees (INR). The price, billing period and what is
          included are shown before you pay. Taxes are added when they apply and are shown at checkout.
        </p>
      </Section>
      <Section title="Cancellation">
        <p>
          You can cancel any time. There is no lock-in. Access continues until the end of the period you have
          already paid for. Refunds follow our <a className="cursor-pointer font-medium text-gold-700 underline decoration-gold-600/40 underline-offset-2 hover:text-gold-600" href="/refund">Refund & Cancellation Policy</a>.
        </p>
      </Section>
      <Section title="Liability">
        <p>
          The service is provided as available. We work to keep it running, but we do not promise that it will
          be uninterrupted. To the extent Indian law allows, our liability for a claim about the paid service
          is limited to the fees you paid us for My Library OS in the three months before the claim. Nothing
          in these terms limits liability that the law says we cannot limit.
        </p>
      </Section>
      <Section title="Law">
        <p>
          These terms are governed by the laws of India. The courts of Bangalore, Karnataka have jurisdiction,
          subject to any rights you have as a consumer that cannot be waived.
        </p>
        <p>
          Questions: <a className="cursor-pointer font-medium text-gold-700 underline decoration-gold-600/40 underline-offset-2 hover:text-gold-600" href={`mailto:${DEMO_EMAIL}`}>{DEMO_EMAIL}</a>.
          Bangalore, Karnataka, India.
        </p>
      </Section>
    </LegalLayout>
  );
}

export function RefundPage() {
  return (
    <LegalLayout
      title="Refund & Cancellation Policy"
      intro="This policy explains when My Library OS subscription fees and wallet top-ups are refunded, and how cancellation works."
    >
      <Section title="Digital service">
        <DigitalNote />
      </Section>
      <Section title="Subscription fees">
        <p>
          Subscription fees are non-refundable except for a failed or duplicate capture, a reversal the payment
          provider has approved, or where the law requires a refund.
        </p>
      </Section>
      <Section title="Wallet top-ups">
        <p>
          Voluntary wallet top-ups are non-refundable except for a failed or duplicated capture.
        </p>
      </Section>
      <Section title="Cancellation">
        <p>
          You can cancel any time. There is no lock-in. After you cancel, access continues until the paid period ends.
          Cancelling stops the next charge; it does not by itself refund the current period.
        </p>
      </Section>
      <Section title="Failed or duplicate payments">
        <p>
          If money left your account but the plan was not activated, or the same payment was captured twice,
          email <a className="cursor-pointer font-medium text-gold-700 underline decoration-gold-600/40 underline-offset-2 hover:text-gold-600" href={`mailto:${DEMO_EMAIL}`}>{DEMO_EMAIL}</a> with
          the payment reference. We will check with the payment processor (such as Razorpay) and arrange a refund
          of the failed or duplicate amount.
        </p>
        <p>My Library OS, Bangalore, Karnataka, India.</p>
      </Section>
    </LegalLayout>
  );
}

export function ContactPage() {
  return (
    <LegalLayout
      title="Contact Us"
      intro="Write to us about your account, a payment, or these policies. We reply by email."
    >
      <Section title="Email">
        <p>
          <a className="cursor-pointer text-lg font-semibold text-gold-700 underline decoration-gold-600/40 underline-offset-2 hover:text-gold-600" href={`mailto:${DEMO_EMAIL}`}>{DEMO_EMAIL}</a>
        </p>
      </Section>
      <Section title="Address">
        <p>Bangalore, Karnataka, India.</p>
      </Section>
      <Section title="What we sell">
        <DigitalNote />
      </Section>
      <Section title="Policies">
        <ul className="list-disc space-y-2 pl-5">
          <li><a className="cursor-pointer text-gold-700 underline decoration-gold-600/40 underline-offset-2 hover:text-gold-600" href="/privacy">Privacy Policy</a></li>
          <li><a className="cursor-pointer text-gold-700 underline decoration-gold-600/40 underline-offset-2 hover:text-gold-600" href="/terms">Terms & Conditions</a></li>
          <li><a className="cursor-pointer text-gold-700 underline decoration-gold-600/40 underline-offset-2 hover:text-gold-600" href="/refund">Refund & Cancellation Policy</a></li>
        </ul>
      </Section>
    </LegalLayout>
  );
}

const PAGES = {
  '/privacy': PrivacyPage,
  '/terms': TermsPage,
  '/refund': RefundPage,
  '/contact': ContactPage,
};

export function LegalRoute({ path }) {
  const Page = PAGES[path];
  if (!Page) return null;
  return <Page />;
}

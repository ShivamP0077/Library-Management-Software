import { useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';

const API = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Same Indian mobile rules as the server (indianMobile91): 10 digits, optional leading 0 or 91. */
function indianMobile91(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return /^91[6-9]\d{9}$/.test(digits) ? digits : null;
}

function validate(form) {
  const errors = {};
  const libraryName = form.libraryName.trim();
  const city = form.city.trim();
  const mobileRaw = form.mobile.trim();
  const emailRaw = form.email.trim();
  const seatRaw = form.seatCapacity.trim();

  if (!libraryName) errors.libraryName = 'Library name is required.';
  else if (libraryName.length > 120) errors.libraryName = 'Library name must be 120 characters or less.';

  if (!mobileRaw && !emailRaw) errors.contact = 'Enter a mobile number or an email address.';
  if (mobileRaw && !indianMobile91(mobileRaw)) errors.mobile = 'Enter a valid 10-digit Indian mobile number.';
  if (emailRaw && !EMAIL_RE.test(emailRaw)) errors.email = 'Enter a valid email address.';

  if (!seatRaw) errors.seatCapacity = 'Seat capacity is required.';
  else if (!/^[1-9]\d*$/.test(seatRaw)) errors.seatCapacity = 'Seat capacity must be a whole number greater than 0.';

  if (!city) errors.city = 'City is required.';
  else if (city.length > 80) errors.city = 'City must be 80 characters or less.';

  return errors;
}

const fieldClass = 'w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-base text-ink-950 outline-none focus:border-gold-600';

export function DemoPage() {
  const [form, setForm] = useState({ libraryName: '', mobile: '', email: '', seatCapacity: '', city: '', website: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setServerError('');
    const next = validate(form);
    setErrors(next);
    if (Object.keys(next).length) return;
    if (!API) {
      setServerError('The demo form is unavailable because the service address is not configured.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/public/demo-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          libraryName: form.libraryName.trim(),
          mobile: form.mobile.trim(),
          email: form.email.trim(),
          seatCapacity: Number(form.seatCapacity.trim()),
          city: form.city.trim(),
          source: 'landing',
          website: form.website,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      setDone(true);
    } catch (err) {
      setServerError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <a href="#main" className="sr-only z-[60] rounded-lg bg-gold-400 px-4 py-2 font-semibold text-ink-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      <Nav home={false} />
      <main id="main" className="min-h-screen bg-paper pb-24 pt-28 text-ink-950">
        <article className="container-x">
          <div className="mx-auto max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-gold-700">My Library OS</p>
            <h1 className="mt-3 font-display text-4xl font-black tracking-tight text-ink-950 sm:text-5xl">Book a demo</h1>
            <p className="mt-4 text-base leading-relaxed text-stone-700">
              Tell us about your library. We will get in touch to walk you through seats, shifts and fees.
            </p>

            {done ? (
              <p role="status" className="mt-8 rounded-2xl border border-gold-600/30 bg-gold-500/10 px-5 py-4 text-base font-medium text-ink-950">
                Thanks — we received your demo request. We&apos;ll be in touch shortly.
              </p>
            ) : (
              <form className="mt-8 grid gap-4" onSubmit={submit} noValidate>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold" htmlFor="demo-library">Library name</label>
                  <input id="demo-library" className={fieldClass} value={form.libraryName} onChange={set('libraryName')} autoComplete="organization" required />
                  {errors.libraryName && <p className="mt-1 text-sm text-red-700" role="alert">{errors.libraryName}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold" htmlFor="demo-mobile">Mobile number</label>
                  <input id="demo-mobile" className={fieldClass} inputMode="tel" autoComplete="tel" placeholder="10-digit Indian mobile" value={form.mobile} onChange={set('mobile')} />
                  {errors.mobile && <p className="mt-1 text-sm text-red-700" role="alert">{errors.mobile}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold" htmlFor="demo-email">Email</label>
                  <input id="demo-email" className={fieldClass} type="email" autoComplete="email" value={form.email} onChange={set('email')} />
                  {errors.email && <p className="mt-1 text-sm text-red-700" role="alert">{errors.email}</p>}
                  {errors.contact && <p className="mt-1 text-sm text-red-700" role="alert">{errors.contact}</p>}
                  <p className="mt-1 text-sm text-stone-500">Mobile or email is enough. You can give both.</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold" htmlFor="demo-seats">Seat capacity</label>
                  <input id="demo-seats" className={fieldClass} inputMode="numeric" value={form.seatCapacity} onChange={set('seatCapacity')} required />
                  {errors.seatCapacity && <p className="mt-1 text-sm text-red-700" role="alert">{errors.seatCapacity}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold" htmlFor="demo-city">City</label>
                  <input id="demo-city" className={fieldClass} autoComplete="address-level2" value={form.city} onChange={set('city')} required />
                  {errors.city && <p className="mt-1 text-sm text-red-700" role="alert">{errors.city}</p>}
                </div>
                <div className="sr-only" aria-hidden="true">
                  <label htmlFor="website">Website</label>
                  <input id="website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
                </div>
                {serverError && <p role="alert" className="text-sm text-red-700">{serverError}</p>}
                <button type="submit" className="btn-gold mt-2 w-full" disabled={busy}>
                  {busy ? 'Sending…' : 'Request a demo'}
                </button>
              </form>
            )}
          </div>
        </article>
      </main>
      <Footer home={false} />
    </>
  );
}

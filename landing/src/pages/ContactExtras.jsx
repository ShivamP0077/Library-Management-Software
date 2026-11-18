import { useState } from 'react';

const WA = String(import.meta.env.VITE_SUPPORT_WHATSAPP || '').replace(/\D/g, '');
const API = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const CATEGORIES = ['general', 'billing', 'technical', 'whatsapp', 'account', 'data', 'feature_request'];

async function postJson(path, body) {
  const res = await fetch(`${API}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again later.');
  return data;
}

export function ContactExtras() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', mobile: '', category: 'general', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [lookup, setLookup] = useState({ ticket: '', email: '', mobile: '', otp: '' });
  const [status, setStatus] = useState(null);
  const chat = WA ? `https://wa.me/${WA}` : '';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setTicketId('');
    try {
      const r = await postJson('/public/support/tickets', form);
      setTicketId(r.numberLabel || r.id);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <section className="mt-8" aria-label="Contact options">
      <h2 className="font-display text-xl font-bold text-ink-950">Chat on WhatsApp</h2>
      <div className="mt-3 text-[15px] leading-relaxed text-stone-700">
        {chat
          ? <a className="font-medium text-gold-700 underline" href={chat} target="_blank" rel="noreferrer">Chat on WhatsApp</a>
          : <p>Chat on WhatsApp is unavailable.</p>}
      </div>
      <h2 className="mt-8 font-display text-xl font-bold text-ink-950">Raise a support ticket</h2>
      <button type="button" className="mt-3 text-gold-700 underline" onClick={() => setOpen(v => !v)}>Raise a support ticket</button>
      {open && (
        <form className="mt-4 grid gap-2" onSubmit={submit} aria-label="Raise a support ticket">
          <input className="rounded border px-3 py-2" required placeholder="Name" aria-label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className="rounded border px-3 py-2" type="email" placeholder="Email" aria-label="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input className="rounded border px-3 py-2" placeholder="Mobile" aria-label="Mobile" value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} />
          <select className="rounded border px-3 py-2" aria-label="Category" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <textarea className="rounded border px-3 py-2" required minLength={5} placeholder="Description" aria-label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <button type="submit" disabled={busy} className="rounded bg-ink-950 px-3 py-2 text-white">Send ticket</button>
          {ticketId && <p role="status">Ticket {ticketId}</p>}
        </form>
      )}
      <form className="mt-4 grid gap-2" aria-label="Check ticket status" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError('');
        try { setStatus(await postJson('/public/support/lookup', lookup)); }
        catch (err) { setStatus(null); setError(err.message); }
        finally { setBusy(false); }
      }}>
        <input className="rounded border px-3 py-2" placeholder="Ticket ID" aria-label="Ticket ID" value={lookup.ticket} onChange={e => setLookup({ ...lookup, ticket: e.target.value })} />
        <input className="rounded border px-3 py-2" placeholder="Registered email" aria-label="Registered email" value={lookup.email} onChange={e => setLookup({ ...lookup, email: e.target.value })} />
        <input className="rounded border px-3 py-2" placeholder="Registered mobile" aria-label="Registered mobile" value={lookup.mobile} onChange={e => setLookup({ ...lookup, mobile: e.target.value })} />
        <button type="button" className="underline" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { const r = await postJson('/public/support/otp', lookup); setStatus({ note: r.message }); }
          catch (err) { setError(err.message); }
          finally { setBusy(false); }
        }}>Send code</button>
        <input className="rounded border px-3 py-2" placeholder="Code" aria-label="Code" value={lookup.otp} onChange={e => setLookup({ ...lookup, otp: e.target.value })} />
        <button type="submit" disabled={busy} className="rounded border px-3 py-2">Check status</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {status?.note && <p>{status.note}</p>}
      {status?.ticket && <p role="status">{status.ticket.numberLabel} · {status.ticket.status}</p>}
    </section>
  );
}

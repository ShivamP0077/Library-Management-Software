import React, { useState } from 'react';
import { TICKET_CATEGORIES } from './supportCategories.js';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

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

export function PublicTicketForm() {
  const [form, setForm] = useState({ name: '', email: '', mobile: '', category: 'general', description: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [lookup, setLookup] = useState({ ticket: '', email: '', mobile: '', otp: '' });
  const [status, setStatus] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true); setTicketId('');
    try {
      let attachments;
      if (file) {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Could not read the file'));
          reader.readAsDataURL(file);
        });
        attachments = [{ name: file.name, data }];
      }
      const r = await postJson('/public/support/tickets', { ...form, attachments });
      setTicketId(r.numberLabel || r.id);
      setLookup(l => ({ ...l, ticket: r.numberLabel || r.id, email: form.email, mobile: form.mobile }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const sendCode = async () => {
    setError(''); setBusy(true); setStatus(null);
    try {
      const r = await postJson('/public/support/otp', lookup);
      setError('');
      setStatus({ note: r.message });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const check = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try { setStatus(await postJson('/public/support/lookup', lookup)); }
    catch (err) { setStatus(null); setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <form onSubmit={submit} aria-label="Raise a support ticket" style={{ display: 'grid', gap: 8 }}>
        <input className="form-input" required placeholder="Name" aria-label="Name" value={form.name} onChange={e => set('name', e.target.value)} />
        <input className="form-input" type="email" placeholder="Email" aria-label="Email" value={form.email} onChange={e => set('email', e.target.value)} />
        <input className="form-input" placeholder="Mobile" aria-label="Mobile" value={form.mobile} onChange={e => set('mobile', e.target.value)} />
        <select className="form-input" aria-label="Category" value={form.category} onChange={e => set('category', e.target.value)}>
          {TICKET_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <textarea className="form-input" required minLength={5} placeholder="Description" aria-label="Description" value={form.description} onChange={e => set('description', e.target.value)} />
        <input type="file" aria-label="Attachment" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} />
        <button className="btn btn-primary" type="submit" disabled={busy}>Send ticket</button>
      </form>
      {ticketId && <p role="status">Ticket {ticketId}. Keep this id. To check it later, request a code to the email or mobile you entered.</p>}
      <form onSubmit={check} aria-label="Check ticket status" style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        <input className="form-input" placeholder="Ticket ID" aria-label="Ticket ID" value={lookup.ticket} onChange={e => setLookup({ ...lookup, ticket: e.target.value })} />
        <input className="form-input" placeholder="Registered email" aria-label="Registered email" value={lookup.email} onChange={e => setLookup({ ...lookup, email: e.target.value })} />
        <input className="form-input" placeholder="Registered mobile" aria-label="Registered mobile" value={lookup.mobile} onChange={e => setLookup({ ...lookup, mobile: e.target.value })} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={sendCode}>Send code</button>
          <input className="form-input" inputMode="numeric" placeholder="Code" aria-label="Code" value={lookup.otp} onChange={e => setLookup({ ...lookup, otp: e.target.value })} />
        </div>
        <button className="btn btn-secondary" type="submit" disabled={busy}>Check status</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {status?.note && <p role="status">{status.note}</p>}
      {status?.ticket && (
        <div role="status">
          <p>{status.ticket.numberLabel} · {status.ticket.status}</p>
          {(status.ticket.messages || []).map((m, i) => <p key={i}>{m.fromSupport ? 'Support' : 'You'}: {m.body}</p>)}
        </div>
      )}
    </div>
  );
}

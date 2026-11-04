import { useEffect, useState } from 'react';
import { api, getToken } from './api';

// Tiny shared store for the library's WhatsApp connection state (banner + send windows).
let state = { state: 'unknown', checked: false, allowed: true };
const subs = new Set();
let inflight = null;
const emit = () => subs.forEach(fn => fn(state));

export async function refreshWhatsappStatus() {
  if (!getToken()) { state = { state: 'unknown', checked: true, allowed: false }; emit(); return state; }
  if (inflight) return inflight;
  inflight = api.whatsappStatus()
    .then(r => { state = { state: r?.state || 'unknown', number: r?.number || null, checked: true, allowed: true }; })
    .catch(e => { state = { state: 'unknown', checked: true, allowed: !(e?.status === 403 || e?.status === 503), error: e?.message }; })
    .finally(() => { inflight = null; emit(); });
  await inflight;
  return state;
}

/** Disconnected = we reached the server and it says the library's WhatsApp is not logged in. */
export const isDisconnected = (s) => s.checked && s.allowed && ['disconnected', 'not_created'].includes(s.state);

export function useWhatsappStatus({ poll = 0 } = {}) {
  const [s, setS] = useState(state);
  useEffect(() => {
    subs.add(setS);
    if (!state.checked) refreshWhatsappStatus();
    const t = poll ? setInterval(refreshWhatsappStatus, poll) : null;
    return () => { subs.delete(setS); if (t) clearInterval(t); };
  }, [poll]);
  return s;
}

export const navigateTo = (tab, sub) => window.dispatchEvent(new CustomEvent('libos:navigate', { detail: { tab, sub } }));

/** Replace {name} {amount} {month} {dueDate} {seat} {shift} {receiptNo}; unknown keys stay as typed. */
export const fillTemplate = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : m));

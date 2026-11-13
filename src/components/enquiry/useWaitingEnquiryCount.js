import { useEffect, useState } from 'react';
import { api } from '../../utils/api';

let count = 0;
let timer = null;
let subscribers = 0;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn(count));
}

export async function refreshWaitingEnquiryCount() {
  // No unlocked subscriber: do not call /enquiries/count. A 402 would dispatch
  // libos:subscription-locked and refresh /auth/me on every poll.
  if (subscribers <= 0) return count;
  try {
    const data = await api.enquiryCount();
    if (subscribers <= 0) return count;
    count = Number(data?.waiting) || 0;
  } catch {
    /* leave the last count; the next focus or tick retries */
  }
  emit();
  return count;
}

function start() {
  if (timer) return;
  refreshWaitingEnquiryCount();
  timer = setInterval(refreshWaitingEnquiryCount, 60_000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Shared waiting-enquiry total. Skips polling while the library plan is locked. */
export function useWaitingEnquiryCount(locked) {
  const [value, setValue] = useState(count);
  useEffect(() => {
    if (locked) return undefined;
    subscribers += 1;
    listeners.add(setValue);
    start();
    const onFocus = () => refreshWaitingEnquiryCount();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshWaitingEnquiryCount();
    };
    const onChanged = () => refreshWaitingEnquiryCount();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('libos:enquiries-changed', onChanged);
    return () => {
      subscribers = Math.max(0, subscribers - 1);
      listeners.delete(setValue);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('libos:enquiries-changed', onChanged);
      if (subscribers === 0) stop();
    };
  }, [locked]);
  return locked ? 0 : value;
}

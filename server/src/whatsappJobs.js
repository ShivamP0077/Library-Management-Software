/**
 * Reminder, receipt-retry and Evolution keep-alive.
 * The API registers these only when WHATSAPP_JOBS_IN_WORKER is not "true".
 * The worker entry (whatsapp-worker.js) always registers them.
 * Production split still needs a separate approval — this file does not start a process by itself.
 */
import { runReminderJob, runReceiptRetryJob } from './reminders.js';

export function whatsappJobsBelongInWorker(env = process.env) {
  return env.WHATSAPP_JOBS_IN_WORKER === 'true';
}

export function registerWhatsappJobs(registerJob) {
  registerJob('whatsapp-reminders', () => runReminderJob());
  registerJob('whatsapp-receipt-retry', () => runReceiptRetryJob(), { intervalMs: 3 * 60 * 1000 });
}

/** One keep-alive at a time. A hung ping cannot stack, and a failure is logged. */
export function startEvolutionKeepAlive({
  env = process.env,
  fetchImpl = globalThis.fetch,
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
  timeoutMs = 60000,
} = {}) {
  if (!env.EVOLUTION_API_URL || env.NODE_ENV === 'test' || env.EVOLUTION_KEEPALIVE === 'false') return false;
  let inflight = false;
  const ping = () => {
    if (inflight) return;
    inflight = true;
    const ms = Math.min(90000, Math.max(1000, Number(timeoutMs) || 60000));
    Promise.resolve()
      .then(() => fetchImpl(env.EVOLUTION_API_URL, { signal: AbortSignal.timeout(ms) }))
      .catch(e => console.error('[whatsapp] keep-alive ping failed:', e?.message || e))
      .finally(() => { inflight = false; });
  };
  setTimeoutFn(ping, 30000);
  setIntervalFn(ping, 10 * 60 * 1000);
  return true;
}

let guardsInstalled = false;
/** Log stray promise failures so they cannot take the process down. */
export function installProcessGuards() {
  if (guardsInstalled) return;
  guardsInstalled = true;
  process.on('unhandledRejection', (err) => {
    console.error('[process] unhandled rejection:', err?.message || err);
  });
}

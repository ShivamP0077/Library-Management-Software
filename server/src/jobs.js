/**
 * Tiny in-process scheduler for background jobs (single Render instance).
 * Every job must be idempotent. Disable with JOBS_DISABLED=true.
 */
const jobs = [];
/** opts.intervalMs gives a job its own (shorter) timer instead of the shared hourly run. */
export const registerJob = (name, fn, { intervalMs } = {}) => {
  if (jobs.some(j => j.name === name)) return;
  jobs.push({ name, fn, intervalMs });
  console.log(`[jobs] registered ${name}${intervalMs ? ` (every ${Math.round(intervalMs / 1000)}s)` : ''}`);
};
export async function runAllJobs() {
  for (const j of jobs.filter(x => !x.intervalMs)) {
    try { await j.fn(); } catch (e) { console.error(`[jobs] ${j.name} failed:`, e.message); }
  }
}
let timer = null;
export function startScheduler({ intervalMs = Number(process.env.JOBS_INTERVAL_MS || 60 * 60 * 1000) } = {}) {
  if (timer || process.env.JOBS_DISABLED === 'true' || process.env.NODE_ENV === 'test') return null;
  setTimeout(runAllJobs, 15000);
  timer = setInterval(runAllJobs, intervalMs);
  for (const j of jobs.filter(x => x.intervalMs)) {
    const run = () => Promise.resolve().then(j.fn).catch(e => console.error(`[jobs] ${j.name} failed:`, e.message));
    setTimeout(run, 20000); setInterval(run, j.intervalMs);
  }
  return timer;
}

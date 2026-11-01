/**
 * Tiny in-process scheduler for background jobs (single Render instance).
 * Every job must be idempotent. Disable with JOBS_DISABLED=true.
 */
const jobs = [];
export const registerJob = (name, fn) => { if (!jobs.some(j => j.name === name)) jobs.push({ name, fn }); };
export async function runAllJobs() {
  for (const j of jobs) {
    try { await j.fn(); } catch (e) { console.error(`[jobs] ${j.name} failed:`, e.message); }
  }
}
let timer = null;
export function startScheduler({ intervalMs = Number(process.env.JOBS_INTERVAL_MS || 60 * 60 * 1000) } = {}) {
  if (timer || process.env.JOBS_DISABLED === 'true' || process.env.NODE_ENV === 'test') return null;
  setTimeout(runAllJobs, 15000);
  timer = setInterval(runAllJobs, intervalMs);
  return timer;
}

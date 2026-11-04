import 'dotenv/config';
import { connectDB, redact } from './db.js';
import { createApp } from './app.js';
import { ensureSuperAdmin } from './seed.js';
import { registerJob, startScheduler } from './jobs.js';
import { runDailyFinanceJob } from './finance.js';
import { Library } from './models.js';
import { runDailyNotificationJob } from './notifications.js';
import { runReminderJob, runReceiptRetryJob } from './reminders.js';

const PORT = Number(process.env.PORT || 4000);
const RETRY_MS = Number(process.env.DB_RETRY_MS || 30000);

// Start serving immediately so the platform health check passes even while the
// database is unreachable (e.g. Atlas IP allowlist); keep retrying the connection.
createApp().listen(PORT, '0.0.0.0', () => console.log(`[api] Listening on http://localhost:${PORT}`));

async function connectWithRetry() {
  try {
    await connectDB();
    await ensureSuperAdmin().catch(e => console.error('[seed] super admin seed failed:', redact(e.message)));
    registerJob('recurring-expenses', () => runDailyFinanceJob(Library));
    registerJob('notifications', () => runDailyNotificationJob(Library)); // after bills are generated
    registerJob('whatsapp-reminders', () => runReminderJob()); // no-op unless Evolution API is configured
    registerJob('whatsapp-receipt-retry', () => runReceiptRetryJob(), { intervalMs: 3 * 60 * 1000 });
    startScheduler();
  } catch (err) {
    console.error(`[db] Connection failed (retrying in ${RETRY_MS / 1000}s):`, redact(err.message));
    setTimeout(connectWithRetry, RETRY_MS);
  }
}
connectWithRetry();

// Keep the free-plan Evolution service (evolution-api-lms) from spinning down: ping its root every 10 min.
// NOTE: lms-api itself is also on Render's free plan and sleeps after ~15 min idle, so this only helps while
// lms-api is awake. The real fix is a paid (always-on) plan for both services.
if (process.env.EVOLUTION_API_URL && process.env.NODE_ENV !== 'test' && process.env.EVOLUTION_KEEPALIVE !== 'false') {
  const ping = () => fetch(process.env.EVOLUTION_API_URL, { signal: AbortSignal.timeout(60000) })
    .catch(e => console.error('[whatsapp] keep-alive ping failed:', e.message));
  setTimeout(ping, 30000);
  setInterval(ping, 10 * 60 * 1000);
}

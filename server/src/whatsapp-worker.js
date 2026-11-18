/**
 * WhatsApp maintenance process. Does not listen for HTTP.
 * Start with: npm run whatsapp:worker
 * Set WHATSAPP_JOBS_IN_WORKER=true on the API so it does not run the same jobs.
 * Do not point this at production until that split is approved.
 */
import 'dotenv/config';
import { installConsoleRedaction } from './redact.js';
installConsoleRedaction();
import { connectDB, redact } from './db.js';
import { registerJob, startScheduler } from './jobs.js';
import { installProcessGuards, registerWhatsappJobs, startEvolutionKeepAlive } from './whatsappJobs.js';

installProcessGuards();
process.env.WHATSAPP_JOBS_IN_WORKER = 'true';

const RETRY_MS = Number(process.env.DB_RETRY_MS || 30000);

async function connectWithRetry() {
  try {
    await connectDB();
    registerWhatsappJobs(registerJob);
    startEvolutionKeepAlive();
    startScheduler();
    console.log('[whatsapp-worker] reminder, receipt-retry and keep-alive are running in this process');
  } catch (err) {
    console.error(`[whatsapp-worker] database connection failed (retrying in ${RETRY_MS / 1000}s):`, redact(err.message));
    setTimeout(connectWithRetry, RETRY_MS);
  }
}

connectWithRetry();

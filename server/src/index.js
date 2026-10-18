import 'dotenv/config';
import { connectDB, redact } from './db.js';
import { createApp } from './app.js';
import { ensureSuperAdmin } from './seed.js';

const PORT = Number(process.env.PORT || 4000);
const RETRY_MS = Number(process.env.DB_RETRY_MS || 30000);

// Start serving immediately so the platform health check passes even while the
// database is unreachable (e.g. Atlas IP allowlist); keep retrying the connection.
createApp().listen(PORT, '0.0.0.0', () => console.log(`[api] Listening on http://localhost:${PORT}`));

async function connectWithRetry() {
  try {
    await connectDB();
    await ensureSuperAdmin().catch(e => console.error('[seed] super admin seed failed:', redact(e.message)));
  } catch (err) {
    console.error(`[db] Connection failed (retrying in ${RETRY_MS / 1000}s):`, redact(err.message));
    setTimeout(connectWithRetry, RETRY_MS);
  }
}
connectWithRetry();

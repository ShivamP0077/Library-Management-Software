import 'dotenv/config';
import { connectDB, redact } from './db.js';
import { createApp } from './app.js';
import { ensureSuperAdmin } from './seed.js';

const PORT = Number(process.env.PORT || 4000);

connectDB()
  .then(async () => {
    await ensureSuperAdmin().catch(e => console.error('[seed] super admin seed failed:', redact(e.message)));
    createApp().listen(PORT, '0.0.0.0', () => console.log(`[api] Listening on http://localhost:${PORT}`));
  })
  .catch(err => { console.error('[db] Connection failed:', redact(err.message)); process.exit(1); });

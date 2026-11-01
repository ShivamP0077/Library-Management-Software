import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, redact } from './db.js';
import { ensureSuperAdmin, ensureDefaultLibrary, ensureDemoClient } from './seed.js';

try {
  await connectDB();
  await ensureSuperAdmin();
  await ensureDefaultLibrary();
  if (process.argv.includes('--demo')) await ensureDemoClient();
} catch (e) {
  console.error('[seed] failed:', redact(e.message));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

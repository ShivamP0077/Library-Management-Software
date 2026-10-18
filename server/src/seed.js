import fs from 'fs';
import path from 'path';
import { User, Library } from './models.js';
import { createLibrary, createUser, generatePassword, hashPassword } from './services.js';

const writeSecret = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};

/**
 * Ensures the super admin exists (idempotent).
 * - Email from SUPERADMIN_EMAIL (required for seeding).
 * - Password from SUPERADMIN_PASSWORD; if unset, one is generated and written to
 *   SUPERADMIN_CREDENTIALS_FILE (never logged). Without either, the account is Google-only.
 */
export async function ensureSuperAdmin(env = process.env) {
  const email = (env.SUPERADMIN_EMAIL || '').toLowerCase().trim();
  if (!email) { console.warn('[seed] SUPERADMIN_EMAIL not set; skipping super admin seed'); return null; }
  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== 'superadmin') console.warn(`[seed] ${email} exists but is not superadmin; leaving unchanged`);
    return existing;
  }
  let password = env.SUPERADMIN_PASSWORD || null;
  if (!password && env.SUPERADMIN_CREDENTIALS_FILE) {
    password = generatePassword(24);
    writeSecret(env.SUPERADMIN_CREDENTIALS_FILE, `SUPERADMIN_EMAIL=${email}\nSUPERADMIN_PASSWORD=${password}\n`);
    console.log(`[seed] Generated super admin password and saved it to ${env.SUPERADMIN_CREDENTIALS_FILE}`);
  }
  const { user } = await createUser({ email, name: 'Super Admin', role: 'superadmin', password: password || undefined });
  console.log(`[seed] Super admin created (${email})`);
  return user;
}

/** Creates a demo client library + client admin (idempotent). Credentials go to a 600 file. */
export async function ensureDemoClient(env = process.env) {
  const libraryId = env.DEMO_LIBRARY_ID || 'lib-demo';
  const email = (env.DEMO_ADMIN_EMAIL || 'demo.admin@example.com').toLowerCase();
  const file = env.DEMO_CREDENTIALS_FILE;
  if (await Library.exists({ libraryId })) { console.log(`[seed] Demo library ${libraryId} already exists`); return; }
  const password = generatePassword(20);
  await createLibrary({ name: 'Demo Study Library', libraryId, createdBy: 'seed', admin: { email, name: 'Demo Client Admin', password } });
  if (file) writeSecret(file, `DEMO_LIBRARY_ID=${libraryId}\nDEMO_ADMIN_EMAIL=${email}\nDEMO_ADMIN_PASSWORD=${password}\n`);
  console.log(`[seed] Demo library "${libraryId}" + client admin ${email} created${file ? `; credentials in ${file}` : ''}`);
}

export { hashPassword };

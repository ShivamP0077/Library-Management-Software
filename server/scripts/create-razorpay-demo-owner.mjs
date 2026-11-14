#!/usr/bin/env node
/**
 * Create a clearly named demo library owner (email + password) for later
 * Razorpay website checks. This script is not part of deploy or startup.
 * Do not run it against production, and do not run it just to "try" it.
 *
 * It was not executed when the legal pages were added. It creates a library
 * and a client-admin user in whatever database MONGODB_URI points at.
 *
 * Usage (from server/):
 *   NODE_ENV=development npm run demo:razorpay-owner
 *
 * Optional env:
 *   MONGODB_URI                         required, via the environment or server/.env
 *   RAZORPAY_DEMO_LIBRARY_ID            default lib-razorpay-demo
 *   RAZORPAY_DEMO_LIBRARY_NAME          default Razorpay Demo Library
 *   RAZORPAY_DEMO_EMAIL                 default razorpay-demo-owner@mylibraryos.in
 *   RAZORPAY_DEMO_OWNER_NAME            default Razorpay Demo Owner
 *   RAZORPAY_DEMO_PASSWORD              if unset, a password is generated (min 8 characters if you set it)
 *   RAZORPAY_DEMO_CREDENTIALS_FILE      default server/.razorpay-demo-owner.credentials
 *   ALLOW_RAZORPAY_DEMO_IN_PRODUCTION   set to 1 to allow NODE_ENV=production
 *
 * The password is written only to that credentials file (mode 600).
 * It is never printed. If the library id already exists, the script stops
 * and does not write a new password.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDB, redact } from '../src/db.js';
import { Library } from '../src/models.js';
import { createLibrary, generatePassword } from '../src/services.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const writeSecret = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_RAZORPAY_DEMO_IN_PRODUCTION !== '1') {
  console.error('[razorpay-demo] Refusing to run because NODE_ENV=production. Set ALLOW_RAZORPAY_DEMO_IN_PRODUCTION=1 to override. Nothing was created.');
  process.exit(1);
}

if (process.env.RAZORPAY_DEMO_PASSWORD && process.env.RAZORPAY_DEMO_PASSWORD.length < 8) {
  console.error('[razorpay-demo] RAZORPAY_DEMO_PASSWORD must be at least 8 characters. Nothing was created.');
  process.exit(1);
}

const libraryId = process.env.RAZORPAY_DEMO_LIBRARY_ID || 'lib-razorpay-demo';
const libraryName = process.env.RAZORPAY_DEMO_LIBRARY_NAME || 'Razorpay Demo Library';
const email = (process.env.RAZORPAY_DEMO_EMAIL || 'razorpay-demo-owner@mylibraryos.in').toLowerCase().trim();
const ownerName = process.env.RAZORPAY_DEMO_OWNER_NAME || 'Razorpay Demo Owner';
const credentialsFile = process.env.RAZORPAY_DEMO_CREDENTIALS_FILE
  || path.join(serverDir, '.razorpay-demo-owner.credentials');

try {
  await connectDB();
  if (await Library.exists({ libraryId })) {
    console.log(`[razorpay-demo] Library ${libraryId} already exists. No account was changed and no password was written.`);
  } else {
    const password = process.env.RAZORPAY_DEMO_PASSWORD || generatePassword(20);
    await createLibrary({
      name: libraryName,
      libraryId,
      contactEmail: email,
      city: 'Bangalore',
      createdBy: 'razorpay-demo-script',
      admin: { email, name: ownerName, password },
    });
    writeSecret(credentialsFile, `RAZORPAY_DEMO_LIBRARY_ID=${libraryId}\nRAZORPAY_DEMO_LIBRARY_NAME=${libraryName}\nRAZORPAY_DEMO_EMAIL=${email}\nRAZORPAY_DEMO_PASSWORD=${password}\n`);
    console.log(`[razorpay-demo] Created library ${libraryId} and owner ${email}. Password written to ${credentialsFile} (mode 600).`);
  }
} catch (e) {
  console.error('[razorpay-demo] failed:', redact(e?.message || String(e)));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}

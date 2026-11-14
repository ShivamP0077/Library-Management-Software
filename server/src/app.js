import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { redact } from './db.js';
import routes, { healthHandler } from './routes.js';
import { createPaymentsWebhookRouter } from './paymentsWebhook.js';

export function createApp() {
  const app = express();
  // CORS_ORIGIN: comma-separated allowed origins (e.g. https://my-app.vercel.app). Unset or * = allow all.
  const corsOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  app.use(cors({ origin: corsOrigins.includes('*') ? true : corsOrigins }));
  app.set('trust proxy', 1);
  // Issue #19: raw body for payment webhook HMAC (must be before express.json).
  app.use('/api/payments/webhook', express.raw({ type: '*/*' }), createPaymentsWebhookRouter());
  app.use(express.json({ limit: process.env.JSON_LIMIT || '25mb' })); // documents are base64 data URLs
  if (process.env.NODE_ENV !== 'test') {
    // Never log query strings for OAuth routes (they can contain codes/state).
    morgan.token('safe-url', (req) => {
      const url = req.originalUrl || req.url || '';
      return url.startsWith('/api/auth/google') || url.startsWith('/api/whatsapp/webhook') || url.startsWith('/api/payments/webhook') ? url.split('?')[0] : url;
    });
    app.use(morgan(':method :safe-url :status :response-time ms'));
  }

  app.get('/health', healthHandler); // Render health check
  app.use('/api', routes);

  // Optionally serve the built frontend (single-host deployments)
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
  if (process.env.SERVE_FRONTEND === 'true' && fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    const mongoDup = err?.code === 11000 || err?.code === 11001 || err?.code === '11000' || err?.code === '11001'
      || /E11000|E11001|duplicate key error|dup key/i.test(String(err?.message || ''));
    let status = err.status || (mongoDup ? 409 : 500);
    let message = err.type === 'entity.too.large' ? 'Upload is too large. Notices: 8 files, 5 MB each, 10 MB total. Support: 3 files per message, 8 MB total.' : status === 500 ? 'Internal server error' : redact(err.message);
    if (mongoDup || /E11000|E11001|duplicate key error|dup key/i.test(message)) {
      status = 409;
      message = 'This email or mobile number is already used. Sign in instead.';
    }
    if (status === 500) console.error('[api] error:', redact(err.message));
    const code = typeof err.code === 'string' && !/^\d+$/.test(err.code) && !/E11000|dup key/i.test(err.code) ? err.code : undefined;
    res.status(status).json({ error: message, ...(code ? { code } : {}), ...(err.details && !mongoDup ? { details: err.details } : {}) });
  });
  return app;
}

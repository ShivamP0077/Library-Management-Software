import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { redact } from './db.js';
import routes, { healthHandler } from './routes.js';

export function createApp() {
  const app = express();
  // CORS_ORIGIN: comma-separated allowed origins (e.g. https://my-app.vercel.app). Unset or * = allow all.
  const corsOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  app.use(cors({ origin: corsOrigins.includes('*') ? true : corsOrigins }));
  app.set('trust proxy', 1);
  app.use(express.json({ limit: process.env.JSON_LIMIT || '25mb' })); // documents are base64 data URLs
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  app.get('/health', healthHandler); // Render health check
  app.use('/api', routes);

  // Optionally serve the built frontend (single-host deployments)
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
  if (process.env.SERVE_FRONTEND === 'true' && fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    const status = err.status || (err.code === 11000 ? 409 : 500);
    if (status === 500) console.error('[api] error:', redact(err.message));
    res.status(status).json({ error: status === 500 ? 'Internal server error' : redact(err.message) });
  });
  return app;
}

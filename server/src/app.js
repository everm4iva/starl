/*
 * ☆ App assembly
 * -> wires the Express app: middleware order matters and is preserved here.
 *    version gate runs outermost (echoes its own CORS on the early 426), then CORS,
 *    then body parsing, then the feature routers.
 *
 * -> routers are mounted as they come online phase by phase; the skeleton already
 *    serves the public pages.
 */

import express from 'express';
import { versionGate } from './security/version-gate.js';
import { cors } from './security/cors.js';
import { requestLog } from './security/request-log.js';
import { registerLimiter, loginLimiter, refreshLimiter } from './security/rate-limit.js';
import { pagesRouter } from './routes/pages.js';
import { authRouter } from './routes/auth.js';
import { mediaRouter } from './routes/media.js';
import { searchRouter } from './routes/search.js';
import { accountStateRouter } from './routes/account-state.js';
import { accountSettingsRouter } from './routes/account-settings.js';
import { lyricsRouter } from './routes/lyrics.js';
import { statsRouter } from './routes/stats.js';
import { mixRouter } from './routes/mix.js';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // 1) version gate - must precede CORS so its early 426 still carries CORS headers.
  app.use(versionGate);
  // 2) CORS for every other response (and OPTIONS preflight).
  app.use(cors);
  // 3) one line per request in the console, path only, no query/body.
  app.use(requestLog);
  // 4) JSON bodies (audio/image uploads use their own parsers on their routes).
  app.use(express.json({ limit: '1mb' }));

  // --- per-route rate limits on the auth endpoints (match the old slowapi caps) ---
  app.use('/auth/register', registerLimiter);
  app.use('/auth/login', loginLimiter);
  app.use('/auth/refresh', refreshLimiter);

  // --- feature routers (more mounted in later phases) ---
  app.use('/', pagesRouter);
  app.use('/', authRouter);
  app.use('/', mediaRouter);
  app.use('/', searchRouter);
  app.use('/', accountStateRouter);
  app.use('/', accountSettingsRouter);
  app.use('/', lyricsRouter);
  app.use('/', statsRouter);
  app.use('/', mixRouter);

  // 404 fallback in JSON, matching the old API's error shape.
  app.use((req, res) => {
    res.status(404).json({ detail: 'Not found' });
  });

  // centralized error handler - keeps the detail-string shape the client expects.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[starl] unhandled error:', err);
    res.status(status).json({ detail: err.detail || err.message || 'Internal Server Error' });
  });

  return app;
}

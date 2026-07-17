/*
 * ☆ Listening stats routes
 * -> POST /stats/event : the client sends a batch of tiny events (a track click, an
 *    artist-page open, listened seconds, a skip). one call, one small file write.
 * -> GET  /stats       : read the whole score back (feeds the export + the mix engine).
 * -> DELETE /stats     : wipe this user's score (the "Clear statistics" button).
 * -> the on/off switch lives client-side in account state, so a disabled client simply
 *    stops sending events; the server stays dumb and just records what arrives.
 *
 *  no secret tracking lol
 */

import { Router } from 'express';
import { requireUser } from '../auth/middleware.js';
import { httpError } from '../lib/http-error.js';
import { getStats, applyEvents, clearStats } from '../stats/stats-store.js';

export const statsRouter = Router();

function userId(req) {
  const id = String(req.user?.sub || '').trim();
  if (!id) throw httpError(401, 'Invalid user payload');
  return id;
}

statsRouter.get('/stats', requireUser, (req, res) => {
  res.json(getStats(userId(req)));
});

statsRouter.post('/stats/event', requireUser, (req, res) => {
  // accept a single { event } or a batch { events:[...] } - the client batches, but a
  // one-off caller shouldn't have to wrap a lone event in an array.
  const body = req.body || {};
  const events = Array.isArray(body.events) ? body.events : body.event ? [body.event] : [];
  if (!events.length) throw httpError(400, 'events required');
  res.json(applyEvents(userId(req), events));
});

statsRouter.delete('/stats', requireUser, (req, res) => {
  clearStats(userId(req));
  res.json({ ok: true });
});

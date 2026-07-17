/*
 * ☆ Search / artist / album routes
 * -> the worker does the ytmusicapi fetch + fuzzy fallback + ytm cache; Node adds the
 *    per-user layer it owns: click re-ranking and a per-user ranked-result cache so repeat
 *    searches are instant. Artist/album/songs pass straight through to the worker.
 *
 * -> port of the /search, /search/click, /artist, /artist/songs, /album handlers.
 */

import { Router } from 'express';
import { requireUser, asyncHandler } from '../auth/middleware.js';
import { worker } from '../music/worker-client.js';
import { recordSearchClick, getQueryClickCounts } from '../search/clicks.js';
import { rankCacheGet, rankCacheSet, rankCacheInvalidate } from '../search/rank-cache.js';
import { httpError } from '../lib/http-error.js';

export const searchRouter = Router();

const userIdOf = (req) => (req.user && typeof req.user === 'object' ? req.user.sub || '' : '');

searchRouter.post('/search', requireUser, asyncHandler(async (req, res) => {
  const query = String(req.body?.query || '');
  if (!query.trim()) throw httpError(400, 'Query is required');
  const limit = req.body?.limit || 20;
  const offset = req.body?.offset || 0;
  const kind = (req.body?.kind || 'all').toLowerCase();
  const userId = userIdOf(req);

  // first page: serve the per-user ranked cache before hitting the worker.
  if (offset === 0 && userId) {
    const cached = rankCacheGet(userId, query, kind);
    if (cached) return res.json({ items: cached.slice(0, limit), has_more: cached.length > limit });
  }

  let { items, has_more: hasMore } = await worker.search(query, limit, req.body?.kind || 'all', offset);

  // re-rank by this user's click history, then cache the ranked list for instant repeats.
  if (userId && offset === 0) {
    try {
      const counts = getQueryClickCounts(userId, query);
      if (Object.keys(counts).length) {
        items = [...items].sort((a, b) => (counts[b.id || b.url] || 0) - (counts[a.id || a.url] || 0));
      }
      rankCacheSet(userId, query, kind, items);
    } catch { /* ranking is best-effort */ }
  }
  res.json({ items, has_more: hasMore });
}));

searchRouter.post('/search/click', requireUser, (req, res) => {
  const query = String(req.body?.query || '');
  const itemId = String(req.body?.item_id || '');
  if (!query.trim() || !itemId.trim()) throw httpError(400, 'query and item_id are required');
  const userId = userIdOf(req);
  if (!userId) throw httpError(401, 'User not identified');
  recordSearchClick(userId, query, itemId.trim(), req.body?.kind || null);
  rankCacheInvalidate(userId, query); // next search re-ranks with the updated counts
  res.json({ status: 'ok' });
});

searchRouter.get('/artist', requireUser, asyncHandler(async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const channelId = typeof req.query.channel_id === 'string' ? req.query.channel_id.trim() : '';
  if (!channelId && !name) throw httpError(400, 'name or channel_id is required');
  const result = await worker.getArtist({ name, channelId });
  if (result.error) throw httpError(404, result.error);
  res.json(result);
}));

// turn a plain-text combined credit (ex: "Vertigoaway & rainsdeaf") into tappable artists.
// returns { combined, artists:[{name, channel_id, photo_url}], unresolved:[str] } so the
// client can render one "View artist" per resolved artist (and leave unresolved as text)
// in a non nerd way: "Vertigoaway & rainsdeaf" -> "Vertigoaway" + "rainsdeaf" (clickable) or "Vertigoaway & rainsdeaf" (plain text).

// not used:
// searchRouter.post('/artist/parse', requireUser, asyncHandler(async (req, res) => {
//   const combined = typeof req.body?.combined === 'string' ? req.body.combined.trim() : '';
//   if (!combined) throw httpError(400, 'combined is required');
//   res.json(await worker.parseCombinedArtist(combined));
// }));

searchRouter.post('/artist/resolve', requireUser, asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) throw httpError(400, 'name is required');
  res.json(await worker.resolveArtists(name));
}));

searchRouter.get('/artist/songs', requireUser, asyncHandler(async (req, res) => {
  const channelId = typeof req.query.channel_id === 'string' ? req.query.channel_id.trim() : '';
  const params = typeof req.query.params === 'string' ? req.query.params.trim() : '';
  if (!channelId || !params) throw httpError(400, 'channel_id and params are required');
  const result = await worker.getArtistSongs(channelId, params);
  res.json(result); // { tracks }
}));

searchRouter.get('/album', requireUser, asyncHandler(async (req, res) => {
  const albumId = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!albumId) throw httpError(400, 'id is required');
  if (!albumId.startsWith('MPRE')) throw httpError(400, 'Invalid album id');
  res.json(await worker.getAlbum(albumId));
}));

// resolve a community/YouTube playlist (bare id or pasted URL) into a flat track list,
// for the "import playlist" flow. The worker tries ytmusicapi then a yt-dlp fallback
searchRouter.get('/playlist', requireUser, asyncHandler(async (req, res) => {
  const ref = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!ref) throw httpError(400, 'id or url is required');
  const result = await worker.getPlaylist(ref);
  if (result.error) throw httpError(404, result.error);
  res.json(result);
}));

// scrape a public Spotify playlist's track list (no audio - titles/artists only). the
// client then matches each track to YouTube via POST /match before saving the playlist.
searchRouter.get('/spotify/playlist', requireUser, asyncHandler(async (req, res) => {
  const ref = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!ref) throw httpError(400, 'id or url is required');
  const result = await worker.getSpotifyPlaylist(ref);
  if (result.error) throw httpError(404, result.error);
  res.json(result);
}));

// best-effort YouTube match for a batch of {title, artist} queries (Spotify import).
searchRouter.post('/match', requireUser, asyncHandler(async (req, res) => {
  const queries = Array.isArray(req.body?.queries) ? req.body.queries : null;
  if (!queries) throw httpError(400, 'queries must be a list');
  res.json(await worker.match(queries.slice(0, 60)));
}));

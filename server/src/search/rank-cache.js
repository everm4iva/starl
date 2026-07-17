/*
 * ☆ Per-user ranked search cache
 * -> stores click-ranked results per user+query+kind so repeated identical searches are
 *    served instantly without hitting the worker. Invalidated when the user clicks a
 *    result for that query (so the next search re-ranks with the updated counts).
 * -> port of the rank cache in main.py; registers itself with the janitor.
 */

import { TtlFileCache } from '../lib/ttl-file-cache.js';
import { SEARCH_RANK_CACHE_DIR } from '../config.js';
import { normalizeQuery } from './clicks.js';
import { registerSweeper } from '../jobs/janitor.js';

const RANK_TTL = 3600; // 1 hour - long enough to feel instant on repeat searches

// group ranked-result files by user so each user's cache is its own folder.
const rankNamespace = (key) => key.split(':', 1)[0] || 'misc';

const rankCache = new TtlFileCache(SEARCH_RANK_CACHE_DIR, rankNamespace);
registerSweeper(() => rankCache.sweepExpired());

const rankKey = (userId, query, kind) => `${userId}:${normalizeQuery(query)}:${(kind || 'all').toLowerCase()}`;

export function rankCacheGet(userId, query, kind) {
  const items = rankCache.get(rankKey(userId, query, kind));
  return Array.isArray(items) ? items : null;
}

export function rankCacheSet(userId, query, kind, items) {
  rankCache.set(rankKey(userId, query, kind), items, RANK_TTL);
}

export function rankCacheInvalidate(userId, query) {
  rankCache.invalidatePrefix(`${userId}:${normalizeQuery(query)}:`);
}

/*
 * ☆ Search click tracking
 * -> records which result a user clicked for a query, one small file per user
 *    (data/search_clicks/<user_id>.json), so a click writes one tiny file and a search
 *    reads one tiny file - no shared monolith. Port of the click helpers in main.py.
 */

import { RecordStore } from '../lib/record-store.js';
import { SEARCH_CLICKS_DIR } from '../config.js';

const clickRecords = new RecordStore(SEARCH_CLICKS_DIR);

export const normalizeQuery = (q) => String(q || '').trim().toLowerCase();

export function recordSearchClick(userId, query, itemId, kind) {
  const key = normalizeQuery(query);
  const data = clickRecords.get(userId) || {};
  const queryClicks = data[key] || (data[key] = {});
  const entry = queryClicks[itemId] || (queryClicks[itemId] = { count: 0, kind: kind || '' });
  entry.count = (entry.count || 0) + 1;
  entry.kind = kind || entry.kind || '';
  clickRecords.put(userId, data);
}

export function getQueryClickCounts(userId, query) {
  const key = normalizeQuery(query);
  const data = clickRecords.get(userId) || {};
  const queryClicks = data[key] || {};
  const counts = {};
  for (const [itemId, entry] of Object.entries(queryClicks)) counts[itemId] = entry.count || 0;
  return counts;
}

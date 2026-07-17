/*
 * ☆ Cache janitor
 * -> sweeps everything that goes stale on disk: orphaned .part/.tmp partials, stale .lock
 *    files from crashed downloads, and (registered by other modules) expired TTL caches.
 * -> runs on boot and every 10 minutes after, keeping the cache bounded and clean.
 *    The worker sweeps its own ytm cache on its own timer.
 */

import { sweepOrphanTempFiles } from '../media/cache.js';
import { sweepStaleLocks } from '../lib/file-lock.js';
import { AUDIO_DIR } from '../config.js';

// other modules (e.g. the search rank cache) register a () => number sweeper here.
const extraSweepers = [];
export function registerSweeper(fn) { extraSweepers.push(fn); }

function runOnce() {
  let removed = 0;
  const safe = (fn) => { try { removed += fn() || 0; } catch (err) { console.error('[starl] janitor sweep failed:', err.message); } };
  safe(() => sweepOrphanTempFiles());
  safe(() => sweepStaleLocks(AUDIO_DIR));
  for (const fn of extraSweepers) safe(fn);
  if (removed) console.log(`[starl] cache janitor removed ${removed} stale file(s)`);
}

export function startJanitor() {
  runOnce();
  setInterval(runOnce, 600000).unref();
}

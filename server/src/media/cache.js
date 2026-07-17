/*
 * ☆ Media cache
 * -> the server-side memory shelf: where cached audio/image files live, how they're named,
 *    and how to find them again. Metadata is one small <id>.json sidecar per record, read
 *    straight from the existing cache dir so nothing needs migrating.
 * -> port of cache.py (audio/image records, status state machine, prewarm store).
 */

import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_DIR, IMAGE_DIR } from '../config.js';
import { RecordStore } from '../lib/record-store.js';
import {
  normalizeAudioSourceUrl, getAudioCacheKey, getVideoIdFromUrl, sanitizeVideoId,
} from './audio-id.js';

// secondary index key: a record's normalized source url, so findCachedAudioMeta can jump
// straight to a track's quality variants without scanning the whole cache - neat
function audioSourceKey(meta) {
  const source = String(meta.source || meta.source_url || '').trim();
  if (!source) return null;
  return normalizeAudioSourceUrl(source) || null;
}

const audioRecords = new RecordStore(AUDIO_DIR, { source: audioSourceKey });
const imageRecords = new RecordStore(IMAGE_DIR);

// ----------------------  paths ----------------------

export const getAudioPath = (audioId) => path.join(AUDIO_DIR, `${audioId}.mp3`);
export const getAudioLockPath = (audioId) => path.join(AUDIO_DIR, `${audioId}.lock`);
export const getImagePath = (imageId, ext = 'jpg') => path.join(IMAGE_DIR, `${imageId}.${ext}`);

export function getImageVariantPath(imageId, variant = 'high', ext = 'jpg') {
  if (String(variant || '').toLowerCase() === 'low') return path.join(IMAGE_DIR, `${imageId}.low.${ext}`);
  return getImagePath(imageId, ext);
}

export function getAudioPathByVideoId(videoId, quality = 'best') {
  const key = getAudioCacheKey(`https://www.youtube.com/watch?v=${videoId}`, quality);
  const p = getAudioPath(key);
  return fs.existsSync(p) ? p : null;
}

// ----------------------  audio metadata ----------------------

export const getAudioMeta = (audioId) => audioRecords.get(audioId);
export const setAudioMeta = (audioId, meta) => audioRecords.put(audioId, meta);

export function findCachedAudioMeta(url, quality) {
  const normalized = normalizeAudioSourceUrl(url);
  const selectedQuality = String(quality || '').trim();

  // fast path: the cache id is deterministic from (source, quality).
  if (selectedQuality) {
    const directKey = getAudioCacheKey(normalized, selectedQuality);
    const meta = audioRecords.get(directKey);
    if (meta && typeof meta === 'object') {
      const p = String(meta.path || '').trim();
      if (p && fs.existsSync(p)) return [directKey, meta];
    }
  }
  // secondary index: jump to this track's quality variants without a full scan.
  for (const audioId of audioRecords.findIdsBy('source', normalized)) {
    const meta = audioRecords.get(audioId);
    if (!meta || typeof meta !== 'object') continue;
    if (selectedQuality && String(meta.quality || '').trim() !== selectedQuality) continue;
    const p = String(meta.path || '').trim();
    if (p && fs.existsSync(p)) return [audioId, meta];
  }
  return null;
}

export function deleteAudioCache(audioId) {
  if (!audioId) return false;
  evictPrewarmAudio(audioId);
  audioRecords.delete(audioId);
  const p = getAudioPath(audioId);
  if (fs.existsSync(p)) {
    try { fs.unlinkSync(p); return true; } catch { return false; }
  }
  return false;
}

// ----------------------  download status state machine ----------------------
// each track's sidecar carries a status: a download in flight is "pending", a finished
// one "ready", a failed attempt "failed". this is what lets a second request (or another
// worker) wait for an in-flight download instead of starting its own or 404ing lol

export const AUDIO_STATUS_PENDING = 'pending';
export const AUDIO_STATUS_READY = 'ready';
export const AUDIO_STATUS_FAILED = 'failed';

export function markAudioPending(audioId, meta = null) {
  const record = getAudioMeta(audioId) || {};
  if (meta) Object.assign(record, meta);
  record.audio_id = audioId;
  record.status = AUDIO_STATUS_PENDING;
  setAudioMeta(audioId, record);
}

export function markAudioReady(audioId, updates = null) {
  const record = getAudioMeta(audioId) || {};
  if (updates) Object.assign(record, updates);
  record.audio_id = audioId;
  record.status = AUDIO_STATUS_READY;
  setAudioMeta(audioId, record);
  return record;
}

export function markAudioFailed(audioId) {
  const record = getAudioMeta(audioId);
  if (!record || typeof record !== 'object') return;
  record.status = AUDIO_STATUS_FAILED;
  setAudioMeta(audioId, record);
}

export function getAudioStatus(audioId) {
  const meta = getAudioMeta(audioId);
  return meta && typeof meta === 'object' ? meta.status : null;
}

// ----------------------  prewarm store (in-memory, short TTL) ----------------------
// holds a new and fresh resolved direct CDN URL so the /download that follows a "/prewarm" is
// instant. CDN URLs are single-use and expire, hence the short TTL.

const PREWARM_TTL_MS = 180 * 1000;
const prewarmAudio = new Map();

export function storePrewarmAudio(audioId, payload) {
  if (!audioId) return;
  prewarmAudio.set(audioId, { payload, expiresAt: Date.now() + PREWARM_TTL_MS });
}

export function getPrewarmAudio(audioId) {
  if (!audioId) return null;
  const entry = prewarmAudio.get(audioId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    prewarmAudio.delete(audioId);
    return null;
  }
  return entry.payload && typeof entry.payload === 'object' ? entry.payload : null;
}

export function evictPrewarmAudio(audioId) {
  if (audioId) prewarmAudio.delete(audioId);
}

// ----------------------  image metadata ----------------------

export const getImageMeta = (imageId) => imageRecords.get(imageId);
export const setImageMeta = (imageId, meta) => imageRecords.put(imageId, meta);

const IMG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'];

export function findImagePath(imageId, variant = null) {
  const meta = getImageMeta(imageId) || {};
  const normalized = String(variant || '').toLowerCase() === 'low' ? 'low' : (variant ? 'high' : null);

  const pathsForVariant = (name) => {
    const candidates = [];
    if (name === 'low') {
      if (meta.low_path) candidates.push(meta.low_path);
      const lowVar = (meta.variants || {}).low || {};
      if (lowVar.path) candidates.push(lowVar.path);
      if (meta.path) {
        const hp = meta.path;
        const ext = path.extname(hp);
        candidates.push(path.join(path.dirname(hp), `${path.basename(hp, ext)}.low${ext}`));
      }
    } else if (name === 'high') {
      if (meta.path) candidates.push(meta.path);
      const hiVar = (meta.variants || {}).high || {};
      if (hiVar.path) candidates.push(hiVar.path);
    } else {
      if (meta.path) candidates.push(meta.path);
      const hiVar = (meta.variants || {}).high || {};
      if (hiVar.path) candidates.push(hiVar.path);
    }
    return candidates;
  };

  let candidates = pathsForVariant(normalized);
  if (normalized === 'low' && candidates.length === 0) candidates = pathsForVariant('high');
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  for (const ext of IMG_EXTS) {
    if (normalized === 'low') {
      const lp = getImageVariantPath(imageId, 'low', ext);
      if (fs.existsSync(lp)) return lp;
    }
    const hp = getImagePath(imageId, ext);
    if (fs.existsSync(hp)) return hp;
  }
  return null;
}

// wipe a cached image (every variant on disk + its sidecar) so the next request re-downloads
// it fresh. Used by the client's "repair playlist" to "bust" stale/expired cover art...
// heheh, "bust"
export function deleteImageCache(imageId) {
  if (!imageId) return false;
  const meta = getImageMeta(imageId) || {};
  const paths = new Set();
  if (meta.path) paths.add(meta.path);
  if (meta.high_path) paths.add(meta.high_path);
  if (meta.low_path) paths.add(meta.low_path);
  const variants = meta.variants || {};
  if (variants.high && variants.high.path) paths.add(variants.high.path);
  if (variants.low && variants.low.path) paths.add(variants.low.path);
  // also cover the deterministic on-disk names in case the sidecar is missing/partial.
  for (const ext of IMG_EXTS) {
    paths.add(getImagePath(imageId, ext));
    paths.add(getImageVariantPath(imageId, 'low', ext));
  }
  let removed = false;
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) { fs.unlinkSync(p); removed = true; }
    } catch { /* best effort, working hard */ }
  }
  imageRecords.delete(imageId);
  return removed;
}

// ----------------------  janitor helper ----------------------

// i was about to make a joke about orphans being ###### .. but rethought it for a sec.
// btw, that looks like roblox chat filter lol, so i guess it's a good thing i didn't say it out loud. anyway, this sweeps the cache!
export function sweepOrphanTempFiles(maxAgeSeconds = 600) {
  let removed = 0;
  const now = Date.now() / 1000;
  for (const dir of [AUDIO_DIR, IMAGE_DIR]) {
    if (!fs.existsSync(dir)) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.part') && !name.endsWith('.tmp')) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile() || now - st.mtimeMs / 1000 <= maxAgeSeconds) continue;
        fs.unlinkSync(full);
        removed++;
      } catch { /* skip */ }
    }
  }
  return removed;
}

export { sanitizeVideoId, getVideoIdFromUrl };

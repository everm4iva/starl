/*
 * ☆ Audio identity
 * -> turns a track URL (or a bare YouTube id) into a human-readable cache key,
 *    extracts video ids, and decides whether a URL is a single playable track.
 * -> port of the id helpers in the old cache.py, plus the fix for the logged bug where a
 *    bare id like "cnlpwb..." and a full watch URL produced different cache keys: both
 *    now "canonicalize" to the same youtube watch URL so they "converge".
 *  complex words huh
 */

import crypto from 'node:crypto';

// a YouTube video id is exactly 11 chars from [A-Za-z0-9_-].
const BARE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// page paths that are never a single playable track (channel/artist/playlist/etc.).
const NON_TRACK_PREFIXES = ['/channel/', '/c/', '/user/', '/playlist', '/browse/', '/results', '/feed/'];

function tryParseUrl(value) {
  try { return new URL(String(value).trim()); } catch { return null; }
}

// bare id -> canonical watch URL. anything else is returned unchanged.
export function coerceToTrackUrl(input) {
  const s = String(input || '').trim();
  if (BARE_VIDEO_ID_RE.test(s)) return `https://music.youtube.com/watch?v=${s}`;
  return s;
}

export function getVideoIdFromUrl(url) {
  if (!url) return null;
  const s = String(url).trim();
  if (BARE_VIDEO_ID_RE.test(s)) return s; // bare id
  const parsed = tryParseUrl(s);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || '';

  if (host.includes('youtu.be')) {
    const vid = path.replace(/^\/+/, '').split('/', 1)[0];
    return vid || null;
  }
  if (host.includes('youtube.com')) {
    if (path === '/watch') {
      const vid = (parsed.searchParams.get('v') || '').trim();
      return vid || null;
    }
    const parts = path.split('/');
    // "/shorts/ID", "/embed/ID", and "/live/ID" (the share form for a live broadcast)
    if (parts.length >= 3 && (parts[1] === 'shorts' || parts[1] === 'embed' || parts[1] === 'live')) {
      const vid = parts[2].split('/', 1)[0].trim();
      return vid || null;
    }
  }
  return null;
}

export function sanitizeVideoId(videoId) {
  return String(videoId).replace(/[^A-Za-z0-9\-_]/g, '_');
}

export function makeCacheId(value) {
  return crypto.createHash('sha256').update(value, 'utf-8').digest('hex').slice(0, 24);
}

export function normalizeAudioSourceUrl(url) {
  if (!url) return '';
  const coerced = coerceToTrackUrl(url);
  const parsed = tryParseUrl(coerced);
  if (!parsed || !parsed.protocol || !parsed.host) {
    return String(coerced).trim().split('#', 1)[0];
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || '';

  if (host.includes('youtu.be')) {
    const vid = path.replace(/^\/+/, '').split('/', 1)[0];
    if (vid) return `https://www.youtube.com/watch?v=${vid}`;
  }
  if (host.includes('youtube.com')) {
    if (path === '/watch') {
      const vid = (parsed.searchParams.get('v') || '').trim();
      if (vid) return `https://www.youtube.com/watch?v=${vid}`;
    }
    const parts = path.split('/');
    if (parts.length >= 3 && (parts[1] === 'shorts' || parts[1] === 'embed' || parts[1] === 'live')) {
      const vid = parts[2].split('/', 1)[0].trim();
      if (vid) return `https://www.youtube.com/watch?v=${vid}`;
    }
  }

  // keep only v / list query params, in that insertion order, dropping the rest.
  const kept = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (['v', 'list'].includes(key.toLowerCase()) && !kept.some(([k]) => k === key)) kept.push([key, value]);
  }
  const query = kept.map(([k, v]) => `${k}=${v}`).join('&');
  return `${parsed.protocol}//${parsed.host}${path}${query ? `?${query}` : ''}`;
}

export function getAudioCacheKey(url, quality) {
  const selectedQuality = String(quality || 'best').trim() || 'best';
  const videoId = getVideoIdFromUrl(url);
  if (videoId) return `${sanitizeVideoId(videoId)}_${selectedQuality}`;
  const normalized = normalizeAudioSourceUrl(url);
  return makeCacheId(`${normalized}|${selectedQuality}`);
}

export function isPlayableTrackUrl(url) {
  if (!url) return false;
  const coerced = coerceToTrackUrl(url);
  const parsed = tryParseUrl(coerced);
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || '';

  const isYoutube = host.includes('youtube.com') || host.includes('youtu.be');
  if (isYoutube) {
    if (NON_TRACK_PREFIXES.some((p) => path.startsWith(p) || path === p.replace(/\/$/, ''))) return false;
    if (path.startsWith('/@')) return false;
    return getVideoIdFromUrl(coerced) != null;
  }
  // non-YouTube host: let yt-dlp decide (since it supports many more sites).
  return true;
}

/*
 * ☆ Lyrics route

 * -> GET /lyrics proxies LRCLIB (lrclib.net/api/get) and normalizes the payload the client
 *    actually consumes: { found, synced, plain, instrumental, trackName, artistName, duration }
 *
 * -> caches per artist|track|album|duration via TtlFileCache so repeat opens (and the
 *    background warm-up the client fires on track change) never re-hit LRCLIB. Negative
 *    (no-lyrics) results are cached too, on a shorter TTL, so we don't boink a track that
 *    simply has none.
 */

import {Router} from 'express';
import {requireUserOrToken, asyncHandler} from '../auth/middleware.js';
import {TtlFileCache} from '../lib/ttl-file-cache.js';
import {LYRICS_CACHE_DIR} from '../config.js';
import {registerSweeper} from '../jobs/janitor.js';

export const lyricsRouter = Router();

const LRCLIB_URL = 'https://lrclib.net/api/get';
const USER_AGENT = 'StarlMusic/1.0.0 (https://github.com/everm4iva/starl)';
const FOUND_TTL = 30 * 24 * 3600; // 30 days - lyrics for a known track basically never change
const MISS_TTL = 24 * 3600; // 1 day - give a track that lacked lyrics a chance to gain them

const lyricsCache = new TtlFileCache(LYRICS_CACHE_DIR);
registerSweeper(() => lyricsCache.sweepExpired());

const norm = (v) => String(v || '').trim();

// stable cache key from the identifying fields, lowercased so "Ivri" and "ivri" share a hit
function cacheKey({artist, track, album, duration}) {
	return [artist, track, album, duration].map((p) => norm(p).toLowerCase()).join('|');
}

// fold LRCLIB's response (or a 404) into the shape the client renders from.
function normalizeLrclib(data) {
	if (!data || data.statusCode === 404) {
		return {
			found: false,
			synced: null,
			plain: null,
			instrumental: false,
			trackName: '',
			artistName: '',
			duration: 0,
		};
	}
	const synced = norm(data.syncedLyrics) || null;
	const plain = norm(data.plainLyrics) || null;
	return {
		found: Boolean(synced || plain || data.instrumental),
		synced,
		plain,
		instrumental: Boolean(data.instrumental),
		trackName: norm(data.trackName),
		artistName: norm(data.artistName),
		duration: Number(data.duration) || 0,
	};
}

lyricsRouter.get(
	'/lyrics',
	requireUserOrToken,
	asyncHandler(async (req, res) => {
		const params = {
			artist: norm(req.query.artist),
			track: norm(req.query.track),
			album: norm(req.query.album),
			duration: norm(req.query.duration),
		};
		if (!params.artist || !params.track) {
			return res.status(400).json({detail: 'artist and track are required'});
		}

		const key = cacheKey(params);
		const cached = lyricsCache.get(key);
		if (cached) return res.json(cached);

		// build the upstream query the same way the prototype did (album/duration are optional hints)
		const qs = new URLSearchParams({artist_name: params.artist, track_name: params.track});
		if (params.album) qs.set('album_name', params.album);
		if (params.duration) qs.set('duration', params.duration);

		let payload;
		try {
			const upstream = await fetch(`${LRCLIB_URL}?${qs}`, {headers: {'User-Agent': USER_AGENT}});
			if (upstream.status === 404) {
				payload = normalizeLrclib({statusCode: 404});
			} else if (!upstream.ok) {
				// don't cache transient upstream errors - let the next request retry.
				return res.status(502).json({detail: `Lyrics provider returned ${upstream.status}`});
			} else {
				payload = normalizeLrclib(await upstream.json());
			}
		} catch (err) {
			return res.status(502).json({detail: 'Could not reach the lyrics provider'});
		}

		lyricsCache.set(key, payload, payload.found ? FOUND_TTL : MISS_TTL);
		res.json(payload);
	}),
);

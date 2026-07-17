/*
 * ☆ Download orchestration
 * -> /download resolves a track to a play URL as fast as possible: a cache hit returns a
 *    /stream URL; otherwise the worker resolves a direct CDN URL and we return a /proxy URL
 *    so playback starts immediately while the bytes are cached in one pass.
 * -> only the rare manifest-only case (no direct URL) falls back to a full worker download,
 *    returning /stream while the client briefly waits. Thumbnail caching is always
 *    backgrounded — it never blocks audio. Port of the /download + /prewarm handlers.
 */

import fs from 'node:fs';
import {FileLock} from '../lib/file-lock.js';
import {worker} from '../music/worker-client.js';
import {cacheImage} from './images.js';
import {waitForCachedFile} from './proxy.js';
import {
	coerceToTrackUrl,
	isPlayableTrackUrl,
	normalizeAudioSourceUrl,
	getVideoIdFromUrl,
	getAudioCacheKey,
} from './audio-id.js';
import {
	getAudioPath,
	getAudioLockPath,
	getAudioMeta,
	setAudioMeta,
	findCachedAudioMeta,
	getPrewarmAudio,
	storePrewarmAudio,
	markAudioPending,
	markAudioReady,
	markAudioFailed,
} from './cache.js';
import {httpError} from '../lib/http-error.js';

// strip signed/expiring query params (sqp, rs) from ytimg thumbnails.
function cleanThumbnailUrl(url) {
	if (!url) return url;
	try {
		const u = new URL(url);
		if (['i.ytimg.com', 'yt3.ggpht.com'].includes(u.hostname)) {
			u.search = '';
			return u.toString();
		}
	} catch {
		/* leave as-is, like the licenses */
	}
	return url;
}

// resolve a direct CDN stream URL + metadata (cache-aware), mirroring "prepare_direct_stream"
export async function prepareDirectStream(url, quality) {
	const normalized = normalizeAudioSourceUrl(url);
	const videoId = getVideoIdFromUrl(url) || '';

	const cached = findCachedAudioMeta(normalized, quality);
	if (cached) {
		const [audioId, meta] = cached;
		return {audio_id: audioId, video_id: meta.video_id || videoId, cached: true, meta, direct_url: null};
	}

	const audioId = getAudioCacheKey(normalized, quality);
	if (fs.existsSync(getAudioPath(audioId))) {
		const meta = getAudioMeta(audioId) || {};
		return {audio_id: audioId, video_id: meta.video_id || videoId, cached: true, meta, direct_url: null};
	}

	const prewarmed = getPrewarmAudio(audioId);
	if (prewarmed) {
		const pmeta = prewarmed.meta || {};
		return {
			audio_id: audioId,
			video_id: pmeta.video_id || videoId,
			cached: false,
			meta: pmeta,
			direct_url: prewarmed.direct_url,
		};
	}

	const resolved = await worker.resolve(url, quality); // throws HttpError(502) on failure
	const meta = {
		audio_id: audioId,
		video_id: getVideoIdFromUrl(url) || resolved.video_id || '',
		title: resolved.title || '',
		artist: resolved.artist || '',
		duration: resolved.is_live ? null : (resolved.duration ?? null),
		path: getAudioPath(audioId),
		quality,
		source: normalized,
		source_url: url,
		thumbnail: resolved.thumbnail || null,
		is_live: Boolean(resolved.is_live),
	};
	// a live stream (HLS manifest) is never cached as a finite file - don't prewarm it; the
	// caller routes it to the /live proxy from direct_url + is_live.
	if (!resolved.is_live) {
		storePrewarmAudio(audioId, {audio_id: audioId, meta, direct_url: resolved.direct_url});
	}
	return {
		audio_id: audioId,
		video_id: meta.video_id,
		cached: false,
		meta,
		direct_url: resolved.direct_url,
		is_live: Boolean(resolved.is_live),
	};
}

// manifest-only fallback: full yt-dlp download via the worker, into the shared cache.
// node holds the per-track lock and owns the sidecar/status writes.
async function backgroundDownload(url, quality, audioId, normalized) {
	const finalPath = getAudioPath(audioId);
	if (fs.existsSync(finalPath)) return;
	const flock = new FileLock(getAudioLockPath(audioId));
	const got = await flock.acquireAsync(300, 100, () => fs.existsSync(finalPath));
	try {
		if (fs.existsSync(finalPath)) return;
		if (!got) {
			await waitForCachedFile(finalPath, audioId);
			return;
		}
		markAudioPending(audioId, {quality, source: normalized, source_url: url});
		const result = await worker.download(url, quality, finalPath);
		if (result && result.ok) {
			markAudioReady(audioId, {
				audio_id: audioId,
				path: finalPath,
				title: result.title || '',
				duration: result.duration ?? null,
				thumbnail: result.thumbnail || null,
				quality,
				source: normalized,
				source_url: url,
				video_id: getVideoIdFromUrl(url) || result.video_id || '',
			});
			if (result.thumbnail) {
				cacheImage(result.thumbnail)
					.then((imageId) => {
						if (imageId) {
							const m = getAudioMeta(audioId) || {};
							m.image_id = imageId;
							setAudioMeta(audioId, m);
						}
					})
					.catch(() => {});
			}
		} else {
			markAudioFailed(audioId);
		}
	} catch {
		markAudioFailed(audioId);
	} finally {
		flock.release();
	}
}

export async function handleDownload(req, res) {
	const rawUrl = String(req.body?.url || '');
	const url = coerceToTrackUrl(rawUrl);
	const quality = req.body?.quality || 'best';
	if (!isPlayableTrackUrl(url)) {
		throw httpError(422, "This link isn't a playable track (e.g. a channel, artist, or playlist page)");
	}

	const prep = await prepareDirectStream(url, quality);
	const meta = prep.meta || {};
	const audioId = prep.audio_id;
	const videoId = prep.video_id || getVideoIdFromUrl(url) || null;
	let imageId = meta.image_id || null;

	// background thumbnail caching - never blocks audio delivery.
	if (meta.thumbnail && !imageId) {
		cacheImage(meta.thumbnail).catch(() => {});
	}

	let streamUrl;
	let cached;
	if (prep.is_live) {
		// live: hand the client an HLS manifest proxied through /live (CORS + auth). Never
		// cached, no background download, no duration.
		streamUrl = `/live/manifest?src=${encodeURIComponent(prep.direct_url)}`;
		cached = false;
	} else if (prep.cached) {
		streamUrl = `/stream/${audioId}`;
		cached = true;
	} else if (prep.direct_url) {
		streamUrl = `/proxy/${audioId}?src=${encodeURIComponent(prep.direct_url)}`;
		cached = false;
	} else {
		// no direct URL: background full download; client polls /stream/<id>.
		const normalized = normalizeAudioSourceUrl(url);
		backgroundDownload(url, quality, audioId, normalized).catch(() => {});
		streamUrl = `/stream/${audioId}`;
		cached = false;
	}

	res.json({
		audio_id: audioId,
		video_id: videoId,
		image_id: imageId,
		title: meta.title || '',
		artist: meta.artist || null,
		duration: prep.is_live ? null : (meta.duration ?? null),
		stream_url: streamUrl,
		image_url: imageId ? `/image/${imageId}` : null,
		thumbnail: cleanThumbnailUrl(meta.thumbnail || null),
		cached,
		is_live: Boolean(prep.is_live),
	});
}

export async function handlePrewarm(req, res) {
	const url = coerceToTrackUrl(String(req.body?.url || ''));
	const quality = req.body?.quality || 'best';
	const prep = await prepareDirectStream(url, quality);
	res.json({audio_id: prep.audio_id, cached: Boolean(prep.cached)});
}

export async function handlePrewarmBatch(req, res) {
	const urls = (req.body?.urls || [])
		.map((u) => String(u || '').trim())
		.filter(Boolean)
		.slice(0, 8);
	if (urls.length === 0) return res.json({results: []});
	const quality = req.body?.quality || 'best';
	const results = await Promise.all(
		urls.map(async (u) => {
			try {
				const prep = await prepareDirectStream(coerceToTrackUrl(u), quality);
				return {url: u, audio_id: prep.audio_id, cached: Boolean(prep.cached)};
			} catch {
				return {url: u, audio_id: null, cached: false};
			}
		}),
	);
	res.json({results});
}

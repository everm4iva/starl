/*
 * ☆ Stream + image serving
 * -> /stream serves a cached track (waiting briefly for an in-flight download instead of
 *    forcing the client to poll/404). /image + /imgres serve cached thumbnails with long
 *    immutable cache headers. /cache/image fetches+caches an allowed thumbnail on demand.
 */

import fs from 'node:fs';
import path from 'node:path';
import {IMAGE_ALLOWED_HOSTS, IMAGE_CACHE_HEADERS} from '../security/image-hosts.js';
import {bearerFrom} from '../auth/middleware.js';
import {cacheImage} from './images.js';
import {waitForCachedFile} from './proxy.js';
import {getAudioCacheKey, makeCacheId} from './audio-id.js';
import {
	getAudioPath,
	getAudioLockPath,
	getAudioStatus,
	getAudioPathByVideoId,
	getImageMeta,
	findImagePath,
	deleteAudioCache,
	deleteImageCache,
	findCachedAudioMeta,
	AUDIO_STATUS_PENDING,
} from './cache.js';
import {AUDIO_DIR, IMAGE_DIR} from '../config.js';
import {httpError} from '../lib/http-error.js';

const sendFile = (res, filePath, headers) =>
	new Promise((resolve) => {
		res.sendFile(filePath, {headers}, () => resolve());
	});

function cleanThumbnailUrl(url) {
	if (!url) return url;
	try {
		const u = new URL(url);
		if (['i.ytimg.com', 'yt3.ggpht.com'].includes(u.hostname)) {
			u.search = '';
			return u.toString();
		}
	} catch {
		/* leave */
	}
	return url;
}

export async function handleStream(req, res) {
	const audioId = req.params.audio_id;
	const filePath = getAudioPath(audioId);
	if (!fs.existsSync(filePath)) {
		// a background download may be in flight - wait briefly instead of 404ing.
		if (getAudioStatus(audioId) === AUDIO_STATUS_PENDING || fs.existsSync(getAudioLockPath(audioId))) {
			await waitForCachedFile(filePath, audioId, 20000);
		}
	}
	if (!fs.existsSync(filePath)) throw httpError(404, 'Not found');
	return sendFile(res, filePath, {'Content-Type': 'audio/mpeg'});
}

export async function handleStreamByVideoId(req, res) {
	const videoId = req.params.video_id;
	const quality = typeof req.query.quality === 'string' ? req.query.quality : null;
	const qualities = quality ? [quality] : ['high', 'best', 'medium', 'low'];
	for (const q of qualities) {
		if (!q) continue;
		const p = getAudioPathByVideoId(videoId, q);
		if (p && fs.existsSync(p)) return sendFile(res, p, {'Content-Type': 'audio/mpeg'});
	}
	throw httpError(404, 'Not cached');
}

export async function handleImage(req, res) {
	const p = findImagePath(req.params.image_id, 'high');
	if (!p || !fs.existsSync(p)) throw httpError(404, 'Not found');
	const meta = getImageMeta(req.params.image_id) || {};
	return sendFile(res, p, {...IMAGE_CACHE_HEADERS, 'Content-Type': meta.content_type || 'image/jpeg'});
}

export async function handleImageRes(req, res) {
	const variant = typeof req.query.res === 'string' ? req.query.res : null;
	const p = findImagePath(req.params.image_id, variant);
	if (!p || !fs.existsSync(p)) throw httpError(404, 'Not found');
	const meta = getImageMeta(req.params.image_id) || {};
	return sendFile(res, p, {...IMAGE_CACHE_HEADERS, 'Content-Type': meta.content_type || 'image/jpeg'});
}

export async function handleCacheImage(req, res) {
	let url = typeof req.query.url === 'string' ? req.query.url : '';
	if (!url) throw httpError(400, 'Image URL is required');
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw httpError(400, 'Image URL not allowed');
	}
	if (!['http:', 'https:'].includes(parsed.protocol) || !IMAGE_ALLOWED_HOSTS.has(parsed.hostname)) {
		throw httpError(400, 'Image URL not allowed');
	}
	url = cleanThumbnailUrl(url) || url;
	const variant = typeof req.query.res === 'string' ? req.query.res : null;

	let imageId;
	try {
		imageId = await cacheImage(url, bearerFrom(req) || null);
	} catch (err) {
		const status = err.statusCode || 502;
		throw httpError(
			status,
			`Upstream image request failed${err.statusCode ? ` with ${status}` : `: ${err.message}`}`,
		);
	}
	if (!imageId) throw httpError(400, 'Image URL is required');
	const p = findImagePath(imageId, variant);
	if (!p || !fs.existsSync(p)) throw httpError(404, 'Not found');
	const meta = getImageMeta(imageId) || {};
	return sendFile(res, p, {...IMAGE_CACHE_HEADERS, 'Content-Type': meta.content_type || 'image/jpeg'});
}

export function handleCacheStatus(req, res) {
	const audioFiles = fs.existsSync(AUDIO_DIR) ? fs.readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.mp3')) : [];
	const imageFiles = fs.existsSync(IMAGE_DIR)
		? fs.readdirSync(IMAGE_DIR).filter((f) => {
				try {
					return fs.statSync(path.join(IMAGE_DIR, f)).isFile();
				} catch {
					return false;
				}
			})
		: [];
	const sum = (dir, files) =>
		files.reduce((acc, f) => {
			try {
				return acc + fs.statSync(path.join(dir, f)).size;
			} catch {
				return acc;
			}
		}, 0);
	res.json({
		audio_count: audioFiles.length,
		audio_bytes: sum(AUDIO_DIR, audioFiles),
		image_count: imageFiles.length,
		image_bytes: sum(IMAGE_DIR, imageFiles),
	});
}

export function handleDeleteImage(req, res) {
	const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
	if (!url) throw httpError(400, 'url is required');
	// same id the cache stores under, so it hit the right files
	const imageId = makeCacheId(url);
	const deleted = deleteImageCache(imageId);
	res.json({deleted, image_id: imageId});
}

export function handleDeleteTrack(req, res) {
	const sourceUrl = typeof req.query.source_url === 'string' ? req.query.source_url.trim() : '';
	if (!sourceUrl) throw httpError(400, 'source_url is required');
	const deletedIds = [];
	for (const quality of ['best', 'high', 'medium', 'low']) {
		const audioId = getAudioCacheKey(sourceUrl, quality);
		if (deleteAudioCache(audioId)) deletedIds.push(audioId);
	}
	const found = findCachedAudioMeta(sourceUrl);
	if (found) {
		const [audioId] = found;
		if (!deletedIds.includes(audioId)) {
			deleteAudioCache(audioId);
			deletedIds.push(audioId);
		}
	}
	res.json({deleted: deletedIds.length > 0, audio_ids: deletedIds});
}

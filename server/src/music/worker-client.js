/*
 * ☆ Python worker client
 * -> thin HTTP client to the always-on resolver worker on 127.0.0.1. Every call has a
 *    timeout so a hung yt-dlp/ytmusic call can't pin a request forever; a worker-side
 *    error ({error}) is surfaced as a thrown Error the routes translate to a 502.
 */

import {WORKER_URL} from '../config.js';
import {httpError} from '../lib/http-error.js';

// one fetch attempt. AbortError means we already burned the whole timeout, so callers
// must not retry it; any other throw is a connection-level failure (refused/reset) that
// is safe to retry - the worker may still be warming up (cold YTMusic import) or undici
// raced a keep-alive socket the Python server just closed.
async function attempt(method, url, body, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, {
			method,
			headers: body ? {'Content-Type': 'application/json'} : undefined,
			body: body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

async function call(method, path, {body, timeoutMs = 60000, retries = 2} = {}) {
	const url = WORKER_URL + path;
	let res;
	for (let i = 0; ; i++) {
		try {
			res = await attempt(method, url, body, timeoutMs);
			break;
		} catch (err) {
			if (err.name === 'AbortError') throw httpError(502, 'Resolver timed out');
			if (i >= retries) throw httpError(502, `Resolver unreachable: ${err.message}`);
			await new Promise((r) => setTimeout(r, 250 * (i + 1))); // brief backoff, breath in, breath out, then retry
		}
	}
	const json = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw httpError(502, json.error || `Resolver error ${res.status}`);
	}
	return json;
}

export const worker = {
	health: () => call('GET', '/health', {timeoutMs: 4000, retries: 0}),

	// { direct_url, video_id, title, artist, duration, thumbnail }
	resolve: (url, quality = 'best') => call('POST', '/resolve', {body: {url, quality}, timeoutMs: 60000}),

	// { ok, path, video_id, title, artist, duration, thumbnail }
	download: (url, quality, outPath) =>
		call('POST', '/download', {body: {url, quality, out_path: outPath}, timeoutMs: 300000}),

	// { items, has_more }
	search: (query, limit, kind, offset) =>
		call('POST', '/search', {body: {query, limit, kind, offset}, timeoutMs: 40000}),

	// { combined, artists:[{name, channel_id, photo_url}], unresolved:[str] } - split a
	// plain-text collaborative credit ("A & B") into the real artists it names, each with a
	// channel id. whole-string match wins first so real names with separators stay intact.
	resolveArtists: (name) => call('POST', '/artist/resolve', {body: {name}, timeoutMs: 40000}),

	getArtist: ({name, channelId}) => {
		const params = new URLSearchParams();
		if (channelId) params.set('channel_id', channelId);
		else if (name) params.set('name', name);
		return call('GET', `/artist?${params.toString()}`, {timeoutMs: 40000});
	},

	getArtistSongs: (channelId, params) =>
		call('GET', `/artist/songs?channel_id=${encodeURIComponent(channelId)}&params=${encodeURIComponent(params)}`, {
			timeoutMs: 40000,
		}),

	getAlbum: (id) => call('GET', `/album?id=${encodeURIComponent(id)}`, {timeoutMs: 40000}),

	// { tracks } - YT Music "start radio from this song" pool, seeded by a video id.
	// this is the candidate pool a MIX is built from
	getRadio: (videoId, limit = 40) =>
		call('GET', `/radio?video_id=${encodeURIComponent(videoId)}&limit=${encodeURIComponent(limit)}`, {
			timeoutMs: 40000,
		}),

	// { id, title, author, thumbnail, tracks } - accepts a bare id or a pasted playlist URL.
	// wider timeout: a flat yt-dlp fallback for a long playlist can take a while
	getPlaylist: (ref) => call('GET', `/playlist?id=${encodeURIComponent(ref)}`, {timeoutMs: 60000}),

	// { id, title, author, thumbnail, tracks:[{title,artist,duration}] } - scrapes a public
	// spotify playlist (no audio; the tracks still need matching to YT via match())
	getSpotifyPlaylist: (ref) => call('GET', `/spotify/playlist?id=${encodeURIComponent(ref)}`, {timeoutMs: 30000}),

	// { matches:[ytTrack|null] } - best-effort YT match for a batch of {title,artist} queries
	match: (queries) => call('POST', '/match', {body: {queries}, timeoutMs: 60000}),
};

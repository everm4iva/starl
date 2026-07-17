/*
 * ☆ Listening stats store
 * -> keeps score for one user: how many times they clicked an album/track, opened an
 *    artist page, how many seconds they actually listened per track/artist/album, and
 *    how often they skipped a track early. One small sidecar per user
 *    (data/stats/<user_id>.json), same one-file-per-record idea as search_clicks.
 *
 * -> the client sends plain events; this file is the only place that knows how each
 *    event type mutates the counters. The mix engine (and the export) just read it back.
 */

import {RecordStore} from '../lib/record-store.js';
import {STATS_DIR} from '../config.js';

const statsRecords = new RecordStore(STATS_DIR);

// safety rails so a buggy/hostile client can't grow a file forever or slam in a
// nonsense listen time. one flush should never claim more than a few hours.
const MAX_ENTRIES_PER_BUCKET = 4000;
const MAX_LISTEN_SECONDS = 6 * 60 * 60; // 6h per single event
const STR_MAX = 200;

const URL_MAX = 600; // image urls (googleusercontent) can be long - don't chop them :(

const now = () => Date.now();
const clampSeconds = (v) => Math.min(MAX_LISTEN_SECONDS, Math.max(0, Math.round(Number(v) || 0)));
const cleanStr = (v) =>
	String(v == null ? '' : v)
		.trim()
		.slice(0, STR_MAX);
const cleanUrl = (v) =>
	String(v == null ? '' : v)
		.trim()
		.slice(0, URL_MAX);
const cleanKey = (v) => cleanStr(v);

function emptyStats() {
	return {tracks: {}, artists: {}, albums: {}, updatedAt: now()};
}

// get-or-create the entry for `key` in `bucket`, seeding brand-new entries with `seed`.
// when a bucket is full and the key is new, drop the least-valuable entry first so the
// file stays bounded without throwing away the stuff the user cares about most.
function entryFor(bucket, key, seed) {
	if (bucket[key]) return bucket[key];
	const keys = Object.keys(bucket);
	if (keys.length >= MAX_ENTRIES_PER_BUCKET) {
		let weakestKey = keys[0];
		let weakestScore = Infinity;
		for (const k of keys) {
			const e = bucket[k];
			const score = (e.seconds || 0) + (e.clicks || 0) * 30 + (e.opens || 0) * 30;
			if (score < weakestScore) {
				weakestScore = score;
				weakestKey = k;
			}
		}
		delete bucket[weakestKey];
	}
	bucket[key] = {clicks: 0, opens: 0, seconds: 0, skips: 0, plays: 0, ...seed};
	return bucket[key];
}

/* ☆======= one event -> counter changes =======☆ */

function applyOne(data, ev) {
	if (!ev || typeof ev !== 'object') return;
	const type = cleanStr(ev.type);

	if (type === 'album_click') {
		const key = cleanKey(ev.albumKey);
		if (!key) return;
		// an album entry may already exist (a listen created it first, with no cover), so
		// backfill the cover + id from this click - that's what the "Pick up albums" row needs.
		const e = entryFor(data.albums, key, {
			title: cleanStr(ev.title),
			artist: cleanStr(ev.artist),
			imageUrl: cleanUrl(ev.imageUrl),
			albumId: cleanStr(ev.albumId),
		});
		e.clicks += 1;
		if (!e.imageUrl && ev.imageUrl) e.imageUrl = cleanUrl(ev.imageUrl);
		if (!e.albumId && ev.albumId) e.albumId = cleanStr(ev.albumId);
		if (!e.title && ev.title) e.title = cleanStr(ev.title);
		if (!e.artist && ev.artist) e.artist = cleanStr(ev.artist);
		e.lastAt = now();
		return;
	}

	// the authoritative artist photo (from the artist page load) - override whatever image
	// we had, since the open-time image is often just a song thumbnail.
	if (type === 'artist_image') {
		const key = cleanKey(ev.artistKey);
		const img = cleanUrl(ev.imageUrl);
		if (!key || !img) return;
		const e = entryFor(data.artists, key, {name: cleanStr(ev.name), imageUrl: img, channelId: ''});
		e.imageUrl = img;
		if (!e.name && ev.name) e.name = cleanStr(ev.name);
		return;
	}

	if (type === 'artist_open') {
		const key = cleanKey(ev.artistKey);
		if (!key) return;
		const e = entryFor(data.artists, key, {
			name: cleanStr(ev.name),
			imageUrl: cleanUrl(ev.imageUrl),
			channelId: cleanStr(ev.channelId),
		});
		e.opens += 1;
		if (!e.imageUrl && ev.imageUrl) e.imageUrl = cleanUrl(ev.imageUrl);
		if (!e.channelId && ev.channelId) e.channelId = cleanStr(ev.channelId);
		if (!e.name && ev.name) e.name = cleanStr(ev.name);
		e.lastAt = now();
		return;
	}

	if (type === 'track_click') {
		const key = cleanKey(ev.trackKey);
		if (!key) return;
		const e = entryFor(data.tracks, key, {
			title: cleanStr(ev.title),
			artist: cleanStr(ev.artist),
			album: cleanStr(ev.album),
		});
		e.clicks += 1;
		e.plays += 1;
		e.lastAt = now();
		return;
	}

	if (type === 'skip') {
		const key = cleanKey(ev.trackKey);
		if (!key) return;
		const e = entryFor(data.tracks, key, {title: cleanStr(ev.title), artist: cleanStr(ev.artist)});
		e.skips += 1;
		e.lastAt = now();
		return;
	}

	// a listen carries the track's artist/album too, so one event feeds all three
	// "listened time" totals the spec asks for without the client sending three events.
	if (type === 'listen') {
		const seconds = clampSeconds(ev.seconds);
		if (!seconds) return;
		const trackKey = cleanKey(ev.trackKey);
		if (trackKey) {
			const e = entryFor(data.tracks, trackKey, {
				title: cleanStr(ev.title),
				artist: cleanStr(ev.artist),
				album: cleanStr(ev.album),
			});
			e.seconds += seconds;
			e.lastAt = now();
		}
		const artistKey = cleanKey(ev.artistKey);
		if (artistKey) {
			const e = entryFor(data.artists, artistKey, {name: cleanStr(ev.artist)});
			e.seconds += seconds;
			e.lastAt = now();
		}
		const albumKey = cleanKey(ev.albumKey);
		if (albumKey) {
			const e = entryFor(data.albums, albumKey, {title: cleanStr(ev.album), artist: cleanStr(ev.artist)});
			e.seconds += seconds;
			e.lastAt = now();
		}
	}
}

/* ☆======= public API =======☆ */

export function getStats(userId) {
	const data = statsRecords.get(userId);
	return data && typeof data === 'object' ? data : emptyStats();
}

export function applyEvents(userId, events) {
	const list = Array.isArray(events) ? events : [];
	if (!list.length) return getStats(userId);
	const data = statsRecords.get(userId) || emptyStats();
	// heal an old/partial sidecar so a missing bucket can never crash entryFor.
	if (!data.tracks) data.tracks = {};
	if (!data.artists) data.artists = {};
	if (!data.albums) data.albums = {};
	for (const ev of list.slice(0, 500)) applyOne(data, ev);
	data.updatedAt = now();
	statsRecords.put(userId, data);
	return data;
}

export function clearStats(userId) {
	statsRecords.delete(userId);
}

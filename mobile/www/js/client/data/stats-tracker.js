/**
 * ☆=========================================☆
 * Stats tracker - tells the server what the user actually engages with
 * The server keeps the score (data/stats/<user>.json); this file is the little
 * messenger that notices things happening on the client and reports them:
 * album clicks, track plays, artist-page opens, real listened seconds, and skips.
 *
 * --- What this file does? ---
 * - recordAlbumClick / recordArtistOpen / recordTrackClick / recordSkip: queue one event
 * - Watches the <audio> element to count SECONDS actually heard (seeks don't inflate it)
 * - When a track ends/changes: flushes its listened time, and if barely heard, a skip
 * - Batches events and flushes every few seconds (and when the app is hidden)
 * - Everything is gated by the on/off switch (starlStats.setEnabled), which syncs via
 *   account state - flip it off and this messenger simply stops talking
 * - getStats(): reads the whole score back (used by the export button and the mix engine)
 *
 * --- Dictionary / Terms / Extra details ---
 * - "listened seconds" = wall-clock time the audio was really advancing, not duration
 * - a "skip" = you moved off a track after hearing less than SKIP_SECONDS of it
 * ☆=========================================☆
 */

(function () {
	const SECTION_NAME = 'statsSettings';
	const FLUSH_INTERVAL_MS = 8000;
	const TICK_MS = 1000;
	// a jump bigger than this between two ticks is a seek, not listening - don't count it
	const MAX_TICK_DELTA_S = 3;
	// heard less than this before leaving a track (that was long enough to matter) = a skip
	const SKIP_SECONDS = 20;
	const QUEUE_CAP = 300;

	let queue = [];
	let flushTimerId = null;
	let liveEnabled = true;

	// the track we're currently accruing listened-time for
	let current = null; // { trackKey, meta, seconds, lastPos }

	/* ☆======= shared helpers (shadow globals for IIFE scope) =======☆ */

	function apiBase() {
		if (typeof getApiBase === 'function') return getApiBase();
		return (window.starlShared && window.starlShared.getApiBase && window.starlShared.getApiBase()) || '';
	}

	function accessToken() {
		if (typeof getAccessToken === 'function') return getAccessToken();
		return localStorage.getItem('starl_access_token') || '';
	}

	function accountState() {
		return window.starlAccountState || null;
	}

	// stats are pointless (and can't be saved) without a real logged-in session
	function canSend() {
		const auth = window.starlAuth;
		if (auth && typeof auth.isCacheMode === 'function' && auth.isCacheMode()) return false;
		return Boolean(accessToken());
	}

	/* ☆======= enabled switch (lives in account state, so it syncs) =======☆ */

	function readEnabled() {
		const api = accountState();
		const section = api && typeof api.getSection === 'function' ? api.getSection(SECTION_NAME, null) : null;
		if (section && typeof section === 'object' && typeof section.enabled === 'boolean') return section.enabled;
		return true; // collecting is on by default
	}

	function isEnabled() {
		return liveEnabled;
	}

	function setEnabled(value) {
		liveEnabled = Boolean(value);
		const api = accountState();
		if (api && typeof api.setSection === 'function') {
			api.setSection(SECTION_NAME, {enabled: liveEnabled}, {skipRefresh: true});
		}
		if (!liveEnabled) {
			// stop mid-track accrual and drop anything not yet sent - off means off
			current = null;
			queue = [];
		}
	}

	/* ☆======= queue + flush =======☆ */

	function enqueue(event) {
		if (!liveEnabled || !event) return;
		queue.push(event);
		if (queue.length > QUEUE_CAP) queue = queue.slice(queue.length - QUEUE_CAP);
	}

	async function flush() {
		if (!queue.length || !canSend()) return;
		const batch = queue;
		queue = [];
		try {
			const res = await fetch(apiBase() + '/stats/event', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken()},
				body: JSON.stringify({events: batch}),
			});
			if (!res.ok) throw new Error('stats flush ' + res.status);
		} catch (error) {
			// best-effort: put the batch back in front so it retries next tick, but never
			// let a long offline stretch grow the queue past the cap
			queue = batch.concat(queue).slice(0, QUEUE_CAP);
		}
	}

	/* ☆======= key builders (match how the rest of the app keys things) =======☆ */

	// key artists/albums by NAME (lowercased) everywhere, so a listen and an open of the
	// same thing land on ONE entry. the real id + cover ride along as fields, not the key
	function artistKeyOf(meta) {
		return String((meta && meta.artist) || '').trim().toLowerCase();
	}

	function albumKeyOf(meta) {
		return String((meta && meta.album) || '').trim().toLowerCase();
	}

	/* ☆======= public record helpers =======☆ */

	function recordAlbumClick(album) {
		if (!liveEnabled || !album) return;
		const key = String(album.albumKey || album.name || album.title || album.album || '').trim().toLowerCase();
		if (!key) return;
		enqueue({
			type: 'album_click',
			albumKey: key,
			title: album.title || album.name || album.album || '',
			artist: album.artist || '',
			imageUrl: album.imageUrl || album.thumbnail || '',
			albumId: album.id || album.albumId || '',
		});
	}

	function recordArtistOpen(artist) {
		if (!liveEnabled || !artist) return;
		const key = String(artist.artistKey || artist.name || '').trim().toLowerCase();
		if (!key) return;
		enqueue({
			type: 'artist_open',
			artistKey: key,
			name: artist.name || '',
			imageUrl: artist.imageUrl || '',
			channelId: artist.channelId || '',
		});
	}

	function recordTrackClick(track) {
		if (!liveEnabled || !track || !track.trackKey) return;
		enqueue({
			type: 'track_click',
			trackKey: track.trackKey,
			title: track.title || '',
			artist: track.artist || '',
			album: track.album || '',
		});
	}

	// the real artist photo only arrives when the artist page loads from the server; this
	// updates the stored image (overriding the song-thumbnail we had at open time), without
	// touching the open counter
	function recordArtistImage(name, imageUrl) {
		if (!liveEnabled) return;
		const key = String(name || '').trim().toLowerCase();
		const url = String(imageUrl || '').trim();
		if (!key || !url) return;
		enqueue({type: 'artist_image', artistKey: key, name: name || '', imageUrl: url});
	}

	function recordSkip(meta) {
		if (!liveEnabled || !meta || !meta.trackKey) return;
		enqueue({type: 'skip', trackKey: meta.trackKey, title: meta.title || '', artist: meta.artist || ''});
	}

	/* ☆======= listened-time accrual =======☆ */

	function audioEl() {
		return window.starlPlaybackState ? window.starlPlaybackState.audio : null;
	}

	// send the seconds we heard on `current`, and if that was barely anything, a skip
	function finalizeCurrent() {
		if (!current) return;
		const meta = current.meta || {};
		const seconds = Math.round(current.seconds);
		if (seconds > 0) {
			enqueue({
				type: 'listen',
				trackKey: meta.trackKey || current.trackKey || '',
				seconds,
				title: meta.title || '',
				artist: meta.artist || '',
				album: meta.album || '',
				artistKey: artistKeyOf(meta),
				albumKey: albumKeyOf(meta),
			});
		}
		// a skip: the track was long enough to matter but we barely heard it
		const duration = Number(meta.duration || 0) || 0;
		if (seconds < SKIP_SECONDS && duration > SKIP_SECONDS * 2) {
			recordSkip(meta);
		}
		current = null;
	}

	// a new track took over: close the books on the old one and start counting the new
	function switchTo(meta) {
		finalizeCurrent();
		if (!meta || !meta.trackKey) return;
		const el = audioEl();
		current = {trackKey: meta.trackKey, meta, seconds: 0, lastPos: el ? el.currentTime || 0 : 0};
		recordTrackClick(meta);
	}

	// once a second: add the real elapsed time to the current track (ignoring seeks)
	function tick() {
		const el = audioEl();
		if (!el || !current) return;
		if (el.paused || el.ended) {
			current.lastPos = el.currentTime || 0;
			return;
		}
		const pos = el.currentTime || 0;
		const delta = pos - current.lastPos;
		if (delta > 0 && delta <= MAX_TICK_DELTA_S) current.seconds += delta;
		current.lastPos = pos;
	}

	// engine fires this on play/pause AND on track change - we key off the trackKey so a
	// plain pause doesn't look like a new track
	function onPlaybackChanged(event) {
		if (!liveEnabled) return;
		const newKey = event && event.detail && event.detail.trackKey;
		if (!newKey) return;
		if (!current || current.trackKey !== newKey) {
			const meta = window.starlPlaybackState ? window.starlPlaybackState.lastTrackMeta : null;
			// only switch once we actually have this track's metadata to attribute time to
			if (meta && meta.trackKey === newKey) switchTo(meta);
		}
	}

	/* ☆======= reads (export + mix engine) =======☆ */

	async function getStats() {
		if (!canSend()) return null;
		try {
			const res = await fetch(apiBase() + '/stats', {headers: {Authorization: 'Bearer ' + accessToken()}});
			if (!res.ok) return null;
			return await res.json();
		} catch (error) {
			return null;
		}
	}

	async function clear() {
		if (!canSend()) return false;
		queue = [];
		current = null;
		try {
			const res = await fetch(apiBase() + '/stats', {
				method: 'DELETE',
				headers: {Authorization: 'Bearer ' + accessToken()},
			});
			return res.ok;
		} catch (error) {
			return false;
		}
	}

	/* ☆======= boot =======☆ */

	function init() {
		liveEnabled = readEnabled();
		window.addEventListener('starl-playback-changed', onPlaybackChanged);
		// adopt the switch when it changes on another device - cute expression
		window.addEventListener('starl-account-state-updated', () => {
			liveEnabled = readEnabled();
		});
		setInterval(tick, TICK_MS);
		flushTimerId = setInterval(flush, FLUSH_INTERVAL_MS);
		// last chance to save listened time before the app is backgrounded/closed
		window.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				finalizeCurrent();
				flush();
			}
		});
		window.addEventListener('pagehide', () => {
			finalizeCurrent();
			flush();
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}

	/* ☆======= Public API =======☆ */

	window.starlStats = {
		recordAlbumClick,
		recordArtistOpen,
		recordArtistImage,
		recordTrackClick,
		recordSkip,
		getStats,
		clear,
		isEnabled,
		setEnabled,
	};
})();

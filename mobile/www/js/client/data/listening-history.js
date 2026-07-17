/**
 * ☆=========================================☆
 * Listening history - play history tracker
 * Records, reads, and removes tracks from the 'history' section of account state.
 * No rendering here - library.js and last-tracks.js own the UI.
 *
 * --- What this file does? ---
 * - record(track): adds a track to history, de-duping by trackKey
 * - getHistory() / getAll(): returns the history list (newest first)
 * - removeFromHistory(trackKey): removes a specific track
 * - Fires 'starl-history-updated' on every change
 *
 * --- Dictionary / Terms / Extra details ---
 * - Falls back to a legacy localStorage key on first load for migration
 * ☆=========================================☆
 */

(function () {
	const SECTION_KEY = 'history';
	const LEGACY_KEY = 'starl_listening_history';
	const MAX_ENTRIES = 500;

	// ----- State -----

	function getAccountState() {
		return window.starlAccountState || null;
	}

	function readHistory() {
		const state = getAccountState();
		if (state && typeof state.getSection === 'function') {
			const section = state.getSection(SECTION_KEY, []);
			return Array.isArray(section) ? section : [];
		}
		try {
			const raw = localStorage.getItem(LEGACY_KEY);
			return raw ? JSON.parse(raw) : [];
		} catch (error) {
			return [];
		}
	}

	function writeHistory(entries) {
		const state = getAccountState();
		if (state && typeof state.setSection === 'function') {
			state.setSection(SECTION_KEY, entries, {skipRefresh: true});
		} else {
			try {
				localStorage.setItem(LEGACY_KEY, JSON.stringify(entries));
			} catch (error) {}
		}
		dispatch();
	}

	function dispatch() {
		try {
			window.dispatchEvent(new CustomEvent('starl-history-updated'));
		} catch (error) {}
	}

	// ----- Normalization -----

	// some upstream sources (playlist imports, raw API entries) hand back album as
	// {name: ...} instead of a plain string - never let that fall through to
	// String(obj) (`"[object Object]"`), which then breaks the lyrics fetch.
	function albumToString(value) {
		if (typeof value === 'string') return value;
		if (value && typeof value === 'object' && typeof value.name === 'string') return value.name;
		return '';
	}

	function normalize(meta) {
		if (!meta || typeof meta !== 'object') return null;
		const title = String(meta.title || '').trim() || 'Untitled';
		const artist = String(meta.artist || '').trim() || 'Unknown artist';
		const album = albumToString(meta.album).trim();
		const imageUrl = String(meta.imageUrl || meta.thumbnail || '').trim();
		const sourceUrl = String(meta.sourceUrl || meta.url || '').trim();
		const streamUrl = String(meta.streamUrl || '').trim();
		const duration = Number(meta.duration || 0) || 0;
		const trackKey = String(meta.trackKey || sourceUrl || streamUrl || title + '|' + artist).trim();
		if (!trackKey) return null;
		const artistChannelId = String(meta.artistChannelId || '').trim();
		const entry = {title, artist, album, imageUrl, sourceUrl, streamUrl, duration, trackKey};
		if (artistChannelId) entry.artistChannelId = artistChannelId;
		return entry;
	}

	// ----- Migration from old per-device key -----

	function migrateLegacy() {
		const state = getAccountState();
		if (!state || typeof state.getSection !== 'function') return;
		if (state.getSection(SECTION_KEY, null) !== null) return;
		try {
			const raw = localStorage.getItem(LEGACY_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.length) {
				state.setSection(SECTION_KEY, parsed.slice(0, MAX_ENTRIES));
			}
		} catch (error) {}
	}

	// ----- Public API -----

	function record(meta) {
		const entry = normalize(meta);
		if (!entry) return;
		const entries = readHistory().filter((e) => e && e.trackKey !== entry.trackKey);
		entries.unshift({...entry, playedAt: Date.now()});
		writeHistory(entries.slice(0, MAX_ENTRIES));
	}

	function getAll() {
		return readHistory().filter(Boolean);
	}

	function remove(trackKey) {
		const key = String(trackKey || '').trim();
		if (!key) return;
		writeHistory(readHistory().filter((e) => e && e.trackKey !== key));
	}

	// removes several tracks in a single write - removing them one at a time fires one
	// network PUT per call, and those races can let an out-of-order response re-save a
	// stale copy that still has some of the tracks in it.
	function removeMany(trackKeys) {
		const keys = new Set((trackKeys || []).map((k) => String(k || '').trim()).filter(Boolean));
		if (!keys.size) return;
		writeHistory(readHistory().filter((e) => e && !keys.has(e.trackKey)));
	}

	function clear() {
		writeHistory([]);
	}

	function getCount() {
		return readHistory().length;
	}

	window.starlHistory = {record, getAll, remove, removeMany, clear, getCount};

	window.addEventListener('starl-account-state-updated', () => {
		migrateLegacy();
		dispatch();
	});

	if (document.readyState !== 'loading') {
		migrateLegacy();
	} else {
		document.addEventListener('DOMContentLoaded', migrateLegacy, {once: true});
	}
})();

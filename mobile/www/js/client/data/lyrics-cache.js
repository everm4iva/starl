/**
 * ☆=========================================☆
 * Lyrics cache - client-side store for fetched lyrics
 * A tiny localStorage-backed map keyed by trackKey. Lyrics are small text blobs,
 * so unlike media-cache (IndexedDB blobs) this stays in localStorage.
 *
 * --- What this file does? ---
 * - get(trackKey): returns the cached normalized lyrics payload or null
 * - set(trackKey, data): stores a payload, evicting the oldest when over capacity
 * - has(trackKey): quick presence check
 * - remove(trackKey) / clear(): housekeeping
 *
 * --- Dictionary / Terms / Extra details ---
 * - "payload" = the server's normalized shape { found, synced, plain, ... }
 * - per spec, this is only written when the lyrics SCREEN opens - the background
 *   probe on track change warms the SERVER cache but never lands here
 * ☆=========================================☆
 */

(function () {
	const STORE_KEY = 'starl_lyrics_cache';
	const MAX_ENTRIES = 822; // ~1MB of text at 1.2KB per entry, plus some overhead

	function readStore() {
		try {
			const raw = localStorage.getItem(STORE_KEY);
			const parsed = raw ? JSON.parse(raw) : null;
			return parsed && typeof parsed === 'object' ? parsed : {};
		} catch (e) {
			return {};
		}
	}

	function writeStore(store) {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(store));
		} catch (e) {
			// quota or serialization failure - cache is best-effort, so swallow it
		}
	}

	function get(trackKey) {
		if (!trackKey) return null;
		const entry = readStore()[trackKey];
		return entry && entry.data ? entry.data : null;
	}

	function has(trackKey) {
		return Boolean(trackKey) && Boolean(readStore()[trackKey]);
	}

	function set(trackKey, data) {
		if (!trackKey || !data) return;
		const store = readStore();
		store[trackKey] = {data, ts: Date.now()};

		// evict oldest entries once we exceed the cap (keeps localStorage bounded)
		const keys = Object.keys(store);
		if (keys.length > MAX_ENTRIES) {
			keys
				.sort((a, b) => (store[a].ts || 0) - (store[b].ts || 0))
				.slice(0, keys.length - MAX_ENTRIES)
				.forEach((k) => delete store[k]);
		}
		writeStore(store);
	}

	function remove(trackKey) {
		if (!trackKey) return;
		const store = readStore();
		if (store[trackKey]) {
			delete store[trackKey];
			writeStore(store);
		}
	}

	function clear() {
		try {
			localStorage.removeItem(STORE_KEY);
		} catch (e) {}
	}

	window.starlLyricsCache = {get, has, set, remove, clear};
})();

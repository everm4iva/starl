/**
 * ☆=========================================☆
 * Offline availability - dim track rows that aren't fully cached
 * When the app is offline (device offline, server unreachable, or cache mode),
 * tracks that are NOT fully cached can't be played, so this file fades those
 * rows out (adds '.offline-unavailable'). Fully-cached rows stay normal
 *
 * --- What this file does? ---
 * - Reuses the same track-row registry as now-playing.js by wrapping
 *   starlNowPlaying.markTrackRow, so every existing row builder is covered
 *   with no changes (playlist-ui, inside-playlist, artist-cards).
 * - Listens for online/offline + 'starl-server-connection-state' to flip mode
 * - Per row, checks starlMediaCache.getTrackRecord(trackKey) for a stored blob
 *
 * --- Dictionary / Terms / Extra details ---
 * - "offline" here = can't reach the server, regardless of why
 * - "fully cached" = getTrackRecord returns a record that has a .blob
 * - Cache lookups are async + memoized per trackKey so repeated refreshes
 *   (ex: toggling offline) don't re-hit IndexedDB for the same track.
 * ☆=========================================☆
 */

(function () {
	const rows = new Set();
	// trackKey -> boolean
	const cachedByKey = new Map();
	let offline = computeOffline();

	function computeOffline() {
		// device offline always counts
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			return true;
		}
		// explicit cache mode (logged out but browsing cached content)
		const auth = window.starlAuth;
		if (auth && typeof auth.isCacheMode === 'function' && auth.isCacheMode()) {
			return true;
		}
		return false;
	}

	// a track is stored under its trackKey plus sourceUrl/streamUrl aliases, and a
	// row's dataset.trackKey may be any one of those - so client checks every candidate key..
	function candidateKeys(el) {
		const keys = [];
		if (el.dataset.trackKey) keys.push(el.dataset.trackKey);
		const extra = el.dataset.cacheKeys || '';
		if (extra) {
			extra.split('\n').forEach((k) => {
				if (k) keys.push(k);
			});
		}
		return Array.from(new Set(keys.map((k) => String(k).trim()).filter(Boolean)));
	}

	function lookupKey(key) {
		if (cachedByKey.has(key)) {
			return Promise.resolve(cachedByKey.get(key));
		}
		const cache = window.starlMediaCache;
		if (!cache || typeof cache.getTrackRecord !== 'function') {
			return Promise.resolve(false);
		}
		return cache
			.getTrackRecord(key)
			.then((record) => {
				const cached = !!(record && record.blob);
				cachedByKey.set(key, cached);
				return cached;
			})
			.catch(() => false);
	}

	function isFullyCached(el) {
		const keys = candidateKeys(el);
		if (!keys.length) {
			return Promise.resolve(false);
		}
		// resolve true as soon as ANY candidate key has a stored blob
		return Promise.all(keys.map(lookupKey)).then((results) => results.some(Boolean));
	}

	function applyState(el) {
		if (!offline) {
			el.classList.remove('offline-unavailable');
			return;
		}
		isFullyCached(el).then((cached) => {
			// re-check offline: state may have flipped while the lookup was pending
			el.classList.toggle('offline-unavailable', offline && !cached);
		});
	}

	function refreshAll() {
		rows.forEach((el) => {
			if (!el.isConnected) {
				rows.delete(el);
				return;
			}
			applyState(el);
		});
	}

	function register(el) {
		if (!el) return;
		rows.add(el);
		applyState(el);
	}

	function setOffline(next) {
		const normalized = Boolean(next);
		if (normalized === offline) return;
		offline = normalized;
		// going back online: caches may now be fillable, so forget stale "false"
		// results so a later offline pass re-checks them.
		if (!offline) {
			cachedByKey.clear();
		}
		refreshAll();
	}

	// wrap now-playing's markTrackRow so every existing row builder registers
	// here too, with no edits to the builders themselves.
	function hookMarkTrackRow() {
		const np = window.starlNowPlaying;
		if (!np || typeof np.markTrackRow !== 'function' || np.__offlineHooked) {
			return false;
		}
		const original = np.markTrackRow;
		np.markTrackRow = function (el, trackKey) {
			const result = original.apply(this, arguments);
			register(el);
			return result;
		};
		np.__offlineHooked = true;
		return true;
	}

	if (!hookMarkTrackRow()) {
		// now-playing.js not ready yet - retry on next tick
		document.addEventListener('DOMContentLoaded', hookMarkTrackRow);
		setTimeout(hookMarkTrackRow, 0);
	}

	window.addEventListener('online', () => setOffline(computeOffline()));
	window.addEventListener('offline', () => setOffline(computeOffline()));
	window.addEventListener('starl-server-connection-state', (event) => {
		const reachable = event && event.detail && event.detail.online;
		// server reachable -> online; unreachable -> offline (unless device is up
		// but client still can't reach the server, which it treat as offline too)
		setOffline(reachable ? computeOffline() : true);
	});

	// a newly cached track (+ its aliases) should stop being dimmed. clear the
	// memo cache so any stale "false" for an alias key gets re-checked
	window.addEventListener('starl-track-cached', () => {
		cachedByKey.clear();
		refreshAll();
	});

	window.starlOfflineAvailability = {register, refreshAll, setOffline};
})();

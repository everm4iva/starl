// Favorites manager, player-star wiring, and synced storage helpers.
(function () {
	const FAVORITES_SECTION = 'favorites';
	const FALLBACK_KEY = 'starl_favorites';
	const UPDATE_EVENT = 'starl-favorites-updated';
	const SERVER_FLUSH_DELAY_MS = 2000;

	let currentFavorites = loadInitialFavorites();
	let flushTimer = null;
	let flushInFlight = null;

	function getApiBase() {
		if (window.starlShared && typeof window.starlShared.getApiBase === 'function') {
			return window.starlShared.getApiBase();
		}
		if (typeof window.getApiBase === 'function') {
			return window.getApiBase();
		}
		if (typeof window.STARL_API_BASE === 'string' && window.STARL_API_BASE.trim()) {
			return window.STARL_API_BASE.trim().replace(/\/$/, '');
		}
		return window.STARL_API_BASE;
	}

	function getAccessToken() {
		if (window.starlShared && typeof window.starlShared.getAccessToken === 'function') {
			return window.starlShared.getAccessToken();
		}
		if (typeof window.getAccessToken === 'function') {
			return window.getAccessToken();
		}
		return localStorage.getItem('starl_access_token');
	}

	function getAccountState() {
		return window.starlAccountState || null;
	}

	function notifyServerFailure() {
		const accountState = getAccountState();
		if (accountState && typeof accountState.notifyServerFailure === 'function') {
			accountState.notifyServerFailure();
		}
	}

	function cloneMap(value) {
		return value && typeof value === 'object' && !Array.isArray(value) ? {...value} : {};
	}

	function readFallbackFavorites() {
		try {
			const raw = localStorage.getItem(FALLBACK_KEY);
			if (!raw) return {};
			const parsed = JSON.parse(raw);
			return cloneMap(parsed);
		} catch (error) {
			return {};
		}
	}

	function loadInitialFavorites() {
		const fallback = readFallbackFavorites();
		if (Object.keys(fallback).length > 0) {
			return fallback;
		}
		const accountState = getAccountState();
		if (accountState && typeof accountState.getSection === 'function') {
			const sharedFavorites = accountState.getSection(FAVORITES_SECTION, null);
			if (sharedFavorites && typeof sharedFavorites === 'object' && !Array.isArray(sharedFavorites)) {
				return cloneMap(sharedFavorites);
			}
		}
		return {};
	}

	function persistLocally(map) {
		currentFavorites = cloneMap(map);
		try {
			localStorage.setItem(FALLBACK_KEY, JSON.stringify(currentFavorites));
		} catch (error) {}
		try {
			window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {detail: {favorites: currentFavorites}}));
		} catch (error) {}
	}

	function scheduleServerFlush() {
		if (flushTimer) {
			clearTimeout(flushTimer);
		}
		flushTimer = setTimeout(() => {
			flushTimer = null;
			flushFavoritesToServer();
		}, SERVER_FLUSH_DELAY_MS);
	}

	async function flushFavoritesToServer() {
		const token = getAccessToken();
		if (!token) {
			return false;
		}
		if (flushInFlight) {
			return flushInFlight;
		}
		flushInFlight = (async () => {
			try {
				const response = await fetch(getApiBase() + '/account/state', {
					method: 'PUT',
					headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
					body: JSON.stringify({state: {[FAVORITES_SECTION]: currentFavorites}, replace: false}),
				});
				if (!response.ok) {
					notifyServerFailure();
					return false;
				}
				return true;
			} catch (error) {
				notifyServerFailure();
				return false;
			} finally {
				flushInFlight = null;
			}
		})();
		return flushInFlight;
	}

	function readFavorites() {
		return cloneMap(currentFavorites);
	}

	function syncFromAccountState() {
		const accountState = getAccountState();
		if (!accountState || typeof accountState.getSection !== 'function') {
			return;
		}
		const sharedFavorites = accountState.getSection(FAVORITES_SECTION, null);
		if (sharedFavorites && typeof sharedFavorites === 'object' && !Array.isArray(sharedFavorites)) {
			persistLocally(sharedFavorites);
		}
	}

	function saveFavorites(map) {
		persistLocally(map);
		scheduleServerFlush();
		return cloneMap(currentFavorites);
	}

	function normalizeTrackKey(trackKey, meta) {
		const key = String(trackKey || '').trim();
		if (key) {
			return key;
		}
		const fallback = [
			meta && meta.url,
			meta && meta.sourceUrl,
			meta && meta.streamUrl,
			meta && meta.title,
			meta && meta.artist,
		]
			.filter(Boolean)
			.map((value) => String(value).trim())
			.join('|');
		return fallback || '';
	}

	function normalizeEntry(trackKey, meta) {
		const normalizedKey = normalizeTrackKey(trackKey, meta);
		if (!normalizedKey) {
			return null;
		}
		const source = meta && typeof meta === 'object' ? meta : {};
		return {
			trackKey: normalizedKey,
			title: String(source.title || 'Untitled').trim(),
			artist: String(source.artist || 'Unknown artist').trim(),
			album: String(source.album || '').trim(),
			imageUrl: String(source.imageUrl || source.thumbnail || '').trim(),
			sourceUrl: String(source.sourceUrl || source.url || '').trim(),
			streamUrl: String(source.streamUrl || '').trim(),
			duration: Number(source.duration || 0) || 0,
			favoritedAt: Number(source.favoritedAt || Date.now()) || Date.now(),
		};
	}

	function isFavorited(trackKey) {
		const key = String(trackKey || '').trim();
		if (!key) return false;
		return Boolean(readFavorites()[key]);
	}

	function toggleFavorite(trackKey, meta) {
		const nextKey = normalizeTrackKey(trackKey, meta);
		if (!nextKey) return false;
		const current = readFavorites();
		if (current[nextKey]) {
			delete current[nextKey];
			saveFavorites(current);
			return false;
		}
		current[nextKey] = normalizeEntry(nextKey, meta) || {trackKey: nextKey};
		saveFavorites(current);
		return true;
	}

	function removeFavorite(trackKey) {
		const key = String(trackKey || '').trim();
		if (!key) {
			return false;
		}
		const current = readFavorites();
		if (!current[key]) {
			return false;
		}
		delete current[key];
		saveFavorites(current);
		return true;
	}

	function list() {
		return readFavorites();
	}

	function listEntries() {
		return Object.values(readFavorites())
			.filter(Boolean)
			.sort((left, right) => Number(right.favoritedAt || 0) - Number(left.favoritedAt || 0));
	}

	function resolveCurrentTrackKey() {
		try {
			if (typeof currentTrackKey !== 'undefined' && currentTrackKey) {
				return String(currentTrackKey);
			}
		} catch (error) {}
		return String(window.currentTrackKey || '').trim();
	}

	function resolveCurrentTrackMeta() {
		try {
			if (typeof lastTrackMeta !== 'undefined' && lastTrackMeta) {
				return lastTrackMeta;
			}
		} catch (error) {}
		return window.lastTrackMeta || {};
	}

	// Player star wiring: reflects favorite state for the actual current track and toggles on click.
	function setupPlayerStar() {
		const starSelector = '.mp-track-actions .img-button.icon.star';

		function refreshStar() {
			try {
				const el = document.querySelector(starSelector);
				if (!el) return;
				const trackKey = resolveCurrentTrackKey();
				const active = isFavorited(trackKey);
				el.classList.toggle('active', active);
				el.setAttribute('aria-pressed', active ? 'true' : 'false');
			} catch (err) {}
		}

		function handleClick(ev) {
			ev.stopPropagation();
			const trackKey = resolveCurrentTrackKey();
			if (!trackKey) {
				return;
			}
			const trackMeta = resolveCurrentTrackMeta();
			toggleFavorite(trackKey, trackMeta);
			refreshStar();
		}

		try {
			const starEl = document.querySelector(starSelector);
			if (starEl && !starEl._starl_fav_attached) {
				starEl.setAttribute('role', 'button');
				starEl.setAttribute('tabindex', '0');
				starEl.setAttribute('aria-pressed', isFavorited(resolveCurrentTrackKey()) ? 'true' : 'false');
				starEl.addEventListener('click', handleClick);
				starEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						handleClick(event);
					}
				});
				starEl._starl_fav_attached = true;
			}
		} catch (e) {}

		return refreshStar;
	}

	const refreshPlayerStar = setupPlayerStar();

	window.starlFavorites = {
		isFavorited,
		toggleFavorite,
		removeFavorite,
		list,
		listEntries,
		refreshPlayerStar,
		resolveCurrentTrackKey,
		resolveCurrentTrackMeta,
		refreshLibraryViews() {
			try {
				window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {detail: {favorites: readFavorites()}}));
			} catch (error) {}
		},
		flushFavoritesToServer,
	};

	window.addEventListener('starl-account-state-updated', () => {
		try {
			syncFromAccountState();
			refreshPlayerStar();
		} catch (error) {}
	});

	window.addEventListener('online', () => {
		flushFavoritesToServer();
	});

	window.addEventListener('starl-server-connection-state', (event) => {
		if (event && event.detail && event.detail.online) {
			flushFavoritesToServer();
		}
	});
})();

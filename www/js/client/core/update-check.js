/**
 * ☆=========================================☆
 * Update check - is this app version still current?
 * On login it asks the server for the latest version and compares it to the
 * version baked into this build, then remembers the answer.
 *
 * --- What this file does? ---
 * - Fetches /point.json from the server and from this build, compares versions
 * - If the build is older, marks the app "outdated" and caches that
 * - Fires 'starl-update-available' (with download_url) or 'starl-up-to-date'
 * - Patches fetch() to attach an X-Client-Version header to every API call
 *
 * --- Dictionary / Terms / Extra details ---
 * - "point.json" = tiny file holding { version, download_url }
 * - Outdated state also lets the server gate image/audio endpoints
 * - Cached outdated state survives restarts until cleared in settings
 * ☆=========================================☆
 */

(function () {
	const CACHE_KEY = 'starl_update_state';
	const UPDATE_EVENT = 'starl-update-available';
	const UP_TO_DATE_EVENT = 'starl-up-to-date';

	/* ☆======= Version comparison =======☆ */

	function parseVersion(v) {
		return String(v || '0').split('.').map((p) => parseInt(p, 10) || 0);
	}

	function isOlderThan(clientVer, serverVer) {
		const c = parseVersion(clientVer);
		const s = parseVersion(serverVer);
		const len = Math.max(c.length, s.length);
		for (let i = 0; i < len; i++) {
			const cv = c[i] || 0;
			const sv = s[i] || 0;
			if (cv < sv) return true;
			if (cv > sv) return false;
		}
		return false;
	}

	/* ☆======= Cache =======☆ */

	function readCache() {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			return raw ? JSON.parse(raw) : null;
		} catch (e) { return null; }
	}

	function writeCache(data) {
		try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
	}

	function clearCache() {
		try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
	}

	/* ☆======= State =======☆ */

	let _outdated = false;
	let _updateInfo = null;

	function applyState(info) {
		_outdated = Boolean(info && info.outdated);
		_updateInfo = _outdated ? info : null;
		if (_outdated) {
			writeCache(info);
			window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: info }));
		} else {
			window.dispatchEvent(new CustomEvent(UP_TO_DATE_EVENT));
		}
	}

	/* ☆======= Fetch + compare =======☆ */

	async function check() {
		const base = typeof getApiBase === 'function' ? getApiBase() : window.STARL_API_BASE || '';
		if (!base) return;

		let clientVersion = '0';
		try {
			const localRes = await fetch('./point.json', { cache: 'no-store' });
			if (localRes.ok) {
				const local = await localRes.json();
				clientVersion = local.version || '0';
			}
		} catch (e) {}

		let serverData = null;
		try {
			const serverRes = await fetch(base + '/point.json', { cache: 'no-store' });
			if (serverRes.ok) serverData = await serverRes.json();
		} catch (e) {}

		if (!serverData) {
			// server unreachable - restore cached outdated state if any
			const cached = readCache();
			if (cached && cached.outdated) applyState(cached);
			return;
		}

		const serverVersion = serverData.version || '0';
		const outdated = isOlderThan(clientVersion, serverVersion);

		if (outdated) {
			applyState({
				outdated: true,
				clientVersion,
				serverVersion,
				download_url: serverData.download_url || '',
				checkedAt: Date.now(),
			});
		} else {
			applyState({ outdated: false });
		}
	}

	/* ☆======= Client version header injection =======☆ */

	// patches the global fetch so all API requests carry X-Client-Version.
	// the server uses this to gate image/audio endpoints on outdated clients.

	let _clientVersion = '0';

	(function patchFetch() {
		const _origFetch = window.fetch.bind(window);
		window.fetch = function (input, init) {
			const url = typeof input === 'string' ? input : (input && input.url) || '';
			const apiBase = typeof getApiBase === 'function' ? getApiBase() : '';
			const isApiCall = apiBase && url.startsWith(apiBase);
			// don't inject on point.json fetches (avoid recursion / version loops)
			const isPointJson = url.endsWith('/point.json') || url.endsWith('point.json');
			if (isApiCall && !isPointJson && _clientVersion !== '0') {
				init = init || {};
				init.headers = Object.assign({}, init.headers || {}, { 'X-Client-Version': _clientVersion });
			}
			return _origFetch(input, init);
		};
	})();

	/* ☆======= Public API + boot =======☆ */

	window.starlUpdateCheck = {
		isOutdated() { return _outdated; },
		getUpdateInfo() { return _updateInfo; },
		check,
		clearCache() {
			clearCache();
			_outdated = false;
			_updateInfo = null;
			window.dispatchEvent(new CustomEvent(UP_TO_DATE_EVENT));
		},
	};

	// restore cached outdated state immediately (before network)
	const cached = readCache();
	if (cached && cached.outdated) applyState(cached);

	// read local version for header injection
	fetch('./point.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((d) => {
		if (d && d.version) _clientVersion = d.version;
	}).catch(() => {});

	// run check after login/auth ready
	window.addEventListener('starl-auth-ready', check);
	// also run if already authenticated when this script loads
	if (typeof getAccessToken === 'function' && getAccessToken()) {
		check();
	}
})();

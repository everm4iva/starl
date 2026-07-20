/**
 * ☆=========================================☆
 * Update check - is this app version still current?
 * On login it asks the server for the latest version and compares it to the
 * version baked into this build, then remembers the answer.
 *
 * --- What this file does? ---
 * - Fetches the local point.json and the release feed, compares versions
 * - If the build is older, marks the app "outdated" and caches that
 * - Fires 'starl-update-available' (with download_url) or 'starl-up-to-date'
 * - Patches fetch() to attach an X-Client-Version header to every API call
 * - Supports disabling update notifications permanently or for a timed snooze
 *
 * --- Dictionary / Terms / Extra details ---
 * - "point.json" = tiny file holding { version, download_url }
 * - Outdated state also lets the server gate image/audio endpoints
 * - Cached outdated state survives restarts until cleared in settings
 * ☆=========================================☆
 */

(function () {
	const CACHE_KEY = 'starl_update_state';
	const SUPPRESSION_KEY = 'starl_update_check_suppression';
	const UPDATE_EVENT = 'starl-update-available';
	const UP_TO_DATE_EVENT = 'starl-up-to-date';

	/* ☆======= Version comparison =======☆ */

	const isOlderThan = window.starlVersionCompare.isOlderThan;

	/* ☆======= Cache =======☆ */

	function readCache() {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			return raw ? JSON.parse(raw) : null;
		} catch (e) {
			return null;
		}
	}

	function writeCache(data) {
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify(data));
		} catch (e) {}
	}

	function clearCache() {
		try {
			localStorage.removeItem(CACHE_KEY);
		} catch (e) {}
	}

	function readSuppression() {
		try {
			const raw = localStorage.getItem(SUPPRESSION_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object') return null;
			const mode = String(parsed.mode || '').trim();
			if (mode === 'never') return {mode: 'never'};
			if (mode === 'snooze') {
				const until = Number(parsed.until || 0);
				if (until > Date.now()) return {mode: 'snooze', until};
				localStorage.removeItem(SUPPRESSION_KEY);
			}
		} catch (e) {}
		return null;
	}

	function writeSuppression(data) {
		try {
			if (!data) localStorage.removeItem(SUPPRESSION_KEY);
			else localStorage.setItem(SUPPRESSION_KEY, JSON.stringify(data));
		} catch (e) {}
	}

	/* ☆======= State =======☆ */

	let _outdated = false;
	let _updateInfo = null;
	let _clientVersion = '0';
	let _suppressionTimer = null;

	function normalizeBaseUrl(value) {
		return String(value || '')
			.trim()
			.replace(/\/$/, '');
	}

	function getDefaultApiBase() {
		return normalizeBaseUrl(window.STARL_API_BASE || '');
	}

	function isCustomServer() {
		const currentBase = normalizeBaseUrl(
			typeof getApiBase === 'function' ? getApiBase() : window.STARL_API_BASE || '',
		);
		const defaultBase = getDefaultApiBase();
		return Boolean(currentBase) && currentBase !== defaultBase;
	}

	function clearSuppressionTimer() {
		if (_suppressionTimer) {
			clearTimeout(_suppressionTimer);
			_suppressionTimer = null;
		}
	}

	function scheduleSuppressionTimer(state) {
		clearSuppressionTimer();
		if (!state || state.mode !== 'snooze') return;
		const delay = Number(state.until || 0) - Date.now();
		if (delay <= 0) return;
		_suppressionTimer = setTimeout(() => {
			_suppressionTimer = null;
			check();
		}, delay);
	}

	function getSuppressionState() {
		const state = readSuppression();
		scheduleSuppressionTimer(state);
		return state;
	}

	function isSuppressed() {
		return Boolean(getSuppressionState());
	}

	function setSuppressionState(mode, until) {
		if (mode === 'never') {
			const state = {mode: 'never'};
			writeSuppression(state);
			scheduleSuppressionTimer(state);
			return state;
		}
		if (mode === 'snooze') {
			const target = Number(until || 0);
			if (target > Date.now()) {
				const state = {mode: 'snooze', until: target};
				writeSuppression(state);
				scheduleSuppressionTimer(state);
				return state;
			}
		}
		clearSuppressionState();
		return null;
	}

	function clearSuppressionState() {
		writeSuppression(null);
		scheduleSuppressionTimer(null);
	}

	function applyState(info) {
		_outdated = Boolean(info && info.outdated);
		_updateInfo = _outdated ? info : null;
		if (_outdated) {
			writeCache(info);
			window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {detail: info}));
		} else {
			window.dispatchEvent(new CustomEvent(UP_TO_DATE_EVENT));
		}
	}

	/* ☆======= Fetch + compare =======☆ */

	async function check() {
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			applyState({outdated: false});
			return;
		}
		if (!isCustomServer()) {
			applyState({outdated: false});
			clearCache();
			return;
		}
		if (isSuppressed()) {
			applyState({outdated: false});
			return;
		}

		try {
			const localRes = await fetch('./point.json', {cache: 'no-store'});
			if (localRes.ok) {
				const local = await localRes.json();
				_clientVersion = local.version || '0';
			}
		} catch (e) {}

		let serverData = null;
		try {
			const serverRes = await fetch(window.STARL_INFO_URL, {cache: 'no-store'});
			if (serverRes.ok) serverData = await serverRes.json();
		} catch (e) {}

		if (!serverData) {
			applyState({outdated: false});
			clearCache();
			return;
		}

		const latestVersion =
			serverData['latest-version'] || serverData.latest_version || serverData.latestVersion || '0';
		const outdated = isOlderThan(_clientVersion, latestVersion);

		if (outdated) {
			applyState({
				outdated: true,
				clientVersion: _clientVersion,
				serverVersion: latestVersion,
				download_url: serverData.download_url || serverData.downloadUrl || '',
				checkedAt: Date.now(),
			});
		} else {
			applyState({outdated: false});
		}
	}

	/* ☆======= Client version header injection =======☆ */

	let _clientVersionHeader = '0';

	(function patchFetch() {
		const _origFetch = window.fetch.bind(window);
		window.fetch = function (input, init) {
			const url = typeof input === 'string' ? input : (input && input.url) || '';
			const apiBase = typeof getApiBase === 'function' ? getApiBase() : '';
			const isApiCall = apiBase && url.startsWith(apiBase);
			const isPointJson = url.endsWith('/point.json') || url.endsWith('point.json');
			if (isApiCall && !isPointJson && _clientVersionHeader !== '0') {
				init = init || {};
				init.headers = Object.assign({}, init.headers || {}, {'X-Client-Version': _clientVersionHeader});
			}
			return _origFetch(input, init);
		};
	})();

	/* ☆======= Public API + boot =======☆ */

	window.starlUpdateCheck = {
		isOutdated() {
			return _outdated;
		},
		getUpdateInfo() {
			return _updateInfo;
		},
		getCheckSuppression() {
			return getSuppressionState();
		},
		setCheckSuppression(mode, until) {
			return setSuppressionState(mode, until);
		},
		clearCheckSuppression() {
			clearSuppressionState();
		},
		check,
		clearCache() {
			clearCache();
			_outdated = false;
			_updateInfo = null;
			window.dispatchEvent(new CustomEvent(UP_TO_DATE_EVENT));
		},
	};

	fetch('./point.json', {cache: 'no-store'})
		.then((r) => (r.ok ? r.json() : null))
		.then((d) => {
			if (d && d.version) {
				_clientVersion = d.version;
				_clientVersionHeader = d.version;
			}
			const cached = readCache();
			if ((typeof navigator !== 'undefined' && navigator.onLine === false) || !isCustomServer()) {
				if (cached && cached.outdated) clearCache();
				return;
			}
			if (isSuppressed()) {
				return;
			}
			if (cached && cached.outdated && cached.clientVersion === _clientVersion) {
				applyState(cached);
			} else if (cached && cached.outdated) {
				clearCache();
			}
		})
		.catch(() => {});

	window.addEventListener('starl-auth-ready', check);
	if (typeof getAccessToken === 'function' && getAccessToken()) {
		check();
	}

	window.addEventListener('offline', () => applyState({outdated: false}));
	window.addEventListener('online', check);
})();

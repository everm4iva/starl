/**
 * ☆=========================================☆
 * Account state - device-server state sync
 * Keeps one canonical user state in sync between the device and the server.
 * Stores sections like history, follows, playlists, and search history.
 *
 * --- What this file does? ---
 * - refreshFromServer(): fetches the latest state and merges it locally
 * - setSection() / getSection(): read and write named sections of state
 * - Detects when a different account logs in and clears stale cached state
 * - Fires 'starl-account-state-updated' whenever state changes
 * - Fires 'starl-server-connection-state' to report if the server is reachable
 * - Runs a reconnect loop to retry when offline
 *
 * --- Dictionary / Terms / Extra details ---
 * - "section" = a named part of state (ex: 'listeningHistory', 'playlists')
 * - Server wins when it has data; local cache is used as fallback and migration source
 * ☆=========================================☆
 */

(function () {
	const STORAGE_KEY = 'starl_account_state';
	const LEGACY_HISTORY_KEY = 'starl_listening_history';
	const UPDATE_EVENT = 'starl-account-state-updated';
	const SERVER_STATE_EVENT = 'starl-server-connection-state';
	const API_ROOT = '/account/state';
	const RECONNECT_INTERVAL_MS = 60 * 1000;
	const QUICK_RETRY_DELAY_MS = 5 * 1000;
	let stateCache = loadCachedState();
	let stateOwnerId = loadCachedOwnerId();
	let refreshPromise = null;
	let reconnectTimerId = null;
	let quickRetryTimerId = null;
	let serverReachable = false;

	/* ☆======= Local helpers (shadow globals for IIFE scope) =======☆ */

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

	/* ☆======= State cache =======☆ */

	function loadCachedState() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					if (parsed.state && typeof parsed.state === 'object' && !Array.isArray(parsed.state)) {
						return parsed.state;
					}
					return parsed;
				}
			}
		} catch (error) {}

		try {
			const legacyHistory = localStorage.getItem(LEGACY_HISTORY_KEY);
			if (legacyHistory) {
				const parsed = JSON.parse(legacyHistory);
				if (Array.isArray(parsed) && parsed.length) {
					return {listeningHistory: parsed};
				}
			}
		} catch (error) {}

		return {};
	}

	function loadCachedOwnerId() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return '';
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return String(parsed.ownerId || '').trim();
			}
		} catch (error) {}
		return '';
	}

	function persistCachedState() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ownerId: stateOwnerId || '', state: stateCache}));
		} catch (error) {}
	}

	function emitUpdate() {
		try {
			window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {detail: {state: getState()}}));
		} catch (error) {}
	}

	/* ☆======= Server sync =======☆ */

	function emitServerState(online) {
		try {
			window.dispatchEvent(new CustomEvent(SERVER_STATE_EVENT, {detail: {online: Boolean(online)}}));
		} catch (error) {}
	}

	function setServerReachable(nextValue) {
		const normalized = Boolean(nextValue);
		if (normalized === serverReachable) {
			return;
		}
		serverReachable = normalized;
		if (serverReachable && quickRetryTimerId) {
			clearTimeout(quickRetryTimerId);
			quickRetryTimerId = null;
		}
		emitServerState(serverReachable);
	}

	function scheduleQuickRetry() {
		if (quickRetryTimerId || serverReachable) {
			return;
		}
		quickRetryTimerId = setTimeout(() => {
			quickRetryTimerId = null;
			if (!getAccessToken() || !navigator.onLine || serverReachable) {
				return;
			}
			refreshFromServer();
		}, QUICK_RETRY_DELAY_MS);
	}

	function notifyServerFailure() {
		setServerReachable(false);
		scheduleQuickRetry();
	}

	function getState() {
		return stateCache && typeof stateCache === 'object' ? stateCache : {};
	}

	function setState(nextState) {
		stateCache = nextState && typeof nextState === 'object' && !Array.isArray(nextState) ? nextState : {};
		persistCachedState();
		emitUpdate();
	}

	function setStateOwner(nextOwnerId) {
		const normalized = String(nextOwnerId || '').trim();
		if (normalized === stateOwnerId) {
			return;
		}
		stateOwnerId = normalized;
		persistCachedState();
	}

	function getSection(sectionName, fallbackValue) {
		const currentState = getState();
		if (Object.prototype.hasOwnProperty.call(currentState, sectionName)) {
			return currentState[sectionName];
		}
		return fallbackValue;
	}

	async function writeStateToServer(nextState, replace) {
		const token = getAccessToken();
		if (!token) {
			return null;
		}
		const response = await fetch(getApiBase() + API_ROOT, {
			method: 'PUT',
			headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
			body: JSON.stringify({state: nextState, replace: Boolean(replace)}),
		});
		if (!response.ok) {
			return null;
		}
		return response.json().catch(() => null);
	}

	async function refreshFromServer() {
		if (refreshPromise) {
			return refreshPromise;
		}
		const token = getAccessToken();
		if (!token) {
			emitUpdate();
			return getState();
		}

		refreshPromise = (async () => {
			try {
				const response = await fetch(getApiBase() + API_ROOT, {headers: {'Authorization': 'Bearer ' + token}});
				if (!response.ok) {
					notifyServerFailure();
					return getState();
				}
				setServerReachable(true);
				const payload = await response.json();
				const serverUserId = String(payload && payload.user && payload.user.id ? payload.user.id : '').trim();
				const previousOwnerId = stateOwnerId;
				const serverState =
					payload && payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
						? payload.state
						: {};

				if (serverUserId && previousOwnerId && previousOwnerId !== serverUserId) {
					// different account: never reuse cached state from the previous user.
					stateCache = {};
				}

				if (serverUserId) {
					stateOwnerId = serverUserId;
				}

				if (
					Object.keys(serverState).length === 0 &&
					Object.keys(getState()).length > 0 &&
					previousOwnerId &&
					previousOwnerId === serverUserId
				) {
					const saved = await writeStateToServer(getState(), true);
					if (saved && saved.state && typeof saved.state === 'object') {
						setState(saved.state);
						setStateOwner(serverUserId || stateOwnerId);
						return getState();
					}
				}

				setState(serverState);
				setStateOwner(serverUserId || stateOwnerId);
				return getState();
			} catch (error) {
				notifyServerFailure();
				return getState();
			} finally {
				refreshPromise = null;
			}
		})();

		return refreshPromise;
	}

	async function setSection(sectionName, value, options) {
		try {
			await refreshFromServer();
		} catch (error) {}

		const currentState = getState();
		const nextState = options && options.replace ? {[sectionName]: value} : {...currentState, [sectionName]: value};
		setState(nextState);
		try {
			const saved = await writeStateToServer(nextState, true);
			if (saved && saved.state && typeof saved.state === 'object') {
				setState(saved.state);
			}
		} catch (error) {}
		return getState();
	}

	function clearLocalCache() {
		stateCache = {};
		stateOwnerId = '';
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch (error) {}
		emitUpdate();
	}

	function getOwnerId() {
		return String(stateOwnerId || '').trim();
	}

	function startReconnectLoop() {
		if (reconnectTimerId) {
			return;
		}
		reconnectTimerId = setInterval(() => {
			if (!getAccessToken() || !navigator.onLine || serverReachable) {
				return;
			}
			refreshFromServer();
		}, RECONNECT_INTERVAL_MS);
	}

	/* ☆======= Public API + boot =======☆ */

	window.starlAccountState = {
		getState,
		getSection,
		setState,
		setSection,
		refreshFromServer,
		notifyServerFailure,
		clearLocalCache,
		getOwnerId,
	};

	window.addEventListener('online', () => {
		refreshFromServer();
	});

	window.addEventListener('offline', () => {
		notifyServerFailure();
	});

	if (document.readyState === 'loading') {
		document.addEventListener(
			'DOMContentLoaded',
			() => {
				refreshFromServer();
			},
			{once: true},
		);
	} else {
		refreshFromServer();
	}

	startReconnectLoop();
})();

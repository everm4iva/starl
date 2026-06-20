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
	const CACHE_SNAPSHOT_KEY = 'starl_cache_snapshot';
	const LEGACY_HISTORY_KEY = 'starl_listening_history';
	const PENDING_WRITES_KEY = 'starl_account_state_pending';
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
	// sections whose last setSection() write never reached the server (offline/error) -
	// {[sectionName]: value}. re-applied on top of every refreshFromServer() response so a
	// stale server copy can't resurrect something the user already removed locally, and
	// retried whenever connectivity returns.
	let pendingWrites = loadPendingWrites();
	let flushInFlight = null;

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

		// fall back to the cache snapshot - saved during normal sessions,
		// survives logout so cache mode can still show library data
		try {
			const raw = localStorage.getItem(CACHE_SNAPSHOT_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === 'object' && parsed.state && typeof parsed.state === 'object') {
					return parsed.state;
				}
			}
		} catch (error) {}

		return {};
	}

	function loadCachedOwnerId() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					const id = String(parsed.ownerId || '').trim();
					if (id) return id;
				}
			}
		} catch (error) {}
		try {
			const raw = localStorage.getItem(CACHE_SNAPSHOT_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === 'object') {
					return String(parsed.ownerId || '').trim();
				}
			}
		} catch (error) {}
		return '';
	}

	function persistCachedState() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ownerId: stateOwnerId || '', state: stateCache}));
		} catch (error) {}
		// keep a snapshot that survives logout so cache mode can restore the library
		try {
			if (stateCache && Object.keys(stateCache).length > 0) {
				localStorage.setItem(CACHE_SNAPSHOT_KEY, JSON.stringify({ownerId: stateOwnerId || '', state: stateCache}));
			}
		} catch (error) {}
	}

	/* ☆======= Pending writes (offline retry queue) =======☆ */

	function loadPendingWrites() {
		try {
			const raw = localStorage.getItem(PENDING_WRITES_KEY);
			if (!raw) return {};
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
		} catch (error) {
			return {};
		}
	}

	function persistPendingWrites() {
		try {
			if (Object.keys(pendingWrites).length > 0) {
				localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(pendingWrites));
			} else {
				localStorage.removeItem(PENDING_WRITES_KEY);
			}
		} catch (error) {}
	}

	function queuePendingWrite(sectionName, value) {
		pendingWrites = {...pendingWrites, [sectionName]: value};
		persistPendingWrites();
	}

	function clearPendingWrite(sectionName, value) {
		// only clear if nothing queued a newer value for this section while the write was executing
		if (!(sectionName in pendingWrites)) return;
		if (JSON.stringify(pendingWrites[sectionName]) !== JSON.stringify(value)) return;
		const next = {...pendingWrites};
		delete next[sectionName];
		pendingWrites = next;
		persistPendingWrites();
	}

	// re-applies any unsent local writes on top of a freshly fetched server state, so a
	// stale server copy can never resurrect something removed/changed locally but not
	// yet flushed (ex: unfollowing an artist while offline).
	function applyPendingWrites(serverState) {
		const keys = Object.keys(pendingWrites);
		if (!keys.length) return serverState;
		const merged = {...serverState};
		keys.forEach((key) => { merged[key] = pendingWrites[key]; });
		return merged;
	}

	async function flushPendingWrites() {
		if (flushInFlight) return flushInFlight;
		flushInFlight = (async () => {
			for (const sectionName of Object.keys(pendingWrites)) {
				const value = pendingWrites[sectionName];
				try {
					const saved = await writeStateToServer({...getState(), [sectionName]: value}, false);
					clearPendingWrite(sectionName, value);
					if (saved && saved.state && typeof saved.state === 'object') {
						setState(applyPendingWrites({...saved.state, [sectionName]: value}));
					}
				} catch (error) {
					// stop on first failure (still offline/unreachable) - remaining entries
					// stay queued and will be retried on the next flush
					break;
				}
			}
		})();
		try {
			await flushInFlight;
		} finally {
			flushInFlight = null;
		}
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

	// returns null when there is genuinely nothing to send (cache mode / not logged in) -
	// the write should be treated as a no-op, not queued for retry. throws on anything
	// that's actually a failed attempt (network error, bad response, auth failure) so
	// callers can tell "skipped" apart from "should retry".
	async function writeStateToServer(nextState, replace) {
		const _auth = window.starlAuth;
		if (_auth && typeof _auth.isCacheMode === 'function' && _auth.isCacheMode()) {
			return null;
		}
		const token = getAccessToken();
		if (!token) {
			return null;
		}
		const response = await fetch(getApiBase() + API_ROOT, {
			method: 'PUT',
			headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
			body: JSON.stringify({state: nextState, replace: Boolean(replace)}),
		});
		const _authW = window.starlAuth;
		if (_authW && typeof _authW.handleAuthFailure === 'function' && _authW.handleAuthFailure(response)) {
			// auth is broken (expired/revoked token) rather than multi connectivity -
			// retrying won't help until the user re-authenticates, so don't queue this.
			return null;
		}
		if (!response.ok) {
			throw new Error('writeStateToServer failed: ' + response.status);
		}
		return response.json().catch(() => null);
	}

	async function refreshFromServer() {
		if (refreshPromise) {
			return refreshPromise;
		}
		const _auth = window.starlAuth;
		if (_auth && typeof _auth.isCacheMode === 'function' && _auth.isCacheMode()) {
			emitUpdate();
			return getState();
		}
		const token = getAccessToken();
		if (!token) {
			emitUpdate();
			return getState();
		}

		refreshPromise = (async () => {
			try {
				const response = await fetch(getApiBase() + API_ROOT, {headers: {'Authorization': 'Bearer ' + token}});
				const _authR = window.starlAuth;
				if (_authR && typeof _authR.handleAuthFailure === 'function' && _authR.handleAuthFailure(response)) {
					return getState();
				}
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
						setState(applyPendingWrites(saved.state));
						setStateOwner(serverUserId || stateOwnerId);
						return getState();
					}
				}

				// re-apply any local writes that never reached the server (offline/error)
				// before adopting the server's copy, then retry sending them.
				setState(applyPendingWrites(serverState));
				setStateOwner(serverUserId || stateOwnerId);
				if (Object.keys(pendingWrites).length > 0) {
					flushPendingWrites();
				}
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
		if (!(options && options.skipRefresh)) {
			try {
				await refreshFromServer();
			} catch (error) {}
		}

		const replaceLocal = Boolean(options && options.replace);
		const currentState = getState();
		const nextState = replaceLocal ? {[sectionName]: value} : {...currentState, [sectionName]: value};
		setState(nextState);
		// queue before attempting the write so a dropped connection mid-request still
		// leaves the change recoverable - cleared below on success, otherwise picked up
		// by the next refreshFromServer()/reconnect flush.
		if (!replaceLocal) queuePendingWrite(sectionName, value);
		try {
			// only a true full-state replace (ex: restoring local cache onto an empty
			// server record) should tell the server to wipe other sections - a normal
			// section write must merge so it can never delete sections (ex: playlists)
			// this client hasn't loaded into stateCache yet (skipRefresh / boot races).
			const saved = await writeStateToServer(nextState, replaceLocal);
			if (!replaceLocal) clearPendingWrite(sectionName, value);
			if (saved && saved.state && typeof saved.state === 'object') {
				setState(applyPendingWrites({...saved.state, [sectionName]: value}));
			}
		} catch (error) {}
		return getState();
	}

	function clearLocalCache() {
		stateCache = {};
		stateOwnerId = '';
		pendingWrites = {};
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch (error) {}
		try {
			localStorage.removeItem(PENDING_WRITES_KEY);
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

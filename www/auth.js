(() => {
	const TOKEN_KEY = 'starl_access_token';
	const REFRESH_TOKEN_KEY = 'starl_refresh_token';
	const CACHE_MODE_KEY = 'starl_cache_mode';
	const LOGIN_PAGE = 'login.html';
	const RETURN_URL = 'starl://auth';
	window.STARL_API_BASE = 'https://your-server-url-here';

	function getApiBase() {
		if (typeof window.STARL_API_BASE === 'string' && window.STARL_API_BASE.trim()) {
			return window.STARL_API_BASE.trim().replace(/\/$/, '');
		}
		return window.STARL_API_BASE;
	}

	function getAccessToken() {
		return localStorage.getItem(TOKEN_KEY);
	}

	function getRefreshToken() {
		return localStorage.getItem(REFRESH_TOKEN_KEY);
	}

	function clearAccessToken() {
		localStorage.removeItem(TOKEN_KEY);
		localStorage.removeItem(REFRESH_TOKEN_KEY);
	}

	function getTokenExpiry(token) {
		try {
			const parts = token.split('.');
			if (parts.length !== 3) return null;
			const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
			return payload.exp ? payload.exp * 1000 : null;
		} catch (e) {
			return null;
		}
	}

	function isTokenExpiredOrExpiringSoon(token, bufferMs) {
		const exp = getTokenExpiry(token);
		if (!exp) return false;
		return Date.now() >= exp - (bufferMs || 0);
	}

	async function tryRefreshToken() {
		const refreshToken = getRefreshToken();
		const apiBase = getApiBase();
		if (!refreshToken || !apiBase) return false;
		try {
			const res = await fetch(apiBase + '/auth/refresh', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({refresh_token: refreshToken}),
			});
			if (!res.ok) return false;
			const data = await res.json();
			if (data.access_token) {
				localStorage.setItem(TOKEN_KEY, data.access_token);
				if (data.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
				return true;
			}
			return false;
		} catch (e) {
			return false;
		}
	}

	let _refreshTimer = null;
	function scheduleTokenRefresh(token) {
		if (_refreshTimer) clearTimeout(_refreshTimer);
		const exp = getTokenExpiry(token);
		if (!exp) return;
		// refresh 5 minutes before expiry
		const delay = exp - Date.now() - 5 * 60 * 1000;
		if (delay <= 0) return;
		_refreshTimer = setTimeout(async () => {
			const refreshed = await tryRefreshToken();
			if (refreshed) {
				const newToken = getAccessToken();
				if (newToken) scheduleTokenRefresh(newToken);
			}
		}, delay);
	}

	function isCacheMode() {
		return localStorage.getItem(CACHE_MODE_KEY) === '1';
	}

	function enterCacheMode() {
		localStorage.setItem(CACHE_MODE_KEY, '1');
	}

	function exitCacheMode() {
		localStorage.removeItem(CACHE_MODE_KEY);
	}

	function getLoginUrl() {
		return getApiBase() + '/login';
	}

	function getReturnUrl() {
		return RETURN_URL;
	}

	function isLoginPage() {
		return /login\.html$/i.test(window.location.pathname);
	}

	function redirectToLogin() {
		if (isCacheMode()) return;
		if (!isLoginPage()) {
			window.location.replace(LOGIN_PAGE);
		}
	}

	async function validateToken(token) {
		if (!token) {
			return false;
		}
		try {
			const response = await fetch(getApiBase() + '/auth/login', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({access_token: token}),
			});
			if (response.status === 401) {
				return false;
			}
			return response.ok;
		} catch (error) {
			return true;
		}
	}

	async function ensureAuth() {
		if (isCacheMode()) {
			return 'cache';
		}
		const token = getAccessToken();
		if (!token) {
			redirectToLogin();
			return null;
		}
		// if the token is locally expired or expiring soon, try to refresh silently first
		if (isTokenExpiredOrExpiringSoon(token, 60 * 1000)) {
			const refreshed = await tryRefreshToken();
			if (refreshed) {
				const newToken = getAccessToken();
				if (newToken) scheduleTokenRefresh(newToken);
				return newToken;
			}
			// refresh failed - if offline, keep going with the expired token so
			// cached content stays accessible. If online, the token is truly dead.
			if (!navigator.onLine) {
				return token;
			}
			clearAccessToken();
			redirectToLogin();
			return null;
		}
		// token looks valid locally; schedule refresh and skip the server round-trip
		scheduleTokenRefresh(token);
		return token;
	}

	let _handlingAuthFailure = false;
	function handleAuthFailure(response) {
		if (isCacheMode()) return false;
		if (response && response.status === 401) {
			if (_handlingAuthFailure) return true;
			_handlingAuthFailure = true;
			tryRefreshToken().then((refreshed) => {
				_handlingAuthFailure = false;
				if (!refreshed) {
					clearAccessToken();
					redirectToLogin();
				} else {
					const newToken = getAccessToken();
					if (newToken) scheduleTokenRefresh(newToken);
				}
			});
			return true;
		}
		return false;
	}

	async function finalizeLoginFromUrl(url) {
		const parsed = String(url || '');
		const tokenMatch = parsed.match(/access_token=([^&#]+)/i);
		if (!tokenMatch) {
			return false;
		}
		const token = decodeURIComponent(tokenMatch[1]);
		if (!token) {
			return false;
		}
		localStorage.setItem(TOKEN_KEY, token);
		const refreshMatch = parsed.match(/refresh_token=([^&#]+)/i);
		if (refreshMatch) localStorage.setItem(REFRESH_TOKEN_KEY, decodeURIComponent(refreshMatch[1]));
		scheduleTokenRefresh(token);
		try {
			const response = await fetch(getApiBase() + '/auth/login', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({access_token: token}),
			});
			if (!response.ok) {
				clearAccessToken();
				return false;
			}
			if (window.starlAccountState && typeof window.starlAccountState.refreshFromServer === 'function') {
				await window.starlAccountState.refreshFromServer();
			}
		} catch (error) {
			clearAccessToken();
			return false;
		}
		exitCacheMode();
		if (isLoginPage()) {
			window.location.replace('index.html');
		}
		return true;
	}

	window.handleOpenURL = function (url) {
		// console.log('[starl] handleOpenURL called with:', url);
		try {
			localStorage.setItem('starl_last_deeplink', String(url));
		} catch (e) {}
		// handleOpenURL can fire before deviceready and before app JS is initialized.
		// wait for deviceready so starlAccountState and other globals are ready before
		// processing the token - otherwise the account-state update fires into an
		// uninitialized UI and crashes the app.
		function runFinalize() {
			finalizeLoginFromUrl(url)
				.then((ok) => console.log('[starl] finalizeLoginFromUrl ok=', ok))
				.catch((err) => console.error('[starl] finalizeLoginFromUrl err=', err));
		}
		// if the app was already running (returning from external browser auth),
		// deviceready already fired and will never fire again - run immediately.
		// if deviceready hasn't fired yet (cold start via deep link), wait for it.
		// fall back after 3s in browser/test environments where deviceready never fires.
		let fired = false;
		if (window._starlDeviceReady) {
			fired = true;
			runFinalize();
			return;
		}
		const fallback = setTimeout(() => {
			if (!fired) {
				fired = true;
				runFinalize();
			}
		}, 3000);
		document.addEventListener(
			'deviceready',
			() => {
				if (!fired) {
					fired = true;
					clearTimeout(fallback);
					runFinalize();
				}
			},
			{once: true},
		);
	};

	window.starlAuth = {
		TOKEN_KEY,
		getApiBase,
		getAccessToken,
		clearAccessToken,
		getLoginUrl,
		getReturnUrl,
		validateToken,
		ensureAuth,
		handleAuthFailure,
		redirectToLogin,
		finalizeLoginFromUrl,
		isLoginPage,
		isTokenExpiredOrExpiringSoon,
		tryRefreshToken,
		scheduleTokenRefresh,
		isCacheMode,
		enterCacheMode,
		exitCacheMode,
	};
})();

// on page load, also check if the current URL contains an access_token (query or hash)
(function _starl_deeplink_check_onload() {
	try {
		const href = window.location.href || '';
		if (href.match(/access_token=/i)) {
			// console.log('[starl] detected access_token in href on load:', href);
			window.starlAuth.finalizeLoginFromUrl(href).then((ok) => console.log('[starl] finalize from href ok=', ok));
		}
	} catch (e) {
		console.error('[starl] deeplink onload check error', e);
	}
})();

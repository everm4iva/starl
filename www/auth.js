(() => {
	const TOKEN_KEY = 'starl_access_token';
	const REFRESH_TOKEN_KEY = 'starl_refresh_token';
	const LOGIN_PAGE = 'login.html';
	const RETURN_URL = 'starl://auth';
	window.STARL_API_BASE='https://your-server-url-here';

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
		// Refresh 5 minutes before expiry
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
		if (!isLoginPage()) {
			window.location.href = LOGIN_PAGE;
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
		const token = getAccessToken();
		if (!token) {
			redirectToLogin();
			return null;
		}
		const ok = await validateToken(token);
		if (!ok) {
			clearAccessToken();
			redirectToLogin();
			return null;
		}
		return token;
	}

	let _handlingAuthFailure = false;
	function handleAuthFailure(response) {
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
		setTimeout(() => {
			finalizeLoginFromUrl(url)
				.then(ok => console.log('[starl] finalizeLoginFromUrl ok=', ok))
				.catch(err => console.error('[starl] finalizeLoginFromUrl err=', err));
		}, 0);
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
	};
})();

	// On page load, also check if the current URL contains an access_token (query or hash)
	(function _starl_deeplink_check_onload() {
		try {
			const href = window.location.href || '';
			if (href.match(/access_token=/i)) {
				// console.log('[starl] detected access_token in href on load:', href);
				// attempt to finalize login using the URL
				window.starlAuth.finalizeLoginFromUrl(href).then(ok => console.log('[starl] finalize from href ok=', ok));
			}
		} catch (e) {
			console.error('[starl] deeplink onload check error', e);
		}
	})();
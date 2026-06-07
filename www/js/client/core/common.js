/**
 * ☆=========================================☆
 * Common - shared core toolbox for the whole app
 * The small shared toolbox every other file leans on. Keeps the storage keys,
 * the API base URL, and the access token in one calm place.
 * --- What this file does? ---
 * - Holds the localStorage key names (token, player state, repeat state)
 * - getApiBase(): tells you which server URL to talk to
 * - getAccessToken(): hands back the saved login token
 * --- Dictionary / Terms / Extra details ---
 * - "API base" = the root server address all requests are sent to
 * - It asks window.starlAuth first, then falls back to a stored value
 * ☆=========================================☆
 */
(function () {
	const shared = window.starlShared || {};

	Object.defineProperty(shared, 'links', {
		get() {
			return {apiBaseFallback: window.STARL_API_BASE};
		},
		configurable: true,
	});

    // don't change, this is default value
	shared.keys = {
		accessToken: 'starl_access_token',
		playerState: 'starl_player_state',
		repeatState: 'starl_player_repeat',
	};

	window.starlShared = shared;

	window.getApiBase = function getApiBase() {
		const auth = window.starlAuth;
		if (auth && typeof auth.getApiBase === 'function') {
			return auth.getApiBase();
		}
		if (typeof window.STARL_API_BASE === 'string' && window.STARL_API_BASE.trim()) {
			return window.STARL_API_BASE.trim().replace(/\/$/, '');
		}
		return shared.links.apiBaseFallback;
	};

	window.getAccessToken = function getAccessToken() {
		const auth = window.starlAuth;
		if (auth && typeof auth.getAccessToken === 'function') {
			return auth.getAccessToken();
		}
		return localStorage.getItem(shared.keys.accessToken);
	};
})();


/*
Client core helpers
-> this is the small shared toolbox for the whole app.
-> it keeps the common keys, shared links, and base API helpers in one calm place.
-> when another file needs the token or the API base, it asks this module first.
*/

(function () {
	const shared = window.starlShared || {};

	shared.links = {
		apiBaseFallback: window.STARL_API_BASE,
	};

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

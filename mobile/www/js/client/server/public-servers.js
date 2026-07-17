/**
 * ☆=========================================☆
 * Public servers - the list everyone can pick from
 * Fetches window.STARL_INFO_URL (a little info.json hosted outside the app) and turns its
 * "public-servers" block into a plain list the login screen can show you: name, address,
 * online/offline, and whether its version is behind yours.
 *
 * --- What this file does? ---
 * - fetch(): grabs info.json fresh, falls back to the last good copy if the network fails
 * - normalizeUrl(): the info.json urls are bare hosts, this makes them a proper https url
 * - each server also gets an "outdated" flag by comparing it to this build's own version
 *   (read from point.json), using the shared version-compare helper
 *
 * --- Dictionary / Terms / Extra details ---
 * - "habilities" = what a server can do (service / routes / share / storage), just shown as-is
 * - a server missing entirely, or with a broken info.json, just means an empty list
 * ☆=========================================☆
 */

(function () {
	var FETCH_TIMEOUT_MS = 6000;
	var _cached = null;
	var _clientVersion = null;

	// bare host like "example.tail.net/" -> "https://example.tail.net", scheme kept if it's already there
	function normalizeUrl(raw) {
		var host = String(raw || '').trim().replace(/\/+$/, '');
		if (!host) return '';
		if (!/^https?:\/\//i.test(host)) host = 'https://' + host;
		return host;
	}

	async function loadClientVersion() {
		if (_clientVersion !== null) return _clientVersion;
		try {
			var res = await fetch('./point.json', {cache: 'no-store'});
			var data = res.ok ? await res.json() : null;
			_clientVersion = (data && data.version) || '0';
		} catch (e) {
			_clientVersion = '0';
		}
		return _clientVersion;
	}

	async function fetchList() {
		var clientVersion = await loadClientVersion();
		var controller = new AbortController();
		var timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
		try {
			var res = await fetch(window.STARL_INFO_URL, {cache: 'no-store', signal: controller.signal});
			clearTimeout(timer);
			if (!res.ok) return _cached || [];
			var info = await res.json();
			var raw = (info && info['public-servers']) || {};
			var list = Object.keys(raw).map(function (key) {
				var s = raw[key] || {};
				return {
					id: key,
					name: s['server-name'] || 'server',
					url: normalizeUrl(s.url),
					status: s.status || 'offline',
					version: s.version || '0',
					habilities: Array.isArray(s.habilities) ? s.habilities : [],
					clientVersion: clientVersion,
					outdated: window.starlVersionCompare.isOlderThan(s.version, clientVersion),
				};
			});
			_cached = list;
			return list;
		} catch (e) {
			clearTimeout(timer);
			return _cached || [];
		}
	}

	window.starlPublicServers = {
		fetch: fetchList,
	};
})();

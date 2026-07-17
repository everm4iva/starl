/**
 * ☆=========================================☆
 * Server connections - the little book of servers you saved
 * Keeps the list of self-hosted servers you added (in localStorage), and knows how to
 * ping one, peek at its details, and actually connect (log in + point the app at it).
 *
 * --- What this file does? ---
 * - list / get / save / remove / duplicate: plain CRUD over the saved connections
 * - buildUrl(): turns host + optional port + protocol into one base url
 * - ping(): times a quick /health hit, tells you active / offline / error <code>
 * - fetchMeta(): grabs /status.json + /auth/mode for the "see details" popup
 * - connect(): logs in with the right creds (+ client name), stores the token, aims the app
 *
 * --- Dictionary / Terms / Extra details ---
 * - "connection" = one saved server: name, host, port, auth method and its creds
 * - creds live here too so you dont retype them, its all on-device localStorage
 * ☆=========================================☆
 */

(function () {
	var STORAGE_KEY = 'starl_connections';
	var PING_TIMEOUT_MS = 6000;

	/* ☆======= tiny helpers =======☆ */

	// a quick unique id, uses the real thing when we can, falls back to a cheap one otherwise
	function newId() {
		if (window.crypto && typeof window.crypto.randomUUID === 'function') {
			return window.crypto.randomUUID();
		}
		return 'c' + Date.now() + Math.random().toString(16).slice(2, 8);
	}

	// read the whole list, always an array even if storage is empty or somehow broken
	function readAll() {
		try {
			var raw = localStorage.getItem(STORAGE_KEY);
			var arr = raw ? JSON.parse(raw) : [];
			return Array.isArray(arr) ? arr : [];
		} catch (e) {
			return [];
		}
	}

	function writeAll(list) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(list || []));
	}

	// an ip or localhost gets plain http, a real domain gets https, thats the sensible default
	function guessProtocol(host) {
		var h = String(host || '').trim();
		if (/^https?:\/\//i.test(h)) return h.slice(0, h.indexOf(':')).toLowerCase();
		if (/^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.)/.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return 'http';
		return 'https';
	}

	// host (maybe with a scheme) + optional port -> one clean base url the app can talk to
	function buildUrl(conn) {
		var host = String(conn.host || '').trim().replace(/\/$/, '');
		host = host.replace(/^https?:\/\//i, '');
		var protocol = conn.protocol || guessProtocol(conn.host);
		var url = protocol + '://' + host;
		if (conn.port) url += ':' + conn.port;
		return url;
	}

	/* ☆======= CRUD =======☆ */

	function list() {
		return readAll();
	}

	function get(id) {
		return readAll().find(function (c) { return c.id === id; }) || null;
	}

	// add a new one or update an existing one (same id), returns the saved connection
	function save(conn) {
		var list = readAll();
		var item = Object.assign({}, conn);
		if (!item.id) item.id = newId();
		item.url = buildUrl(item);

		var idx = list.findIndex(function (c) { return c.id === item.id; });
		if (idx >= 0) list[idx] = item; else list.push(item);
		writeAll(list);
		return item;
	}

	function remove(id) {
		writeAll(readAll().filter(function (c) { return c.id !== id; }));
	}

	// copy a connection into a fresh one, same details, new id + a "(copy)" on the name
	function duplicate(id) {
		var src = get(id);
		if (!src) return null;
		var copy = Object.assign({}, src);
		delete copy.id;
		copy.name = (src.name || 'server') + ' (copy)';
		return save(copy);
	}

	/* ☆======= ping + details =======☆ */

	// one quick timed hit on /health, so we can show active / offline / error right on the button
	async function ping(conn) {
		var url = buildUrl(conn);
		var controller = new AbortController();
		var timer = setTimeout(function () { controller.abort(); }, PING_TIMEOUT_MS);
		var started = performance.now();
		try {
			var res = await fetch(url + '/health', { signal: controller.signal });
			var latency = Math.round(performance.now() - started);
			clearTimeout(timer);
			if (res.ok) return { state: 'active', code: res.status, latency: latency };
			return { state: 'error', code: res.status, latency: latency };
		} catch (e) {
			clearTimeout(timer);
			return { state: 'offline', code: 0, latency: 0 };
		}
	}

	// pull the stuff the details popup wants: name, version, min version, and the auth method
	// its all in one /info call on the api port (the pretty /status.json is on the page port)
	async function fetchMeta(conn) {
		var url = buildUrl(conn);
		// ok stays false unless we actually heard back, so a failed detect never gets
		// confused for a real "this server uses: none" answer
		var meta = { ok: false, name: conn.name || '', version: '', minVersion: '', authMethod: conn.authMethod || '' };
		var controller = new AbortController();
		var timer = setTimeout(function () { controller.abort(); }, PING_TIMEOUT_MS);
		try {
			var s = await (await fetch(url + '/info', { signal: controller.signal })).json();
			meta.ok = true;
			meta.name = s.name || meta.name;
			meta.version = s.version || '';
			meta.minVersion = s.min_version || '';
			meta.authMethod = (s.auth && s.auth.mode) || 'none';
		} catch (e) {
		} finally {
			clearTimeout(timer);
		}
		return meta;
	}

	/* ☆======= connect =======☆ */

	// da real deal: log in with whatever this server wants, keep the token, aim the app here
	// returns { ok: true } on success, or { ok: false, error: "..." } so the ui can say why
	async function connect(conn) {
		var url = buildUrl(conn);
		var body = { client_name: conn.clientName || '' };
		var method = conn.authMethod || 'userpass';

		if (method === 'pin') body.pin = conn.pin || '';
		else if (method === 'password') body.password = conn.password || '';
		else if (method === 'userpass') { body.username = conn.username || ''; body.password = conn.password || ''; }

		try {
			var res = await fetch(url + '/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			var data = await res.json().catch(function () { return {}; });
			if (!res.ok || !data.access_token) {
				return { ok: false, error: data.detail || ('login failed (' + res.status + ')') };
			}
			localStorage.setItem('starl_access_token', data.access_token);
			if (data.refresh_token) localStorage.setItem('starl_refresh_token', data.refresh_token);
			window.starlAuth.setActiveServer(url);
			window.starlAuth.exitCacheMode();
			return { ok: true };
		} catch (e) {
			return { ok: false, error: 'couldnt reach the server' };
		}
	}

	/* ☆======= public API =======☆ */

	window.starlConnections = {
		list: list,
		get: get,
		save: save,
		remove: remove,
		duplicate: duplicate,
		buildUrl: buildUrl,
		guessProtocol: guessProtocol,
		ping: ping,
		fetchMeta: fetchMeta,
		connect: connect,
	};
})();

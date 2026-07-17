/*
 * ☆ Version gate
 * -> rejects clients older than limits.min_version (config.yaml) with a 426, so an outdated
 *    app is told to update instead of hitting changed endpoints.
 *
 * -> runs BEFORE cors middleware (outermost - new words!), so it echoes CORS headers itself on the
 *    early 426 - otherwise the browser reports a misleading "no CORS header" error.
 */

import {MIN_VERSION} from '../config.js';
import {corsHeadersFor} from './cors.js';

// public/auth paths allowed regardless of client version, plus the "/account" prefix.
const EXEMPT = new Set([
	'/',
	'/health',
	'/test',
	'/login',
	'/info',
	'/auth/mode',
	'/auth/register',
	'/auth/login',
	'/auth/logout',
	'/auth/refresh',
	'/auth/me',
]);

function parseVersion(v) {
	return String(v || '0')
		.split('.')
		.filter((p) => /^\d+$/.test(p))
		.map(Number);
}

// the oldest client we let in, parsed once at boot since config.yaml is read at startup anyway
const MINIMUM = parseVersion(MIN_VERSION);

// tuple compare: returns negative if a < b.
function cmp(a, b) {
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) {
		const d = (a[i] || 0) - (b[i] || 0);
		if (d !== 0) return d;
	}
	return 0;
}

export function versionGate(req, res, next) {
	const path = req.path;
	if (EXEMPT.has(path) || path.startsWith('/account')) return next();
	const clientVersion = req.headers['x-client-version'];
	if (clientVersion) {
		if (cmp(parseVersion(clientVersion), MINIMUM) < 0) {
			const headers = corsHeadersFor(req.headers.origin);
			for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
			return res.status(426).json({detail: 'Client version outdated. Please update the app.'});
		}
	}
	next();
}

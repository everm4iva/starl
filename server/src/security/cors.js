/*
 * ☆ CORS
 * -> decides which browser origins can read the api, driven by network.allowed_origins
 *    in config.yaml, so the operator stays in charge
 *
 * -> default is "*", any origin, which is safe here because login rides on a bearer token
 *    (the Authorization header), not a cookie, so a random site cant borrow someone's session
 *
 * -> wanna lock it down? put an exact list of origins in the config and only those get in
 *
 * -> non-browser callers (the native app, curl, other servers) dont send an Origin and arent
 *    affected by cors at all, this only ever gates browser reads
 */

import {ALLOWED_ORIGINS} from '../config.js';

// a single "*" anywhere in the list means "let anyone in", otherwise its an exact match
const ALLOW_ANY = ALLOWED_ORIGINS.includes('*');

const ALLOW_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOW_HEADERS = 'Authorization, Content-Type, X-Client-Version';

export function isAllowedOrigin(origin) {
	if (!origin) return false;
	if (ALLOW_ANY) return true;
	return ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''));
}

// headers to attach for an allowed origin, exported so the version gate can echo them on its
// early 426 (it runs before this middleware). we reflect the exact origin (nicer than a bare "*")
export function corsHeadersFor(origin) {
	if (!isAllowedOrigin(origin)) return {};
	return {'Access-Control-Allow-Origin': origin, Vary: 'Origin'};
}

export function cors(req, res, next) {
	const origin = req.headers.origin;
	if (isAllowedOrigin(origin)) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Vary', 'Origin');
	}
	if (req.method === 'OPTIONS') {
		// preflight, only worth answering fully when we actually allow this origin
		if (isAllowedOrigin(origin)) {
			res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
			res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
			res.setHeader('Access-Control-Max-Age', '600');
		}
		return res.status(204).end();
	}
	next();
}

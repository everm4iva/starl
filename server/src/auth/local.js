/*
 * ☆ Local auth
 * -> the actual nuts (nice) and bolts of logging in without any cloud, just us and the config secret
 * -> passwords get hashed with node's built-in scrypt (no extra dependency, nice and simple),
 *    and tokens are plain signed jwts using the secret from config.yaml
 * -> the shared modes (none/pin/password) all ride under one "local" identity, so everybody
 *    shares the same library, thats the whole point of a shared server
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {AUTH_SECRET} from '../config.js';

// the one identity everybody shares in none/pin/password mode, one server one library
export const SHARED_USER = {id: 'local', name: 'local', picture: null};

// how long a login lasts before you gotta refresh, generous since its your own server
const ACCESS_TTL = '7d';
const REFRESH_TTL = '60d';

// --- passwords ---l

// scrypt hash, salt baked right into the string so we can check it later, format is scrypt$salt$hash
export function hashPassword(password) {
	const salt = crypto.randomBytes(16);
	const hash = crypto.scryptSync(String(password), salt, 64);
	return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// constant-time string compare, for the shared pin/password so we dont leak them char by char
// we hash both sides first, that way the compare is always the same length no matter the input
export function safeEqual(a, b) {
	const ha = crypto.createHash('sha256').update(String(a)).digest();
	const hb = crypto.createHash('sha256').update(String(b)).digest();
	return crypto.timingSafeEqual(ha, hb);
}

// check a password against a stored hash, timing-safe so we dont leak anything by how long it takes
export function verifyPassword(password, stored) {
	try {
		const [scheme, saltHex, hashHex] = String(stored).split('$');
		if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
		const salt = Buffer.from(saltHex, 'hex');
		const expected = Buffer.from(hashHex, 'hex');
		const actual = crypto.scryptSync(String(password), salt, expected.length);
		return crypto.timingSafeEqual(expected, actual);
	} catch {
		return false;
	}
}

// --- tokens ---

// the short-lived one the client actually carries around on every request
// client_name is just the little label the app sends (which device is this), tags along for the ride
export function signAccess({sub, name = null, picture = null, client_name = null}) {
	return jwt.sign({sub, name, picture, client_name, typ: 'access'}, AUTH_SECRET, {
		algorithm: 'HS256',
		expiresIn: ACCESS_TTL,
		jwtid: crypto.randomUUID(),
	});
}

// the app only allows a-z 0-9 up to 15, so we do the same here, can't trust the client blindly lol
// empty is totally fine, its optional, we just clean whatevers there and caps it
export function cleanClientName(raw) {
	return String(raw || '')
		.replace(/[^a-z0-9]/gi, '')
		.slice(0, 15);
}

// the long-lived one, only good for getting a fresh access token, nothing else
export function signRefresh({sub}) {
	return jwt.sign({sub, typ: 'refresh'}, AUTH_SECRET, {
		algorithm: 'HS256',
		expiresIn: REFRESH_TTL,
		jwtid: crypto.randomUUID(),
	});
}

// verify + decode any of our tokens, throws if its junk or expired, caller sorts out the error
export function verifyLocalToken(token) {
	return jwt.verify(token, AUTH_SECRET, {algorithms: ['HS256']});
}

// handy little bundle, both tokens plus the user, exactly what the login routes wanna hand back
// clientName is optional, if the app sent one it gets baked into the access token so we know
// which device this session belongs to
export function issueSession(user, clientName = null) {
	return {
		access_token: signAccess({
			sub: user.id,
			name: user.name,
			picture: user.picture,
			client_name: clientName || null,
		}),
		refresh_token: signRefresh({sub: user.id}),
		user: {id: user.id, name: user.name, picture: user.picture || null},
	};
}

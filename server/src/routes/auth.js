/*
 * ☆ Auth routes
 * -> register / login / me / logout / refresh, all local, no cloud anywhere in sight
 *
 * -> login bends to the servers mode: none just lets you in, pin/password check a shared
 *    secret, userpass checks a real account, but they all end the same way, a signed session
 *
 * -> the client hits /auth/mode first so it knows which fields to even show you
 */

import {Router} from 'express';
import {getCurrentUser} from '../auth/jwt.js';
import {revokeToken} from '../auth/revoked.js';
import {requireUser, asyncHandler} from '../auth/middleware.js';
import {
	SHARED_USER,
	issueSession,
	signAccess,
	signRefresh,
	verifyLocalToken,
	verifyPassword,
	safeEqual,
	cleanClientName,
} from '../auth/local.js';
import {createAccount, getByUsername, upsertUser, recordClient, usersStore} from '../users.js';
import {AUTH_MODE, AUTH_PIN, AUTH_PASSWORD, AUTH_ALLOW_SIGNUP} from '../config.js';
import {httpError} from '../lib/http-error.js';

export const authRouter = Router();

// a little "someone's in!" line on every real login, so running the server in a terminal
// setting, so this is the real client address even behind a reverse proxy
function logConnection(req, who) {
	console.log(`[starl] Someone joined ${who} connected from ${req.ip}`);
}

// let the client peek at how this server does auth, so it draws the right login screen
authRouter.get('/auth/mode', (req, res) => {
	res.json({mode: AUTH_MODE, allow_signup: AUTH_ALLOW_SIGNUP});
});

// make a new account, only makes sense in userpass mode and only if signups are open
authRouter.post(
	'/auth/register',
	asyncHandler(async (req, res) => {
		if (AUTH_MODE !== 'userpass') throw httpError(400, 'this server doesnt use accounts');
		if (!AUTH_ALLOW_SIGNUP) throw httpError(403, 'signups are closed on this server');

		const username = String(req.body?.username || '').trim();
		const password = String(req.body?.password || '');
		if (!username || !password) throw httpError(400, 'username and password are required');

		let account;
		try {
			account = createAccount(username, password);
		} catch (err) {
			if (/taken/i.test(err.message)) throw httpError(409, 'that username is taken');
			throw httpError(400, err.message || 'could not create account');
		}
		const clientName = cleanClientName(req.body?.client_name);
		recordClient(account.id, clientName);
		logConnection(req, `${username} (new account, ${clientName || 'unnamed device'})`);
		res.json(issueSession(account, clientName));
	}),
);

// the one login door, what it checks depends on the mode, but the payoff is always a session
authRouter.post(
	'/auth/login',
	asyncHandler(async (req, res) => {
		const body = req.body || {};
		const clientName = cleanClientName(body.client_name);

		// the shared modes all end the same way, so this little helper keeps it dry
		const shareIn = () => {
			upsertUser({sub: SHARED_USER.id, name: SHARED_USER.name});
			recordClient(SHARED_USER.id, clientName);
			logConnection(req, `${clientName || 'unnamed device'} (${AUTH_MODE})`);
			return res.json(issueSession(SHARED_USER, clientName));
		};

		if (AUTH_MODE === 'none') {
			return shareIn();
		}

		if (AUTH_MODE === 'pin') {
			if (!AUTH_PIN) throw httpError(503, 'this server has no pin set yet');
			if (!safeEqual(String(body.pin || ''), AUTH_PIN)) throw httpError(401, 'wrong pin');
			return shareIn();
		}

		if (AUTH_MODE === 'password') {
			if (!AUTH_PASSWORD) throw httpError(503, 'this server has no password set yet');
			if (!safeEqual(String(body.password || ''), AUTH_PASSWORD)) throw httpError(401, 'wrong password');
			return shareIn();
		}

		if (AUTH_MODE === 'userpass') {
			// real account, check the name exists then the password matches its stored hash
			const account = getByUsername(body.username);
			if (!account || !verifyPassword(String(body.password || ''), account.passwordHash)) {
				throw httpError(401, 'wrong username or password');
			}
			recordClient(account.id, clientName);
			logConnection(req, `${account.name || body.username} (${clientName || 'unnamed device'})`);
			return res.json(issueSession(account, clientName));
		}

		// anything else means someone typed a mode we dont know, better to say so than guess
		throw httpError(400, `this server has an unknown auth mode: ${AUTH_MODE}`);
	}),
);

// who am i? - straight from the stored record for whoevers token this is
authRouter.get(
	'/auth/me',
	asyncHandler(async (req, res) => {
		const payload = await getCurrentUser(req.headers.authorization);
		const user = usersStore.read().users?.[payload.sub];
		res.json({user: user ? {id: user.id, name: user.name, picture: user.picture || null} : {}});
	}),
);

// log out, we just blacklist this token so it cant be used again even if someone kept a copy - hah bozo hacker
authRouter.post('/auth/logout', requireUser, (req, res) => {
	revokeToken(req.user);
	res.json({status: 'logged_out'});
});

// trade a refresh token for a fresh access token, so you dont have to re-login every week
authRouter.post(
	'/auth/refresh',
	asyncHandler(async (req, res) => {
		const refreshToken = req.body?.refresh_token;
		if (!refreshToken || String(refreshToken).length > 4096) throw httpError(400, 'invalid refresh token');

		let payload;
		try {
			payload = verifyLocalToken(refreshToken);
		} catch {
			throw httpError(401, 'refresh failed');
		}
		if (payload.typ !== 'refresh' || !payload.sub) throw httpError(401, 'refresh failed');

		// pull the latest name/picture back off the stored record, so a rename shows up on refresh
		const user = usersStore.read().users?.[payload.sub] || {id: payload.sub};
		res.json({
			access_token: signAccess({sub: user.id, name: user.name, picture: user.picture}),
			refresh_token: signRefresh({sub: user.id}),
		});
	}),
);

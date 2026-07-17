/*
 * ☆ Account state
 * -> per-user synced app state (history, likes, follows, playlists, settings), one file per
 *    user (data/user_state/<id>.json). A PUT rewrites just that user's file; export/delete
 *    touch one file instead of scanning everything.
 * -> appearance is stored in the account_settings sidecar (not this blob); it's pulled out
 *    on write and merged back on read so the client's API is unchanged.
 * -> port of account_state.py.
 */

import {Router} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {requireUser, asyncHandler} from '../auth/middleware.js';
import {RecordStore} from '../lib/record-store.js';
import {DATA_DIR, USER_STATE_DIR, SEARCH_CLICKS_DIR} from '../config.js';
import {upsertUser} from '../users.js';
import {revokeToken} from '../auth/revoked.js';
import {getAppearance, setAppearance} from './account-settings.js';
import {httpError} from '../lib/http-error.js';

export const accountStateRouter = Router();

const userStateRecords = new RecordStore(USER_STATE_DIR);

// data sub-dirs that hold machine caches or already-per-user records - the export/delete
// tree-walk skips them.
const EXCLUDED_DATA_SUBDIRS = new Set(['ytm_cache', 'search_rank_cache', 'user_state', 'search_clicks']);

const nowIso = () => new Date().toISOString();

function userIdFromPayload(payload) {
	const uid = String(payload?.sub || '').trim();
	if (!uid) throw httpError(401, 'Invalid user payload');
	return uid;
}

// one-time per-user migration: appearance used to live inline in this blob. move it to the
// account_settings sidecar and strip it here so it's never written back into this file
function readUserRecord(uid) {
	let record = userStateRecords.get(uid);
	record = record && typeof record === 'object' ? record : {};
	const state = record.state;
	if (state && typeof state === 'object' && 'appearance' in state) {
		const legacy = state.appearance;
		delete state.appearance;
		if (getAppearance(uid) === null && legacy && typeof legacy === 'object') setAppearance(uid, legacy);
		record.state = state;
		userStateRecords.put(uid, record);
	}
	return record;
}

function stateForResponse(uid, state) {
	const appearance = getAppearance(uid);
	return appearance !== null ? {...state, appearance} : state;
}

function writeUserRecord(uid, record) {
	userStateRecords.put(uid, record);
	return record;
}

// merges only at the top (section) level - each section's value fully replaces the
// previous one, so deleting an entry inside a section (ex: unfollowing one artist out
// of follows.artists) actually sticks. Recursing into section internals would keep
// stale nested keys forever, since a patch can never express "delete this key".

// in a non nerd way: if you send { follows: { artists: { a: true } } } and then later send
// { follows: { artists: { b: true } } }, the second one replaces the first one entirely,
// so a is gone. if we merged recursively, a would still be there forever.

function deepMerge(base, patch) {
	if (
		base === null ||
		typeof base !== 'object' ||
		Array.isArray(base) ||
		patch === null ||
		typeof patch !== 'object' ||
		Array.isArray(patch)
	) {
		return structuredClone(patch);
	}
	const merged = structuredClone(base);
	for (const [key, value] of Object.entries(patch)) {
		merged[key] = structuredClone(value);
	}
	return merged;
}

function getUserState(uid) {
	const state = readUserRecord(uid).state;
	return state && typeof state === 'object' ? state : {};
}

function setUserState(uid, nextStateIn, replace) {
	const current = readUserRecord(uid);
	const nextState = {...nextStateIn};
	if ('appearance' in nextState) {
		const appearance = nextState.appearance;
		delete nextState.appearance;
		if (appearance && typeof appearance === 'object') setAppearance(uid, appearance);
	}
	const baseState = replace ? {} : getUserState(uid);
	const state = deepMerge(baseState, nextState);
	delete state.appearance;
	const record = {state, updated_at: nowIso()};
	if (current.profile) record.profile = current.profile;
	return writeUserRecord(uid, record);
}

// ----------------------  export / delete tree-walk ----------------------

function* iterDataJsonFiles() {
	if (!fs.existsSync(DATA_DIR)) return;
	const walk = function* (dir) {
		let entries = [];
		try {
			entries = fs.readdirSync(dir, {withFileTypes: true});
		} catch {
			return;
		}
		for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const full = path.join(dir, ent.name);
			if (ent.isDirectory()) {
				const rel = path.relative(DATA_DIR, full).split(path.sep);
				if (EXCLUDED_DATA_SUBDIRS.has(rel[0])) continue;
				yield* walk(full);
			} else if (ent.name.endsWith('.json')) {
				const rel = path.relative(DATA_DIR, full).split(path.sep);
				if (rel.length && EXCLUDED_DATA_SUBDIRS.has(rel[0])) continue;
				yield full;
			}
		}
	};
	yield* walk(DATA_DIR);
}

const readJsonFile = (p) => {
	try {
		return JSON.parse(fs.readFileSync(p, 'utf-8'));
	} catch {
		return null;
	}
};
const writeJsonFile = (p, v) => {
	fs.mkdirSync(path.dirname(p), {recursive: true});
	fs.writeFileSync(p, JSON.stringify(v, null, 2));
};
const relPosix = (p) => path.relative(DATA_DIR, p).split(path.sep).join('/');

function isUserRecord(node, uid) {
	if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
	for (const key of ['id', 'sub', 'user_id']) {
		if (String(node[key] || '').trim() === uid) return true;
	}
	return false;
}

function extractUserData(node, uid) {
	if (node && typeof node === 'object' && !Array.isArray(node)) {
		if (isUserRecord(node, uid)) return structuredClone(node);
		const extracted = {};
		for (const [key, value] of Object.entries(node)) {
			if (key === uid) {
				extracted[key] = structuredClone(value);
				continue;
			}
			const child = extractUserData(value, uid);
			if (child !== null) extracted[key] = child;
		}
		return Object.keys(extracted).length ? extracted : null;
	}
	if (Array.isArray(node)) {
		const list = [];
		for (const item of node) {
			const child = extractUserData(item, uid);
			if (child !== null) list.push(child);
		}
		return list.length ? list : null;
	}
	return null;
}

function pruneUserData(node, uid) {
	if (node && typeof node === 'object' && !Array.isArray(node)) {
		if (isUserRecord(node, uid)) return [null, true];
		let changed = false;
		const pruned = {};
		for (const [key, value] of Object.entries(node)) {
			if (key === uid) {
				changed = true;
				continue;
			}
			const [child, childChanged] = pruneUserData(value, uid);
			if (childChanged) changed = true;
			if (child !== null) pruned[key] = child;
		}
		return [pruned, changed || Object.keys(pruned).length !== Object.keys(node).length];
	}
	if (Array.isArray(node)) {
		let changed = false;
		const list = [];
		for (const item of node) {
			const [child, c] = pruneUserData(item, uid);
			if (c) changed = true;
			if (child !== null) list.push(child);
		}
		return [list, changed || list.length !== node.length];
	}
	return [node, false];
}

function exportAccountFiles(uid) {
	const files = {};
	for (const p of iterDataJsonFiles()) {
		const data = readJsonFile(p);
		if (data === null) continue;
		const extracted = extractUserData(data, uid);
		if (extracted !== null) files[relPosix(p)] = extracted;
	}
	return files;
}

function extractAccountState(files, uid, fallback) {
	for (const snapshot of Object.values(files)) {
		if (!snapshot || typeof snapshot !== 'object') continue;
		if (snapshot.state && typeof snapshot.state === 'object') return snapshot.state;
		const users = snapshot.users;
		if (users && typeof users === 'object') {
			const rec = users[uid];
			if (rec && typeof rec === 'object' && rec.state && typeof rec.state === 'object') return rec.state;
		}
	}
	return fallback && typeof fallback === 'object' ? fallback : {};
}

function deleteAccountFiles(uid) {
	const updated = [];
	for (const p of iterDataJsonFiles()) {
		const data = readJsonFile(p);
		if (data === null) continue;
		const [pruned, changed] = pruneUserData(data, uid);
		if (changed) {
			writeJsonFile(p, pruned === null ? {} : pruned);
			updated.push(relPosix(p));
		}
	}
	return updated;
}

// ----------------------  routes ----------------------

accountStateRouter.get('/account/state', requireUser, (req, res) => {
	const userRecord = upsertUser(req.user);
	const uid = String(userRecord.id || userIdFromPayload(req.user));
	const record = readUserRecord(uid);
	const state = record.state && typeof record.state === 'object' ? record.state : {};
	res.json({user: userRecord, state: stateForResponse(uid, state), updated_at: record.updated_at});
});

accountStateRouter.put('/account/state', requireUser, (req, res) => {
	const userRecord = upsertUser(req.user);
	const uid = String(userRecord.id || userIdFromPayload(req.user));
	const body = req.body || {};
	if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) {
		throw httpError(400, 'State must be an object');
	}
	const record = setUserState(uid, body.state, Boolean(body.replace));
	record.profile = userRecord;
	writeUserRecord(uid, record);
	const state = record.state && typeof record.state === 'object' ? record.state : {};
	res.json({user: userRecord, state: stateForResponse(uid, state), updated_at: record.updated_at});
});

accountStateRouter.get('/account/export', requireUser, (req, res) => {
	const userRecord = upsertUser(req.user);
	const uid = String(userRecord.id || userIdFromPayload(req.user));
	const files = exportAccountFiles(uid);
	const record = readUserRecord(uid);
	const state = extractAccountState(files, uid, record.state || {});
	res.json({
		user: userRecord,
		state: state && typeof state === 'object' ? state : {},
		files,
		updated_at: record.updated_at,
	});
});

accountStateRouter.delete(
	'/account/delete',
	requireUser,
	asyncHandler(async (req, res) => {
		const userRecord = upsertUser(req.user);
		const uid = String(userRecord.id || userIdFromPayload(req.user));
		revokeToken(req.user);
		const updatedFiles = deleteAccountFiles(uid);
		userStateRecords.delete(uid);
		try {
			fs.unlinkSync(path.join(SEARCH_CLICKS_DIR, `${uid}.json`));
		} catch {
			/* may not exist.. just maybe */
		}
		res.json({status: 'deleted', files: updatedFiles});
	}),
);

/*
 * ☆ Server config
 * -> reads config.yaml (the friendly file right next to the server) and turns it into
 *    the paths, ports and knobs the rest of the code imports
 * -> data lives in data/, cache in cache/, both right here beside the server, so the whole
 *    thing stays self-contained, you can pick it up and drop it anywhere and it just works
 * -> if a setting feels global, it starts here
 */

import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import {BASE_DIR, CONFIG_PATH, config} from './config-file.js';

// re-export these so the rest of the code can grab them straight from config.js like before
export {BASE_DIR, CONFIG_PATH};

// an optional .env is still honored if you drop one in, handy for an operator who wants to
// override a value without editing the yaml, but the public build ships without one at all
const ENV_PATH = path.join(BASE_DIR, '.env');
if (fs.existsSync(ENV_PATH)) dotenv.config({path: ENV_PATH, quiet: true});

// same env tolerance the old config had, some keys carried a trailing space in the name,
// so we look under both spellings and trim the quotes off, no surprises
function env(name, fallback = '') {
	let value = process.env[name];
	if (value === undefined || value === '') value = process.env[`${name} `];
	if (value === undefined) value = fallback;
	return String(value).trim().replace(/^"|"$/g, '');
}

// tiny helper to dig into a yaml section without blowing up if its missing or weird
function section(name) {
	return (config && typeof config[name] === 'object' && config[name]) || {};
}
const serverCfg = section('server');
const limitsCfg = section('limits');
const authCfg = section('auth');
const workerCfg = section('worker');
const networkCfg = section('network');

function resolveDir(name, fallback) {
	const raw = env(name) || fallback;
	return path.isAbsolute(raw) ? raw : path.resolve(BASE_DIR, raw);
}

// --- data + cache roots, self-contained right beside the server ---
export const DATA_DIR = resolveDir('DATA_DIR', path.join(BASE_DIR, 'data'));
export const CACHE_DIR = resolveDir('CACHE_DIR', path.join(BASE_DIR, 'cache'));

// --- data files / sub-dirs (one file per record, the directory is the database) ---
export const USERS_FILE = path.join(DATA_DIR, 'users.json');
export const REVOKED_TOKENS_FILE = path.join(DATA_DIR, 'revoked_tokens.json');
export const USER_STATE_DIR = path.join(DATA_DIR, 'user_state');
export const SEARCH_CLICKS_DIR = path.join(DATA_DIR, 'search_clicks');
export const SEARCH_RANK_CACHE_DIR = path.join(DATA_DIR, 'search_rank_cache');
// listening stats: one small sidecar per user (albums/tracks/artists counters)
export const STATS_DIR = path.join(DATA_DIR, 'stats');
export const ACCOUNT_SETTINGS_DIR = path.join(DATA_DIR, 'account_settings');
export const PROFILE_PICTURE_DIR = path.join(DATA_DIR, 'profile_pictures');

// --- cache files / sub-dirs ---
export const AUDIO_DIR = path.join(CACHE_DIR, 'audio');
export const IMAGE_DIR = path.join(CACHE_DIR, 'images');
export const LYRICS_CACHE_DIR = path.join(CACHE_DIR, 'lyrics');

// --- the editable website, a folder of plain html/css/js anyone can open and change ---
export const WEB_DIR = path.join(BASE_DIR, 'web');

// --- who the server is, the stuff that shows up on the status page + in the app ---
export const SERVER_NAME = serverCfg.name || 'Starl Server';
export const SERVER_DESCRIPTION = serverCfg.description || '';
export const SERVER_PICTURE = serverCfg.picture || '';

// --- limits, soft hints for now, the cache + janitor lean on them more down the line ---
export const MAX_MEMORY_MB = Number.parseInt(limitsCfg.max_memory_mb, 10) || 1024;
export const MAX_STORAGE_GB = Number.parseInt(limitsCfg.max_storage_gb, 10) || 20;
export const MIN_VERSION = String(limitsCfg.min_version || '0.0.0');

// --- auth, all local, no cloud, the mode picks how people get in (see config.yaml) ---
// none -> just walk in | pin -> a shared code | password -> a shared password | userpass -> accounts
const rawMode = String(authCfg.mode || 'userpass').toLowerCase();
// "local" was the old phase-1 name for accounts, its just userpass now, so old configs still work
export const AUTH_MODE = rawMode === 'local' ? 'userpass' : rawMode;
export const AUTH_PIN = String(authCfg.pin || '');
export const AUTH_PASSWORD = String(authCfg.password || '');
export const AUTH_ALLOW_SIGNUP = authCfg.allow_signup !== false;
// the secret signs every token, config-file guarantees theres always one, so this is never empty
export const AUTH_SECRET = String(authCfg.secret || '');

// --- ports ---
export const PORT = Number.parseInt(serverCfg.port, 10) || 6912;
export const PAGE_PORT = Number.parseInt(serverCfg.page_port, 10) || 6910;
export const WORKER_PORT = Number.parseInt(workerCfg.port, 10) || 6918;
export const WORKER_URL = env('WORKER_URL') || `http://127.0.0.1:${WORKER_PORT}`;
// whether index.js should spawn the python worker itself (vs you running it yourself)
export const SPAWN_WORKER = workerCfg.spawn !== false;

// --- who can reach the api from a browser (cors), see network.allowed_origins in config.yaml ---
// "*" (or "open") anywhere in the list means any origin is fine, otherwise its an exact allow-list
function parseOrigins(raw) {
	const clean = (o) => String(o).trim().replace(/\/$/, '');
	if (Array.isArray(raw)) {
		const list = raw.map(clean).filter(Boolean);
		return list.length ? list : ['*'];
	}
	if (typeof raw === 'string' && raw.trim()) {
		const s = raw.trim().toLowerCase();
		return s === '*' || s === 'open' ? ['*'] : [clean(raw)];
	}
	return ['*']; // missing or weird -> open, so an old config still lets the app in
}
export const ALLOWED_ORIGINS = parseOrigins(networkCfg.allowed_origins);

// --- what version this server is, straight from package.json, the one source of truth ---
// dev reads package.json straight off disk; a packaged build has no package.json (and no
// import.meta.url once bundled), so build-bundle.mjs bakes the version in as __SERVER_VERSION__
function readVersion() {
	if (process.env.STARL_PACKAGED === '1') {
		return typeof __SERVER_VERSION__ === 'string' ? __SERVER_VERSION__ : 'unknown';
	}
	const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
	try {
		return String(JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || '') || 'unknown';
	} catch {
		return 'unknown';
	} // best effort, a missing package.json shouldnt take the boot down
}
export const SERVER_VERSION = readVersion();

/*
 * ☆ Mix route
 * -> POST /mix : builds the candidate pool for a "Create MIX". The client sends one or
 *    more seed video ids (the current track, or the whole queue); the worker pulls YT
 *    Music "start radio" for each seed and we merge + de-dupe them into one pool
 *
 * -> the smart part (re-ranking by the user's stats, honoring their Customize MIX
 *    settings, dropping stuff they skip) happens on the CLIENT, where those live. This
 *    route just hands over a good, varied pool to work from
 */

import {Router} from 'express';
import {requireUser, asyncHandler} from '../auth/middleware.js';
import {worker} from '../music/worker-client.js';
import {httpError} from '../lib/http-error.js';

export const mixRouter = Router();

const MAX_SEEDS = 5;
const MAX_POOL = 120;

// pull a bare 11-char youtube video id out of whatever the client sent (a raw id, a
// watch url, or a trackKey that happens to be a url).
function toVideoId(value) {
	const s = String(value || '').trim();
	if (!s) return '';
	const byParam = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
	if (byParam) return byParam[1];
	const byPath = s.match(/\/([A-Za-z0-9_-]{11})(?:[?&#]|$)/);
	if (byPath) return byPath[1];
	if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
	return '';
}

mixRouter.post(
	'/mix',
	requireUser,
	asyncHandler(async (req, res) => {
		const rawSeeds = Array.isArray(req.body?.seeds) ? req.body.seeds : req.body?.seed ? [req.body.seed] : [];
		// keep the seed order the client sent (current track first), unique, capped.
		const seeds = [];
		for (const raw of rawSeeds) {
			const id = toVideoId(raw);
			if (id && !seeds.includes(id)) seeds.push(id);
			if (seeds.length >= MAX_SEEDS) break;
		}
		if (!seeds.length) throw httpError(400, 'At least one valid seed is required');

		// spread the pool across the seeds so no single seed dominates a multi-seed mix.
		const perSeed = Math.max(10, Math.ceil(MAX_POOL / seeds.length));

		const pools = await Promise.all(
			seeds.map((id) =>
				worker
					.getRadio(id, perSeed)
					.then((r) => (r && r.tracks) || [])
					.catch(() => []),
			),
		);

		// interleave the seeds' pools (round-robin) so a queue mix feels blended, not
		// "all of seed 1, then all of seed 2". de-dupe by video id along the way.
		const seen = new Set();
		const merged = [];
		const maxLen = pools.reduce((m, p) => Math.max(m, p.length), 0);
		for (let i = 0; i < maxLen && merged.length < MAX_POOL; i++) {
			for (const pool of pools) {
				const track = pool[i];
				if (!track || !track.id || seen.has(track.id)) continue;
				seen.add(track.id);
				merged.push(track);
				if (merged.length >= MAX_POOL) break;
			}
		}

		res.json({tracks: merged});
	}),
);

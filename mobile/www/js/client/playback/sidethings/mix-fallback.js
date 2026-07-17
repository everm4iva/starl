/**
 * ☆=========================================☆
 * Mix fallback - when a real MIX can't be built, fill it from your downloads
 * The radio pool comes from the server, so it needs internet + a working /mix. When
 * that's not there (you're offline, or the server hands back nothing) this steps in and
 * builds a mix out of the songs you've already cached on the client, so a mix still happens.
 *
 * --- What this file does? ---
 * - getMode(): reads the "When MIX fails" choice from account state ('mixFallback' section)
 *     * 'off'     -> don't build anything, let the engine show its error (default is NOT this)
 *     * 'similar' -> prefer downloads by the seed's artist (and artists you follow), then fill
 *     * 'any'     -> just a plain shuffle of everything you've downloaded
 * - build(seeds, seedIds): returns queue tracks the player can play offline (empty if none)
 *
 * --- Dictionary / Terms / Extra details ---
 * - "library" here = starlMediaCache.listTrackRecords() -> full metadata per cached track
 *   (blob left out for memory); only rows with a real audio blob (hasBlob) are playable
 * - same "no real genre data" honesty as the mix engine: "similar" leans on artist, not tempo
 * - reuses starlMixUtil (from mix-engine.js) so both files agree on ids / skips / seed artists
 * ☆=========================================☆
 */

(function () {
	const SECTION_NAME = 'mixFallback';
	const MODES = ['off', 'similar', 'any'];
	const DEFAULT_MODE = 'similar';

	/* ☆======= settings =======☆ */

	function getMode() {
		const api = window.starlAccountState;
		const section = api && typeof api.getSection === 'function' ? api.getSection(SECTION_NAME, null) : null;
		const mode = section && section.mode;
		return MODES.includes(mode) ? mode : DEFAULT_MODE;
	}

	/* ☆======= library record -> queue track =======☆ */

	// a cached record already carries what a queue track needs; just line up the field names.
	// keep its own trackKey/sourceUrl so the player resolves straight to the offline blob
	function recordToTrack(rec) {
		const url = rec.sourceUrl || rec.streamUrl || rec.trackKey || '';
		return {
			title: rec.title || 'Untitled',
			artist: rec.artist || 'Unknown artist',
			album: rec.album || '',
			imageUrl: rec.imageUrl || '',
			thumbnail: rec.imageUrl || '',
			sourceUrl: rec.sourceUrl || url,
			url,
			streamUrl: rec.streamUrl || '',
			trackKey: rec.trackKey || url,
			duration: Number(rec.duration || 0) || 0,
			artistChannelId: '',
			albumId: '',
		};
	}

	/* ☆======= the build =======☆ */

	// one clean row per real song: skip the alias rows, need a playable blob, drop the seeds
	// themselves + anything you keep skipping, and never the same video twice
	function playablePool(records, util, seedIds, skipSet) {
		const seedSet = new Set(seedIds || []);
		const seen = new Set();
		const pool = [];
		for (const rec of records) {
			if (!rec || rec.aliasOf || !rec.hasBlob) continue;
			const vid = util.videoIdOf(rec.trackKey || rec.sourceUrl || rec.streamUrl);
			const key = vid || rec.trackKey || '';
			if (!key || seen.has(key)) continue;
			if (vid && (seedSet.has(vid) || skipSet.has(vid))) continue;
			seen.add(key);
			pool.push(rec);
		}
		return pool;
	}

	// 'similar': songs by the seed's artist (or artists you follow) go first, the rest fill in.
	// both halves get shuffled so a mix feels fresh instead of alphabetical
	function orderBySimilar(pool, seeds, util) {
		const seedArtists = util.seedArtistSet(seeds || []);
		const followed = util.preferredArtistSet(false, []);
		const close = [];
		const rest = [];
		for (const rec of pool) {
			const near = util.isPreferred(rec, seedArtists) || util.isPreferred(rec, followed);
			(near ? close : rest).push(rec);
		}
		return util.shuffle(close).concat(util.shuffle(rest));
	}

	async function build(seeds, seedIds) {
		const mode = getMode();
		if (mode === 'off') return [];

		const cache = window.starlMediaCache;
		const util = window.starlMixUtil;
		if (!cache || typeof cache.listTrackRecords !== 'function' || !util) return [];

		let records = [];
		try {
			records = await cache.listTrackRecords();
		} catch (e) {
			records = [];
		}
		if (!records || !records.length) return [];

		const stats = window.starlStats ? await window.starlStats.getStats() : null;
		const skipSet = util.skippedVideoIds(stats);
		const pool = playablePool(records, util, seedIds, skipSet);
		if (!pool.length) return [];

		const ordered = mode === 'any' ? util.shuffle(pool) : orderBySimilar(pool, seeds, util);
		return ordered.slice(0, util.MAX_TRACKS).map(recordToTrack);
	}

	window.starlMixFallback = {getMode, build};
})();

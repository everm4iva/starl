/**
 * ☆=========================================☆
 * Recommend prefs - the little brain behind "more / less / none of this"
 * You tell the app what you want to see more or less of (a track, an artist, or a
 * whole album) and this file remembers it, turns it into a frequency weight, and
 * quietly walks that weight back to normal if your listening doesn't back it up.
 *
 * --- What this file does? ---
 * - more() / less() / none() / hide(): the four things the Recommend menu can do
 * - setLevel() / removeItem(): the finer controls the Configure content page uses
 * - factorForTrack() / rankTracks(): turn prefs into a number the mix + home rows use
 * - runSweep(): the smart part - once a week per item, nudge the weight back toward
 *   normal unless your clicks actually agree with what you asked for
 * - everything lives in the 'recommendPrefs' account-state section, so it syncs like
 *   history and follows do, and gets wiped when the rest of your data does
 *
 * --- Dictionary / Terms / Extra details ---
 * - "level" = a signed number. positive means boost, negative means debuff, 0 means
 *   normal. the magnitude runs 0.5 .. 7, where each whole step is roughly 10% - so
 *   level 7 is "70% more", level -7 is "70% less"
 * - "block" = None of this. dropped from every recommendation surface, on purpose
 * - "hide" = Don't wanna see. just a visual thing, gone until you relaunch or log in
 * ☆=========================================☆
 */

(function () {
	const SECTION_NAME = 'recommendPrefs';
	const UPDATE_EVENT = 'starl-recommend-updated';

	// the rate math, all in one spot so it's easy to tweak later
	const BASE_LEVEL = 2; // first tap of More/Less lands here (about 20%)
	const MAX_LEVEL = 7; // hard cap both ways (about 70% more / less)
	const MIN_SLIDER = 0.5; // the Configure page slider floor
	const STEP_PERCENT = 0.1; // one whole level = 10% swing in how often it shows
	const FACTOR_FLOOR = 0.3; // level -7 -> shows 30% as often
	const FACTOR_CEIL = 1.7; // level +7 -> shows 70% as often

	// the self-adjust cadence: check at most twice a day, and only actually judge an
	// item once a full week has passed since we last looked at it
	const SWEEP_MIN_GAP_MS = 12 * 60 * 60 * 1000;
	const REVIEW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
	const GROWTH_TARGET = 0.2; // your clicks must climb 20% in a week to "earn" a boost

	// things you asked to just not see right now - kept in memory only, so a relaunch
	// or a fresh login brings them back (that's the whole point of "Don't wanna see")
	const hiddenThisSession = new Set();

	/* ☆======= account-state plumbing =======☆ */

	function accountState() {
		return window.starlAccountState || null;
	}

	// the stored blob is { items: {key:pref}, blocked: {key:meta}, lastSweepAt }.
	// anything missing is healed here so a half-written blob can never blow up a caller
	function readData() {
		const api = accountState();
		const raw = api && typeof api.getSection === 'function' ? api.getSection(SECTION_NAME, null) : null;
		const data = raw && typeof raw === 'object' ? raw : {};
		return {
			items: data.items && typeof data.items === 'object' ? data.items : {},
			blocked: data.blocked && typeof data.blocked === 'object' ? data.blocked : {},
			lastSweepAt: Number(data.lastSweepAt || 0) || 0,
		};
	}

	function writeData(data) {
		const api = accountState();
		if (api && typeof api.setSection === 'function') {
			api.setSection(SECTION_NAME, data, {skipRefresh: true});
		}
		try {
			window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
		} catch (error) {}
	}

	/* ☆======= keys - one steady key per thing, matching how stats keys it =======☆ */

	// tracks are keyed by their trackKey (a url), artists + albums by lowercased name -
	// same convention stats-tracker uses, so a pref and its listening score line up
	function trackId(obj) {
		return String((obj && (obj.trackKey || obj.sourceUrl || obj.url)) || '').trim();
	}

	function nameId(value) {
		return String(value || '').trim().toLowerCase();
	}

	function keyOf(kind, obj) {
		if (kind === 'track') {
			const id = trackId(obj);
			return id ? 't:' + id : '';
		}
		if (kind === 'artist') {
			const id = nameId(obj && (obj.name || obj.artist));
			return id ? 'a:' + id : '';
		}
		if (kind === 'album') {
			const id = nameId(obj && (obj.album || obj.name || obj.title));
			return id ? 'al:' + id : '';
		}
		return '';
	}

	// keep just enough about the thing so the Configure page can draw it later without
	// having to go re-fetch anything
	function metaOf(kind, obj) {
		const o = obj || {};
		return {
			kind,
			title: String(o.title || o.name || o.album || 'Untitled').trim(),
			artist: String(o.artist || '').trim(),
			imageUrl: String(o.imageUrl || o.thumbnail || '').trim(),
			album: String(o.album || '').trim(),
			trackKey: trackId(o),
			sourceUrl: String(o.sourceUrl || o.url || '').trim(),
			artistChannelId: String(o.artistChannelId || o.channelId || '').trim(),
			albumId: String(o.albumId || '').trim(),
		};
	}

	/* ☆======= level <-> factor =======☆ */

	function clampLevel(level) {
		const n = Number(level) || 0;
		if (n > MAX_LEVEL) return MAX_LEVEL;
		if (n < -MAX_LEVEL) return -MAX_LEVEL;
		return n;
	}

	// turn a signed level into "how often should this show, vs normal (1.0)"
	function factorOfLevel(level) {
		const f = 1 + clampLevel(level) * STEP_PERCENT;
		if (f < FACTOR_FLOOR) return FACTOR_FLOOR;
		if (f > FACTOR_CEIL) return FACTOR_CEIL;
		return f;
	}

	/* ☆======= engagement reads (for the weekly self-adjust) =======☆ */

	// one number for "how much do you actually reach for this thing", pulled from
	// the same stats the mix engine reads. tracks -> plays, artists -> opens, albums -> clicks
	function engagementFrom(stats, pref) {
		if (!stats) return 0;
		const meta = pref.meta || {};
		if (pref.kind === 'track') {
			const e = (stats.tracks || {})[meta.trackKey || ''] || {};
			return Number(e.plays || e.clicks || 0) || 0;
		}
		if (pref.kind === 'artist') {
			const e = (stats.artists || {})[nameId(meta.artist || meta.title)] || {};
			return Number(e.opens || 0) || 0;
		}
		if (pref.kind === 'album') {
			const e = (stats.albums || {})[nameId(meta.album || meta.title)] || {};
			return Number(e.clicks || 0) || 0;
		}
		return 0;
	}

	/* ☆======= the four menu actions =======☆ */

	// More/Less nudge in one direction. the very first nudge on a "normal" thing snaps to
	// the base level (about 20%), after that each tap adds one step toward the cap
	function bump(kind, obj, direction) {
		const key = keyOf(kind, obj);
		if (!key) return;
		const data = readData();
		delete data.blocked[key]; // asking for more/less un-blocks it, obviously

		const existing = data.items[key];
		let level = existing ? Number(existing.level) || 0 : 0;
		if (direction > 0) {
			level = level < BASE_LEVEL ? BASE_LEVEL : clampLevel(level + 1);
		} else {
			level = level > -BASE_LEVEL ? -BASE_LEVEL : clampLevel(level - 1);
		}

		saveItem(data, key, kind, obj, level);
	}

	function more(kind, obj) {
		bump(kind, obj, +1);
	}

	function less(kind, obj) {
		bump(kind, obj, -1);
	}

	// None of this - the blacklist. drops any boost/debuff and remembers the block
	function none(kind, obj) {
		const key = keyOf(kind, obj);
		if (!key) return;
		const data = readData();
		delete data.items[key];
		data.blocked[key] = {kind, key, meta: metaOf(kind, obj), at: Date.now()};
		writeData(data);
	}

	// Don't wanna see - purely visual, forgotten on relaunch/login. one call covers every
	// key this thing could match on, so hiding a track also hushes its exact key
	function hide(kind, obj) {
		const key = keyOf(kind, obj);
		if (key) hiddenThisSession.add(key);
		try {
			window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
		} catch (error) {}
	}

	/* ☆======= finer controls (Configure content page) =======☆ */

	// write one item's level, refreshing the self-adjust window. level 0 means "normal",
	// which is the same as having no pref at all, so we just drop it
	function saveItem(data, key, kind, obj, level) {
		const clamped = clampLevel(level);
		if (!clamped) {
			delete data.items[key];
			writeData(data);
			return;
		}
		const prev = data.items[key] || {};
		data.items[key] = {
			kind,
			key,
			level: clamped,
			meta: metaOf(kind, obj && (obj.title || obj.name) ? obj : prev.meta || obj),
			baseEng: prev.baseEng || 0,
			setAt: prev.setAt || Date.now(),
			reviewAt: prev.reviewAt || Date.now(),
		};
		writeData(data);
		// grab a fresh engagement baseline so the next weekly check has something to compare
		refreshBaseline(key);
	}

	// slider on the Configure page: set the magnitude directly, keeping the item's current
	// side (boost stays boost, debuff stays debuff). magnitude runs MIN_SLIDER .. MAX_LEVEL
	function setMagnitude(key, magnitude) {
		const data = readData();
		const item = data.items[key];
		if (!item) return;
		let mag = Number(magnitude) || 0;
		if (mag < MIN_SLIDER) mag = MIN_SLIDER;
		if (mag > MAX_LEVEL) mag = MAX_LEVEL;
		const sign = (Number(item.level) || 0) < 0 ? -1 : 1;
		saveItem(data, key, item.kind, item.meta, sign * mag);
	}

	// the "Boost more" / "Debuff more" buttons - step one level in a direction, flipping
	// side cleanly if you push past normal
	function bumpKey(key, direction) {
		const data = readData();
		const item = data.items[key];
		if (!item) return;
		let level = Number(item.level) || 0;
		if (direction > 0) level = level < BASE_LEVEL ? BASE_LEVEL : clampLevel(level + 1);
		else level = level > -BASE_LEVEL ? -BASE_LEVEL : clampLevel(level - 1);
		saveItem(data, key, item.kind, item.meta, level);
	}

	// "Remove item" on the Configure page, or unblock from the Removed tab
	function removeItem(key) {
		const data = readData();
		delete data.items[key];
		delete data.blocked[key];
		writeData(data);
	}

	function unhide(key) {
		hiddenThisSession.delete(key);
		try {
			window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
		} catch (error) {}
	}

	/* ☆======= lookups the UI + weighting use =======☆ */

	function getItem(key) {
		return readData().items[key] || null;
	}

	function listItems() {
		return Object.values(readData().items);
	}

	function listBlocked() {
		return Object.values(readData().blocked);
	}

	// a track can be blocked three ways: itself, its artist, or its album. any one counts
	function isBlockedTrack(track) {
		const blocked = readData().blocked;
		return Boolean(
			blocked[keyOf('track', track)] ||
				blocked['a:' + nameId(track && track.artist)] ||
				blocked['al:' + nameId(track && (track.album || ''))],
		);
	}

	function isBlockedName(kind, value) {
		const key = kind === 'artist' ? 'a:' + nameId(value) : 'al:' + nameId(value);
		return Boolean(readData().blocked[key]);
	}

	function isHidden(kind, obj) {
		return hiddenThisSession.has(keyOf(kind, obj));
	}

	// most-specific wins: a track's own pref beats its artist's, which beats its album's.
	// keeps things predictable instead of multiplying three weights into a surprise
	function factorForTrack(track) {
		const items = readData().items;
		const t = items[keyOf('track', track)];
		if (t) return factorOfLevel(t.level);
		const a = items['a:' + nameId(track && track.artist)];
		if (a) return factorOfLevel(a.level);
		const al = items['al:' + nameId(track && (track.album || ''))];
		if (al) return factorOfLevel(al.level);
		return 1;
	}

	function factorForName(kind, value) {
		const key = kind === 'artist' ? 'a:' + nameId(value) : 'al:' + nameId(value);
		const item = readData().items[key];
		return item ? factorOfLevel(item.level) : 1;
	}

	// take a list of candidate tracks and hand back the ones worth showing, gently pushed
	// around so boosted stuff floats up and debuffed stuff sinks - never a hard reshuffle
	function rankTracks(tracks) {
		if (!Array.isArray(tracks)) return [];
		const kept = tracks.filter((t) => t && !isBlockedTrack(t) && !hiddenThisSession.has(keyOf('track', t)));
		// dividing the original position by the weight keeps the radio order mostly intact
		// and only nudges: weight 1.7 roughly halves your wait, weight 0.3 roughly triples it
		return kept
			.map((track, index) => ({track, index, sortKey: index / factorForTrack(track)}))
			.sort((a, b) => a.sortKey - b.sortKey || a.index - b.index)
			.map((w) => w.track);
	}

	/* ☆======= the smart part: weekly self-adjust =======☆ */

	// snapshot how much you engage with one item *now*, so a week from now we can tell if
	// your behaviour agreed with the boost/debuff you asked for
	async function refreshBaseline(key) {
		const statsApi = window.starlStats;
		if (!statsApi || typeof statsApi.getStats !== 'function') return;
		const stats = await statsApi.getStats();
		if (!stats) return;
		const data = readData();
		const item = data.items[key];
		if (!item) return;
		item.baseEng = engagementFrom(stats, item);
		data.items[key] = item;
		writeData(data);
	}

	// the heart of it: for each pref old enough to judge, compare clicks-now to clicks-then.
	// a boost you didn't live up to melts back to normal; a debuff you keep fighting eases off
	async function runSweep() {
		if (Date.now() - readData().lastSweepAt < SWEEP_MIN_GAP_MS) return;

		const statsApi = window.starlStats;
		if (!statsApi || typeof statsApi.getStats !== 'function') return;
		const stats = await statsApi.getStats();
		// offline, or collection is off -> no numbers to judge with. leave lastSweepAt alone
		// so reconnecting (the 'online' listener in init) gets a real shot at it, instead of
		// us burning the 12h cooldown on a sweep that couldn't actually do anything
		if (!stats) return;

		// re-read now that the fetch is done, so a boost the user made while stats were
		// loading isn't clobbered by our stale copy
		const data = readData();
		const now = Date.now();
		for (const key of Object.keys(data.items)) {
			const item = data.items[key];
			const level = Number(item.level) || 0;
			if (!level) continue;
			if (now - (item.reviewAt || item.setAt || 0) < REVIEW_AFTER_MS) continue;

			const live = engagementFrom(stats, item);
			const base = Number(item.baseEng) || 0;
			const grew = base > 0 ? (live - base) / base >= GROWTH_TARGET : live > 0;

			if (level > 0 && !grew) {
				// you boosted it but didn't actually reach for it more - back to normal
				delete data.items[key];
				continue;
			}
			if (level < 0 && grew) {
				// you debuffed it but keep listening anyway - ease the debuff one step
				const next = clampLevel(level + 1);
				if (next === 0) delete data.items[key];
				else {
					item.level = next;
					item.baseEng = live;
					item.reviewAt = now;
					data.items[key] = item;
				}
				continue;
			}

			// behaviour matched the ask - keep it, just reset the window + baseline
			item.baseEng = live;
			item.reviewAt = now;
			data.items[key] = item;
		}

		// always stamp the cooldown, even on a quiet pass, so we don't re-sweep all day
		data.lastSweepAt = now;
		writeData(data);
	}

	/* ☆======= wipe (rides along with clearing your stats) =======☆ */

	function clearAll() {
		hiddenThisSession.clear();
		writeData({items: {}, blocked: {}, lastSweepAt: 0});
	}

	/* ☆======= boot =======☆ */

	function init() {
		// give stats + account-state a moment to settle, then do the first weekly check
		setTimeout(runSweep, 4000);
		// back online after being offline - the sweep left its cooldown alone, so take a shot
		// at it now that stats can actually be fetched (account-state also flushes its queued
		// pref writes on this same event, so everything you did offline uploads here too)
		window.addEventListener('online', () => {
			setTimeout(runSweep, 4000);
		});
		window.addEventListener('starl-account-state-updated', () => {
			// another device may have set prefs while we were away - let the UI redraw
			try {
				window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
			} catch (error) {}
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}

	/* ☆======= public API =======☆ */

	window.starlRecommend = {
		// menu actions
		more,
		less,
		none,
		hide,
		unhide,
		// finer controls
		setMagnitude,
		bumpKey,
		removeItem,
		// reads
		getItem,
		listItems,
		listBlocked,
		keyOf,
		isBlockedTrack,
		isBlockedName,
		isHidden,
		factorForTrack,
		factorForName,
		factorOfLevel,
		rankTracks,
		// housekeeping heheh
		runSweep,
		clearAll,
		// knobs, exposed so the Configure page slider matches the math exactly
		limits: {BASE_LEVEL, MAX_LEVEL, MIN_SLIDER, STEP_PERCENT},
	};
})();

/**
 * ☆=========================================☆
 * Mix engine - builds a "Create MIX" and drops it into the queue
 * A MIX is a fresh, smart queue seeded by a track (or the whole current queue).
 * The server hands back a big pool of YT Music "radio" candidates; this file does
 * the smart part: re-ranks and filters that pool using your listening stats and
 * your Customize MIX settings, then replaces the queue and starts playing
 *
 * --- What this file does? ---
 * - fromTrack(track): mix seeded by one track ("Based on current track")
 * - fromQueue(): mix seeded by every track in the current queue ("Based on queue")
 * - Reads mixSettings from account state (the Customize MIX page writes it); falls
 *   back to sensible defaults so it works before that page exists
 * - Drops tracks you keep skipping (from your stats), then applies the artist / genre
 *   / mood preferences as gentle ordering passes
 *
 * --- Dictionary / Terms / Extra details ---
 * - There is no real BPM in the data, so "genre" and "mood" are honest approximations
 *   built from artist variety, radio order, and track length - not measured tempo
 * - Needs to be online (radio is a server call). Offline, it says so instead of failing
 * ☆=========================================☆
 */

(function () {
	const SECTION_NAME = 'mixSettings';
	const MAX_TRACKS = 63; // how many songs a finished mix holds (63 new + 1 current) :P
	const SKIP_DROP_COUNT = 2; // skipped this many times (and barely heard) -> leave it out
	const SKIP_DROP_SECONDS = 30;

	// option ids, shared with the Customize MIX page (recommendation-settings)
	const ARTIST_MODES = ['new', 'followed', 'followedAndQueue', 'random'];
	const GENRE_MODES = ['shuffleDifferent', 'shuffleCloser', 'sameOnly', 'random'];
	const MOOD_MODES = ['upDown', 'consistent', 'random'];
	const DEFAULTS = {artists: 'new', genre: 'random', mood: 'consistent'};

	let building = false;

	/* ☆======= shared helpers =======☆ */

	function apiBase() {
		if (typeof getApiBase === 'function') return getApiBase();
		return (window.starlShared && window.starlShared.getApiBase && window.starlShared.getApiBase()) || '';
	}

	function accessToken() {
		if (typeof getAccessToken === 'function') return getAccessToken();
		return localStorage.getItem('starl_access_token') || '';
	}

	function toast(message, kind) {
		if (typeof window.showToast === 'function') window.showToast(message, kind || 'success');
	}

	// the toast bar reuses a single element, so back-to-back messages clobber each other.
	// space them out when we want the user to actually read a little sequence of them
	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// "offline" for a mix = no radio call is possible: device is offline, or we're browsing cached content while logged out (cache mode). same idea offline-availability.js uses
	function isOffline() {
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
		const auth = window.starlAuth;
		if (auth && typeof auth.isCacheMode === 'function' && auth.isCacheMode()) return true;
		return false;
	}

	function shuffle(list) {
		const out = list.slice();
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[out[i], out[j]] = [out[j], out[i]];
		}
		return out;
	}

	// pull an 11-char youtube id out of a raw id, a watch url, or a trackKey
	function videoIdOf(value) {
		const s = String(value || '').trim();
		if (!s) return '';
		const byParam = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
		if (byParam) return byParam[1];
		const byPath = s.match(/\/([A-Za-z0-9_-]{11})(?:[?&#]|$)/);
		if (byPath) return byPath[1];
		if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
		return '';
	}

	function artistKeyOf(track) {
		const id = String((track && track.artistChannelId) || '').trim();
		if (id) return id;
		return String((track && track.artist) || '')
			.trim()
			.toLowerCase();
	}

	/* ☆======= settings =======☆ */

	function reconcile(settings) {
		const out = {...DEFAULTS};
		if (settings && typeof settings === 'object') {
			if (ARTIST_MODES.includes(settings.artists)) out.artists = settings.artists;
			if (GENRE_MODES.includes(settings.genre)) out.genre = settings.genre;
			if (MOOD_MODES.includes(settings.mood)) out.mood = settings.mood;
		}
		return out;
	}

	function getSettings() {
		const api = window.starlAccountState;
		const section = api && typeof api.getSection === 'function' ? api.getSection(SECTION_NAME, null) : null;
		return reconcile(section);
	}

	/* ☆======= candidate -> queue track =======☆ */

	function toQueueTrack(candidate) {
		const url = candidate.url || candidate.sourceUrl || '';
		return {
			title: candidate.title || 'Untitled',
			artist: candidate.artist || 'Unknown artist',
			album: candidate.album || '',
			imageUrl: candidate.thumbnail || candidate.imageUrl || '',
			thumbnail: candidate.thumbnail || candidate.imageUrl || '',
			sourceUrl: url,
			url,
			streamUrl: '',
			trackKey: url || candidate.id || '',
			duration: Number(candidate.duration || 0) || 0,
			artistChannelId: candidate.artistChannelId || '',
			albumId: candidate.albumId || '',
		};
	}

	// a seed track (from a context menu or the queue) may not be in queue-track shape yet;
	// this makes sure the head of the mix is something the player can play right away
	function toPlayableSeed(seed) {
		if (!seed) return null;
		const url = seed.sourceUrl || seed.url || seed.streamUrl || '';
		return {
			title: seed.title || 'Untitled',
			artist: seed.artist || 'Unknown artist',
			album: seed.album || '',
			imageUrl: seed.imageUrl || seed.thumbnail || '',
			thumbnail: seed.imageUrl || seed.thumbnail || '',
			sourceUrl: seed.sourceUrl || url,
			url,
			streamUrl: seed.streamUrl || '',
			trackKey: seed.trackKey || url,
			duration: Number(seed.duration || 0) || 0,
			artistChannelId: seed.artistChannelId || '',
			albumId: seed.albumId || '',
		};
	}

	/* ☆======= filtering: drop the stuff you skip =======☆ */

	// videoIds the user clearly bounces off (skipped a lot, barely listened)
	function skippedVideoIds(stats) {
		const set = new Set();
		const tracks = (stats && stats.tracks) || {};
		for (const key of Object.keys(tracks)) {
			const entry = tracks[key] || {};
			if ((entry.skips || 0) >= SKIP_DROP_COUNT && (entry.seconds || 0) < SKIP_DROP_SECONDS) {
				const vid = videoIdOf(key);
				if (vid) set.add(vid);
			}
		}
		return set;
	}

	/* ☆======= ordering passes =======☆ */

	// how much time you've already spent on this candidate's artist (from stats) - friendly statistics not being sold to advertisers, heheh
	function familiarityMap(stats) {
		const map = {};
		const artists = (stats && stats.artists) || {};
		for (const key of Object.keys(artists)) map[key] = (artists[key] || {}).seconds || 0;
		return map;
	}

	function preferredArtistSet(includeQueue, seedTracks) {
		const set = new Set();
		const follows = window.starlFollows;
		if (follows && typeof follows.getFollowedArtists === 'function') {
			for (const a of follows.getFollowedArtists()) {
				if (a && a.id) set.add(String(a.id));
				if (a && a.name) set.add(String(a.name).toLowerCase());
			}
		}
		if (includeQueue) {
			for (const t of seedTracks) set.add(artistKeyOf(t));
		}
		return set;
	}

	function isPreferred(track, set) {
		const id = String(track.artistChannelId || '').trim();
		if (id && set.has(id)) return true;
		const name = String(track.artist || '')
			.trim()
			.toLowerCase();
		return Boolean(name && set.has(name));
	}

	// keep it stable: sort by a key without losing the radio order on ties
	function stableSortBy(list, keyFn) {
		return list
			.map((item, index) => ({item, index, key: keyFn(item)}))
			.sort((a, b) => a.key - b.key || a.index - b.index)
			.map((w) => w.item);
	}

	function applyArtists(pool, mode, stats, seedTracks) {
		if (mode === 'random') return shuffle(pool);
		if (mode === 'new') {
			// least-familiar artists first, so a mix leans toward discovery. stats keys artists by lowercased name, so look up the same way
			const fam = familiarityMap(stats);
			return stableSortBy(
				pool,
				(t) =>
					fam[
						String(t.artist || '')
							.trim()
							.toLowerCase()
					] || 0,
			);
		}
		// followed / followedAndQueue: pull preferred artists to the front, keep the rest
		const set = preferredArtistSet(mode === 'followedAndQueue', seedTracks);
		const yes = [];
		const no = [];
		for (const t of pool) (isPreferred(t, set) ? yes : no).push(t);
		return yes.concat(no);
	}

	// reorder so back-to-back tracks tend to be different artists (variety)
	function diversifyByArtist(pool) {
		const buckets = new Map();
		for (const t of pool) {
			const key = artistKeyOf(t);
			if (!buckets.has(key)) buckets.set(key, []);
			buckets.get(key).push(t);
		}
		const out = [];
		let added = true;
		while (added) {
			added = false;
			for (const list of buckets.values()) {
				if (list.length) {
					out.push(list.shift());
					added = true;
				}
			}
		}
		return out;
	}

	function seedArtistSet(seedTracks) {
		const set = new Set();
		for (const t of seedTracks) {
			const id = String(t.artistChannelId || '').trim();
			if (id) set.add(id);
			const name = String(t.artist || '')
				.trim()
				.toLowerCase();
			if (name) set.add(name);
		}
		return set;
	}

	function applyGenre(pool, mode, seedTracks) {
		// no real genre data, so these are honest approximations built on the radio pool - HA! i trolled you
		if (mode === 'shuffleCloser' || mode === 'random') return pool; // radio is already "close"
		if (mode === 'shuffleDifferent') return diversifyByArtist(pool);
		if (mode === 'sameOnly') {
			const set = seedArtistSet(seedTracks);
			const same = pool.filter((t) => isPreferred(t, set));
			return same.length >= 5 ? same : pool; // rela...xxxx if too strict to fill a mix
		}
		return pool;
	}

	// zigzag the pool by track length: short, long, short, long... a gentle "up and down".
	function durationWave(pool) {
		const sorted = stableSortBy(pool, (t) => Number(t.duration || 0));
		const out = [];
		let lo = 0;
		let hi = sorted.length - 1;
		let takeLow = true;
		while (lo <= hi) {
			out.push(takeLow ? sorted[lo++] : sorted[hi--]);
			takeLow = !takeLow;
		}
		return out;
	}

	function applyMood(pool, mode) {
		if (mode === 'random') return shuffle(pool);
		if (mode === 'upDown') return durationWave(pool);
		return pool; // 'consistent' - leave the order the earlier passes settled on
	}

	/* ☆======= the build =======☆ */

	async function fetchPool(seedIds) {
		const res = await fetch(apiBase() + '/mix', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken()},
			body: JSON.stringify({seeds: seedIds, limit: 120}),
		});
		if (!res.ok) throw new Error('mix ' + res.status);
		const data = await res.json();
		return Array.isArray(data.tracks) ? data.tracks : [];
	}

	// take the raw radio pool and do the "smart" part: drop the seeds + skipped tracks, run the three preference passes, cut to size. returns queue tracks (empty if nothing survived)
	async function shapeRadioPool(pool, seedIds, seeds) {
		const stats = window.starlStats ? await window.starlStats.getStats() : null;
		const seedSet = new Set(seedIds);
		const skipSet = skippedVideoIds(stats);
		pool = pool.filter((c) => {
			const vid = videoIdOf(c.url || c.id);
			return vid && !seedSet.has(vid) && !skipSet.has(vid);
		});
		if (!pool.length) return [];

		// the three preference passes, in order: pick artists -> shape variety -> order mood
		const settings = getSettings();
		pool = applyArtists(pool, settings.artists, stats, seeds);
		pool = applyGenre(pool, settings.genre, seeds);
		pool = applyMood(pool, settings.mood);

		// last word goes to your own "more / less / none of this" - drop the blacklisted
		// stuff and gently float boosted things up, debuffed things down
		let queued = pool.map(toQueueTrack);
		const rec = window.starlRecommend;
		if (rec && typeof rec.rankTracks === 'function') queued = rec.rankTracks(queued);
		return queued.slice(0, MAX_TRACKS);
	}

	async function buildMix(seedTracks, label) {
		if (building) return;
		const seeds = (seedTracks || []).filter(Boolean);
		if (!seeds.length) {
			toast('Nothing to build a mix from', 'danger');
			return;
		}

		building = true;
		toast('Building your mix…');
		try {
			const seedIds = [];
			for (const t of seeds) {
				const id = videoIdOf(t.sourceUrl || t.trackKey || t.streamUrl || t.url);
				if (id && !seedIds.includes(id)) seedIds.push(id);
			}
			if (!seedIds.length) {
				toast('That track has no video to mix from', 'danger');
				return;
			}

			const offline = isOffline();

			// online: ask the server for a radio pool and shape it. offline (or a server that hands back nothing) drops us to the library fallback right below
			let mixTracks = null;
			let fromLibrary = false;
			if (!offline) {
				let pool = [];
				try {
					pool = await fetchPool(seedIds);
				} catch (e) {
					pool = [];
				}
				if (pool.length) mixTracks = await shapeRadioPool(pool, seedIds, seeds);
			}

			// no radio (offline, or the server had nothing) -> the "When MIX fails" fallback fills
			// it from your downloads, if you turned it on. the picking lives in mix-fallback.js
			if (!mixTracks || !mixTracks.length) {
				const fallback = window.starlMixFallback;
				if (fallback && typeof fallback.build === 'function' && fallback.getMode() !== 'off') {
					mixTracks = await fallback.build(seeds, seedIds);
					fromLibrary = !!(mixTracks && mixTracks.length);
					// narrate only when the library actually saved it, so we never promise a mix we
					// can't deliver. offline is its own honest line (no connection, not a failed mix);
					// online failure gets the two spaced toasts so both land, in the final one's voice
					if (fromLibrary) {
						if (offline) {
							toast("You're offline - building from your library instead…");
							await sleep(1400);
						} else {
							toast("Couldn't create a mix for that :(", 'danger');
							await sleep(1600);
							toast('Creating a mix based on your library…');
							await sleep(1400);
						}
					}
				}
			}

			if (!mixTracks || !mixTracks.length) {
				toast(offline ? 'Connect to the internet to build a mix' : 'Could not find a mix for that', 'danger');
				return;
			}

			const okToast = fromLibrary ? 'Built a mix from your library :3' : 'Mix ready - enjoy :3';
			// comedy
			async function celebrate() {
				toast(okToast);
				if (fromLibrary) {
					await sleep(1600);
					toast("it isn't the same, but it's definitely a mix lol");
				}
			}
			const queueApi = window.starlPlaybackQueue;
			const pb = window.starlPlaybackState;
			const playingVid = pb ? videoIdOf(pb.currentTrackKey || pb.currentStreamUrl) : '';
			const currentTrack =
				queueApi && typeof queueApi.getCurrentTrack === 'function' ? queueApi.getCurrentTrack() : null;

			// if the song playing right now is one of the seeds, keep it playing and just
			// swap everything after it for the mix - don't interrupt what the user hears - respect!!
			if (playingVid && seedIds.includes(playingVid) && currentTrack && queueApi) {
				queueApi.setQueue([currentTrack, ...mixTracks], 0);
				window.starlPlaybackContext = {type: 'mix', title: label || 'MIX'};
				await celebrate();
				return;
			}

			// otherwise: play the seed track first, then roll straight into the mix
			const head = toPlayableSeed(seeds[0]);
			const fullQueue = head ? [head, ...mixTracks] : mixTracks;
			if (window.starlPlayer && typeof window.starlPlayer.playWithQueue === 'function') {
				window.starlPlayer.playWithQueue(fullQueue, 0, {type: 'mix', title: label || 'MIX'});
				await celebrate();
			}
		} catch (error) {
			toast('Could not build a mix right now', 'danger');
		} finally {
			building = false;
		}
	}

	/* ☆======= public entry points =======☆ */

	function fromTrack(track) {
		if (!track) return;
		buildMix([track], track.title || 'MIX');
	}

	function fromQueue() {
		const queueApi = window.starlPlaybackQueue;
		const queue = queueApi && typeof queueApi.getQueue === 'function' ? queueApi.getQueue() : [];
		if (!queue.length) {
			toast('Your queue is empty', 'danger');
			return;
		}
		buildMix(queue, 'Queue MIX');
	}

	window.starlMix = {fromTrack, fromQueue, buildMix};
	window.starlMixUtil = {
		MAX_TRACKS,
		shuffle,
		videoIdOf,
		artistKeyOf,
		seedArtistSet,
		isPreferred,
		preferredArtistSet,
		skippedVideoIds,
	};
})();

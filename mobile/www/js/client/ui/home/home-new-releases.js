/**
 * ☆=========================================☆
 * Home: New releases - fresh stuff from artists you follow
 * Pulls each followed artist's latest releases and shows the newest on home.
 * Honors the "New releases" choice in Customize Home page.
 *
 * --- What this file does? ---
 * - Reads homeSettings.newReleases: 'none' hides; 'followed' = singles/EPs;
 *   'all' = also includes full albums
 * - Fetches each followed artist once (cached for a while) so it isn't chatty
 * - Sorts everything newest-first and shows the top few; tap opens the release
 *
 * --- Dictionary / Terms / Extra details ---
 * - Needs to be online to fetch; offline it hides the row
 * - Release "year" is the only date the data gives us, so ordering is by year
 * ☆=========================================☆
 */

(function () {
	const SECTION_SELECTOR = '.sec-newreleases';
	const CONTAINER_SELECTOR = '.sec-newreleases .sec-container';
	const MAX_ARTISTS = 6; // don't hammer the server for a huge follow list
	const MAX_CARDS = 12;
	const CACHE_TTL_MS = 30 * 60 * 1000; // an artist's releases don't change often

	// channelId -> { at, name, releases:[{id,title,year,thumbnail,type}] }
	const cache = new Map();
	let lastKey = '';
	let rendering = false;

	function common() {
		return window.starlHomeCommon;
	}

	function apiBase() {
		return typeof getApiBase === 'function' ? getApiBase() : '';
	}

	function accessToken() {
		return typeof getAccessToken === 'function'
			? getAccessToken()
			: localStorage.getItem('starl_access_token') || '';
	}

	function followedArtists() {
		const api = window.starlFollows;
		const list = api && typeof api.getFollowedArtists === 'function' ? api.getFollowedArtists() : [];
		return (list || []).filter((a) => a && a.id).slice(0, MAX_ARTISTS);
	}

	async function fetchArtist(channelId) {
		const cached = cache.get(channelId);
		if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
		const res = await fetch(apiBase() + '/artist?channel_id=' + encodeURIComponent(channelId), {
			headers: {Authorization: 'Bearer ' + accessToken()},
		});
		if (!res.ok) throw new Error('artist ' + res.status);
		const data = await res.json();
		const entry = {
			at: Date.now(),
			name: data.name || '',
			albums: Array.isArray(data.albums) ? data.albums : [],
			singles: Array.isArray(data.singles) ? data.singles : [],
		};
		cache.set(channelId, entry);
		return entry;
	}

	function openRelease(release, artistName) {
		const page = window.starlArtistPage;
		if (page && typeof page.openServerAlbum === 'function') {
			page.openServerAlbum({
				id: release.id,
				title: release.title,
				thumbnail: release.thumbnail,
				artist: artistName,
			});
		}
	}

	function makeCard(release, artistName, index) {
		const card = document.createElement('div');
		card.className = 'snr-item';
		card.style.animationDelay = index * 35 + 'ms';

		const bg = document.createElement('div');
		bg.className = 'snr-item-bg';
		common().setCover(bg, release.thumbnail);

		const gradient = document.createElement('div');
		gradient.className = 'snr-item-gradient';

		const sub = document.createElement('div');
		sub.className = 'snr-item-time-artist';
		sub.textContent = artistName + (release.year ? ' · ' + release.year : '');

		const title = document.createElement('div');
		title.className = 'snr-item-title';
		title.textContent = release.title || 'Release';

		card.appendChild(bg);
		card.appendChild(gradient);
		card.appendChild(sub);
		card.appendChild(title);
		card.addEventListener('click', () => openRelease(release, artistName));
		return card;
	}

	function hide() {
		const section = document.querySelector(SECTION_SELECTOR);
		if (common() && section) common().showRow(section, false);
	}

	async function render() {
		const section = document.querySelector(SECTION_SELECTOR);
		const container = document.querySelector(CONTAINER_SELECTOR);
		if (!section || !container || !common() || rendering) return;

		const mode = common().getHomeSetting('newReleases');
		if (mode === 'none') {
			hide();
			return;
		}
		const artists = followedArtists();
		if (!artists.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
			hide();
			return;
		}

		// skip the network if nothing changed and we still have cards up
		const key = mode + '|' + artists.map((a) => a.id).join(',');
		if (key === lastKey && container.childElementCount > 0) {
			common().showRow(section, true);
			return;
		}

		rendering = true;
		try {
			const fetched = await Promise.all(
				artists.map((a) =>
					fetchArtist(a.id)
						.then((d) => ({info: a, data: d}))
						.catch(() => null),
				),
			);

			const releases = [];
			const seen = new Set();
			fetched.forEach((f) => {
				if (!f) return;
				const artistName = f.data.name || f.info.name || '';
				const pool = mode === 'all' ? f.data.singles.concat(f.data.albums) : f.data.singles;
				pool.forEach((r) => {
					if (r && r.id && !seen.has(r.id)) {
						seen.add(r.id);
						releases.push({release: r, artistName});
					}
				});
			});
			releases.sort((a, b) => (Number(b.release.year) || 0) - (Number(a.release.year) || 0));

			const top = releases.slice(0, MAX_CARDS);
			if (!top.length) {
				hide();
				return;
			}
			container.innerHTML = '';
			top.forEach((item, i) => container.appendChild(makeCard(item.release, item.artistName, i)));
			lastKey = key;
			common().showRow(section, true);
		} catch (error) {
			hide();
		} finally {
			rendering = false;
		}
	}

	function init() {
		render();
		window.addEventListener('starl-home-settings-changed', render);
		window.addEventListener('starl-account-state-updated', render);
		window.addEventListener('starl-follows-updated', render);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}
})();

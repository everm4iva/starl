/**
 * ☆=========================================☆
 * Home: Recommended row - "because you played..." suggestions
 * Seeds a small radio pool from your most recent listen and shows a few similar
 * tracks on the home tab. Honors the "General" choice in Customize Home page.
 *
 * --- What this file does? ---
 * - Reads homeSettings.general: 'none' hides the row, 'lastTrack'/'lastArtist' fill it
 * - Uses the same /mix pool the Create MIX feature uses, seeded by your last track
 * - Re-renders when your history changes or you change the Customize Home setting
 * - Only refetches when the seed actually changes (no spamming the server)
 *
 * --- Dictionary / Terms / Extra details ---
 * - Needs to be online to fetch; offline it just hides the row (never shows empty)
 * ☆=========================================☆
 */

(function () {
	const SECTION_SELECTOR = '.sec-recommended';
	const CONTAINER_SELECTOR = '.sec-recommended .sec-container';
	const LABEL_SELECTOR = '.sec-recommended .sec-phrase-text';
	const MAX_CARDS = 10;

	let lastKey = '';

	function common() {
		return window.starlHomeCommon;
	}

	function apiBase() {
		return typeof getApiBase === 'function' ? getApiBase() : '';
	}

	function accessToken() {
		return typeof getAccessToken === 'function' ? getAccessToken() : localStorage.getItem('starl_access_token') || '';
	}

	function videoIdOf(value) {
		const s = String(value || '').trim();
		const byParam = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
		if (byParam) return byParam[1];
		const byPath = s.match(/\/([A-Za-z0-9_-]{11})(?:[?&#]|$)/);
		if (byPath) return byPath[1];
		if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
		return '';
	}

	function newestListen() {
		const api = window.starlHistory;
		const all = api && typeof api.getAll === 'function' ? api.getAll() : [];
		return all && all.length ? all[0] : null;
	}

	function playTrack(item) {
		if (window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
			window.starlPlayer.playFromSearch({
				url: item.sourceUrl || item.url || '',
				sourceUrl: item.sourceUrl || item.url || '',
				trackKey: item.trackKey || item.sourceUrl || item.url || '',
				streamUrl: '',
				title: item.title,
				artist: item.artist,
				album: item.album || '',
				thumbnail: item.imageUrl || item.thumbnail || '',
				imageUrl: item.imageUrl || item.thumbnail || '',
				duration: item.duration || 0,
			});
		}
	}

	function makeCard(track, index) {
		const card = document.createElement('div');
		card.className = 'snr-item';
		card.style.animationDelay = index * 35 + 'ms';

		const bg = document.createElement('div');
		bg.className = 'snr-item-bg';
		common().setCover(bg, track.imageUrl || track.thumbnail);

		const gradient = document.createElement('div');
		gradient.className = 'snr-item-gradient';

		const sub = document.createElement('div');
		sub.className = 'snr-item-time-artist';
		sub.textContent = 'by ' + (track.artist || 'Unknown artist');

		const title = document.createElement('div');
		title.className = 'snr-item-title';
		title.textContent = track.title || 'Untitled';

		card.appendChild(bg);
		card.appendChild(gradient);
		card.appendChild(sub);
		card.appendChild(title);

		card.addEventListener('click', () => playTrack(track));
		// home is the recommendation surface, so hovering a card gives you the little
		// "Recommend:" menu (more/less/none) instead of the full track sheet
		const recMenu = window.starlRecommendMenu;
		if (recMenu && typeof recMenu.bindCard === 'function') recMenu.bindCard(card, () => track, 'track');
		return card;
	}

	function toTrack(candidate) {
		const url = candidate.url || candidate.sourceUrl || '';
		return {
			title: candidate.title || 'Untitled',
			artist: candidate.artist || 'Unknown artist',
			album: candidate.album || '',
			imageUrl: candidate.thumbnail || candidate.imageUrl || '',
			sourceUrl: url,
			trackKey: url || candidate.id || '',
			duration: Number(candidate.duration || 0) || 0,
			artistChannelId: candidate.artistChannelId || '',
			albumId: candidate.albumId || '',
		};
	}

	async function fetchPool(seedId) {
		const res = await fetch(apiBase() + '/mix', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken()},
			body: JSON.stringify({seeds: [seedId], limit: 30}),
		});
		if (!res.ok) throw new Error('mix ' + res.status);
		const data = await res.json();
		return Array.isArray(data.tracks) ? data.tracks : [];
	}

	function hide() {
		const section = document.querySelector(SECTION_SELECTOR);
		if (common() && section) common().showRow(section, false);
	}

	async function render() {
		const section = document.querySelector(SECTION_SELECTOR);
		const container = document.querySelector(CONTAINER_SELECTOR);
		if (!section || !container || !common()) return;

		const mode = common().getHomeSetting('general');
		if (mode === 'none') {
			hide();
			return;
		}

		const seed = newestListen();
		const seedId = seed ? videoIdOf(seed.sourceUrl || seed.trackKey || seed.streamUrl) : '';
		if (!seedId || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
			hide();
			return;
		}

		// don't refetch if nothing meaningful changed since last render
		const key = mode + '|' + seedId;
		if (key === lastKey && container.childElementCount > 0) {
			common().showRow(section, true);
			return;
		}

		try {
			const pool = await fetchPool(seedId);
			let tracks = pool.filter((c) => videoIdOf(c.url || c.id) !== seedId).map(toTrack);
			// let your prefs have a say before we trim to the visible few: blacklisted +
			// hidden stuff falls out, boosted stuff floats up
			const rec = window.starlRecommend;
			if (rec && typeof rec.rankTracks === 'function') tracks = rec.rankTracks(tracks);
			tracks = tracks.slice(0, MAX_CARDS);
			if (!tracks.length) {
				hide();
				return;
			}
			const label = document.querySelector(LABEL_SELECTOR);
			if (label) {
				label.textContent =
					mode === 'lastArtist' ? 'More like ' + (seed.artist || 'this') : 'Because you played ' + '"' + (seed.title || 'that') + '"';
			}
			container.innerHTML = '';
			tracks.forEach((t, i) => container.appendChild(makeCard(t, i)));
			lastKey = key;
			common().showRow(section, true);
		} catch (error) {
			hide();
		}
	}

	function init() {
		render();
		window.addEventListener('starl-history-updated', render);
		window.addEventListener('starl-home-settings-changed', render);
		window.addEventListener('starl-account-state-updated', render);
		// prefs changed force a rebuild even if the seed's the same
		window.addEventListener('starl-recommend-updated', () => {
			lastKey = '';
			render();
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}
})();

/**
 * ☆=========================================☆
 * Home: Pick up albums - albums you've been into lately
 * Reads your listening score and resurfaces the albums you click/play the most.
 * Honors the "Pick up albums" yes/no in Customize Home page.
 *
 * --- What this file does? ---
 * - Reads homeSettings.pickAlbums: 'no' hides the row, 'yes' fills it
 * - Ranks albums from your stats by (listened seconds + clicks) and shows the top few
 * - Tapping a card opens that album (server album by id, or a local album by name)
 * - Refreshes on setting change / after you listen (throttled so it isn't chatty)
 * ☆=========================================☆
 */

(function () {
	const SECTION_SELECTOR = '.sec-album';
	const CONTAINER_SELECTOR = '.sec-album .sec-container';
	const MAX_CARDS = 10;
	const MIN_REFETCH_MS = 15000;

	let lastFetch = 0;
	let fetching = false;

	function common() {
		return window.starlHomeCommon;
	}

	// rank: seconds matter most, a click is worth ~30s of intent. your "more/less of this"
	// then leans the score up or down so what you asked for actually shows through
	function scoreOf(entry) {
		const base = (entry.seconds || 0) + (entry.clicks || 0) * 30;
		const rec = window.starlRecommend;
		const factor = rec && typeof rec.factorForName === 'function' ? rec.factorForName('album', entry.title) : 1;
		return base * factor;
	}

	// blacklisted, or just "don't wanna see" for this session - either way, skip it
	function isHushed(entry) {
		const rec = window.starlRecommend;
		if (!rec) return false;
		const blocked = typeof rec.isBlockedName === 'function' && rec.isBlockedName('album', entry.title);
		const hidden = typeof rec.isHidden === 'function' && rec.isHidden('album', {album: entry.title});
		return Boolean(blocked || hidden);
	}

	function openAlbum(entry) {
		const page = window.starlArtistPage;
		if (!page) return;
		// only a real album browse id (MPRE...) works with the server album endpoint;
		// anything else would just come back as "0 tracks", so don't send it there
		const id = String(entry.albumId || '').trim();
		if (id.startsWith('MPRE') && typeof page.openServerAlbum === 'function') {
			page.openServerAlbum({id, title: entry.title, thumbnail: entry.imageUrl, artist: entry.artist});
			return;
		}
		// no usable server id: match a local album by name instead
		const native = window.starlLibraryNative;
		const local = native && typeof native.getAlbumList === 'function'
			? (native.getAlbumList() || []).find((a) => (a.name || '').toLowerCase() === (entry.title || '').toLowerCase())
			: null;
		if (local && typeof page.openLocalAlbum === 'function') page.openLocalAlbum(local);
	}

	function makeCard(entry, index) {
		const card = document.createElement('div');
		card.className = 'sa-item';
		card.style.animationDelay = index * 35 + 'ms';

		const bg = document.createElement('div');
		bg.className = 'sa-item-bg';
		common().setCover(bg, entry.imageUrl);

		const gradient = document.createElement('div');
		gradient.className = 'sa-item-gradient';

		// album cards show the cover + the album name only - nothing else
		const title = document.createElement('div');
		title.className = 'sa-item-title';
		title.textContent = entry.title || 'Album';

		card.appendChild(bg);
		card.appendChild(gradient);
		card.appendChild(title);
		card.addEventListener('click', () => openAlbum(entry));
		// hover for the little "Recommend:" menu - lets you boost/less/none a whole album
		const recMenu = window.starlRecommendMenu;
		if (recMenu && typeof recMenu.bindCard === 'function') {
			recMenu.bindCard(
				card,
				() => ({album: entry.title, title: entry.title, artist: entry.artist, imageUrl: entry.imageUrl, albumId: entry.albumId}),
				'album',
			);
		}
		return card;
	}

	function hide() {
		const section = document.querySelector(SECTION_SELECTOR);
		if (common() && section) common().showRow(section, false);
	}

	async function render() {
		const section = document.querySelector(SECTION_SELECTOR);
		const container = document.querySelector(CONTAINER_SELECTOR);
		if (!section || !container || !common()) return;

		if (common().getHomeSetting('pickAlbums') === 'no') {
			hide();
			return;
		}
		if (fetching || Date.now() - lastFetch < MIN_REFETCH_MS) return;
		if (!window.starlStats || typeof window.starlStats.getStats !== 'function') {
			hide();
			return;
		}

		fetching = true;
		try {
			const stats = await window.starlStats.getStats();
			lastFetch = Date.now();
			const albums = (stats && stats.albums) || {};
			// only show albums we have a cover for - a card is a cover + a name, so a
			// coverless entry (e.g. one that only ever got listen-time, no open) is skipped
			const ranked = Object.values(albums)
				.filter((e) => (e.imageUrl || '').trim() && (e.title || '').trim())
				.filter((e) => !isHushed(e))
				.sort((a, b) => scoreOf(b) - scoreOf(a))
				.slice(0, MAX_CARDS);
			if (!ranked.length) {
				hide();
				return;
			}
			container.innerHTML = '';
			ranked.forEach((entry, i) => container.appendChild(makeCard(entry, i)));
			common().showRow(section, true);
		} catch (error) {
			hide();
		} finally {
			fetching = false;
		}
	}

	function init() {
		render();
		window.addEventListener('starl-home-settings-changed', () => {
			lastFetch = 0; // a setting flip should refresh right away
			render();
		});
		window.addEventListener('starl-history-updated', render);
		window.addEventListener('starl-account-state-updated', render);
		// a boost/less/none should reshuffle this row right away
		window.addEventListener('starl-recommend-updated', () => {
			lastFetch = 0;
			render();
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}
})();

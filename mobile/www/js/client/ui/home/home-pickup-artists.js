/**
 * ☆=========================================☆
 * Home: Pick up artists - artists you've been into lately
 * Reads your listening score and resurfaces the artists you open/play the most.
 * Honors the "Pick up artists" yes/no in Customize Home page.
 *
 * --- What this file does? ---
 * - Reads homeSettings.pickArtists: 'no' hides the row, 'yes' fills it
 * - Ranks artists from your stats by (listened seconds + page opens) and shows the top few
 * - Tapping a card opens that artist's page
 * - Refreshes on setting change / after you listen (throttled)
 * ☆=========================================☆
 */

(function () {
	const SECTION_SELECTOR = '.sec-artists';
	const CONTAINER_SELECTOR = '.sec-artists .sec-container';
	const MAX_CARDS = 12;
	const MIN_REFETCH_MS = 15000;

	let lastFetch = 0;
	let fetching = false;

	function common() {
		return window.starlHomeCommon;
	}

	// "artists you love" = who you actually listen to. listened time leads, opens are a
	// tiebreaker, and your "more/less of this" leans the whole score up or down
	function scoreOf(entry) {
		const base = (entry.seconds || 0) + (entry.opens || 0);
		const rec = window.starlRecommend;
		const factor = rec && typeof rec.factorForName === 'function' ? rec.factorForName('artist', entry.name) : 1;
		return base * factor;
	}

	// blacklisted, or just "don't wanna see" for this session - either way, skip it
	function isHushed(entry) {
		const rec = window.starlRecommend;
		if (!rec) return false;
		const blocked = typeof rec.isBlockedName === 'function' && rec.isBlockedName('artist', entry.name);
		const hidden = typeof rec.isHidden === 'function' && rec.isHidden('artist', {name: entry.name});
		return Boolean(blocked || hidden);
	}

	function openArtist(entry) {
		const page = window.starlArtistPage;
		if (!page || typeof page.openArtist !== 'function') return;
		page.openArtist({name: entry.name, channelId: entry.channelId || '', imageUrl: entry.imageUrl || '', tracks: []});
	}

	function makeCard(entry, index) {
		const card = document.createElement('div');
		card.className = 'sart-item';
		card.style.animationDelay = index * 35 + 'ms';

		const bg = document.createElement('div');
		bg.className = 'sart-item-bg';
		common().setCover(bg, entry.imageUrl);

		const title = document.createElement('div');
		title.className = 'sart-item-title';
		title.textContent = entry.name || 'Artist';

		card.appendChild(bg);
		card.appendChild(title);
		card.addEventListener('click', () => openArtist(entry));
		// hover for the little "Recommend:" menu - boost/less/none this whole artist
		const recMenu = window.starlRecommendMenu;
		if (recMenu && typeof recMenu.bindCard === 'function') {
			recMenu.bindCard(
				card,
				() => ({name: entry.name, artist: entry.name, imageUrl: entry.imageUrl, channelId: entry.channelId}),
				'artist',
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

		if (common().getHomeSetting('pickArtists') === 'no') {
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
			const artists = (stats && stats.artists) || {};
			// only show artists we have a photo for, so every card looks JUST right :3
			const ranked = Object.values(artists)
				.filter((e) => (e.imageUrl || '').trim() && (e.name || '').trim())
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
			lastFetch = 0;
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

/**
 * ☆=========================================☆
 * Configure content page - the full-screen home for your recommendation prefs
 * Opened from "Configure content" (Account -> Recommendation system) or from the little
 * Recommend menu. Three simple tabs sitting on top of recommend-prefs.js + your stats.
 *
 * --- What this file does? ---
 * - General: a cute overview of what you actually enjoy - top followed artists, albums
 *   and tracks, flipped between "by hours" and "by clicks"
 * - Removed: every blacklisted thing (None of this). hover one for 4 seconds to let it
 *   back in
 * - Recommending: everything you boosted or debuffed by hand, each showing how hard.
 *   click a row for the slider + boost/debuff/remove controls
 *
 * --- Dictionary / Terms / Extra details ---
 * - built like storage-page.js: one .cfg-page overlay, a topbar, a tab strip, a scroll
 * - all the numbers + persistence come from window.starlRecommend, never from here
 * - styles live in styles/tabs/configure-content.css
 * ☆=========================================☆
 */

(function () {
	const TABS = [
		{id: 'general', label: 'General'},
		{id: 'removed', label: 'Removed'},
		{id: 'recommending', label: 'Recommending'},
	];
	const REMOVED_PER_COLUMN = 5; // how many show before the "See more" button
	const HOLD_TO_CLEAR_MS = 4000; // hover a removed item this long to let it back in

	let overlayEl = null;
	let bodyEl = null;
	let activeTab = 'general';
	let metric = 'hours'; // General overview: 'hours' | 'clicks'
	let activeItemMenu = null;

	/* ☆======= tiny helpers =======☆ */

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function recommend() {
		return window.starlRecommend || null;
	}

	function setCover(node, url, shapeCls) {
		node.className = 'cfg-cover ' + (shapeCls || '');
		const cache = window.starlMediaCache;
		if (url && cache && typeof cache.setImageEl === 'function') {
			cache.setImageEl(node, url, {variant: 'low'});
		} else if (url) {
			node.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
		}
	}

	// track -> rounded square, artist -> circle, album -> less-rounded square
	function shapeFor(kind) {
		if (kind === 'artist') return 'shape-artist';
		if (kind === 'album') return 'shape-album';
		return 'shape-track';
	}

	// a level like 3 or -5 -> "30%" / "50%" (each whole step is about 10%)
	function percentText(level) {
		return Math.round(Math.abs(Number(level) || 0) * 10) + '%';
	}

	/* ☆======= General tab: the overview =======☆ */

	function followedNames() {
		const api = window.starlFollows;
		const list = api && typeof api.getFollowedArtists === 'function' ? api.getFollowedArtists() : [];
		const set = new Set();
		(list || []).forEach((a) => {
			if (a && a.name) set.add(String(a.name).trim().toLowerCase());
		});
		return set;
	}

	// pick the metric value out of one stats entry, depending on the toggle
	function valueOf(entry, kind) {
		if (metric === 'hours') return Number(entry.seconds || 0) / 3600;
		if (kind === 'artist') return Number(entry.opens || 0);
		if (kind === 'album') return Number(entry.clicks || 0);
		return Number(entry.plays || entry.clicks || 0);
	}

	function valueLabel(value) {
		if (metric === 'hours') return value.toFixed(1) + 'h';
		return Math.round(value) + (value === 1 ? ' click' : ' clicks');
	}

	// one little colored section (Top artists / Top albums / Top tracks)
	function overviewSection(title, colorVar, rows, kind) {
		const box = el('div', 'cfg-ov-box');
		box.style.setProperty('--cfg-ov-color', 'var(' + colorVar + ')');
		box.appendChild(el('div', 'cfg-ov-title', title));
		if (!rows.length) {
			box.appendChild(el('div', 'cfg-ov-empty', 'Nothing here yet'));
			return box;
		}
		rows.forEach((row, i) => {
			const line = el('div', 'cfg-ov-row');
			line.appendChild(el('div', 'cfg-ov-rank', String(i + 1)));
			const cover = el('div');
			setCover(cover, row.imageUrl, shapeFor(kind) + ' cfg-ov-cover');
			line.appendChild(cover);
			line.appendChild(el('div', 'cfg-ov-name', row.name));
			line.appendChild(el('div', 'cfg-ov-value', valueLabel(row.value)));
			box.appendChild(line);
		});
		return box;
	}

	// opts.filter (optional) runs BEFORE we cut to the top few - so e.g. "followed only"
	// narrows the pool first, then we pick the top 5 out of what's left (not the other way
	// around, which would grab the top 5 and then maybe toss most of them out)
	function topFrom(bucket, kind, nameKey, opts) {
		const keep = (opts && opts.keep) || 5;
		const pre = opts && typeof opts.filter === 'function' ? opts.filter : null;
		return Object.values(bucket || {})
			.map((e) => ({
				name: String(e[nameKey] || e.title || e.name || '').trim(),
				imageUrl: e.imageUrl || '',
				value: valueOf(e, kind),
				raw: e,
			}))
			.filter((e) => e.name && e.value > 0)
			.filter((e) => (pre ? pre(e) : true))
			.sort((a, b) => b.value - a.value)
			.slice(0, keep);
	}

	async function buildGeneral(scroll) {
		// the metric toggle - hours vs clicks, kept cute and tiny
		const toggle = el('div', 'cfg-metric-toggle');
		['hours', 'clicks'].forEach((m) => {
			const btn = el('div', 'cfg-metric-btn' + (metric === m ? ' is-on' : ''), m === 'hours' ? 'By hours' : 'By clicks');
			btn.addEventListener('click', () => {
				if (metric === m) return;
				metric = m;
				renderTab();
			});
			toggle.appendChild(btn);
		});
		scroll.appendChild(toggle);

		const statsApi = window.starlStats;
		const stats = statsApi && typeof statsApi.getStats === 'function' ? await statsApi.getStats() : null;
		if (!stats) {
			scroll.appendChild(el('div', 'cfg-empty', 'No listening data yet - go play some music :3'));
			return;
		}

		// artists: followed only, like the spec asks - narrow to followed first, then rank
		const followed = followedNames();
		const artistRows = topFrom(stats.artists, 'artist', 'name', {
			filter: (r) => followed.has(r.name.toLowerCase()),
		});

		scroll.appendChild(overviewSection('Top artists', '--user-accentcolor-artists', artistRows, 'artist'));
		scroll.appendChild(overviewSection('Top albums', '--user-accentcolor-albums', topFrom(stats.albums, 'album', 'title'), 'album'));
		scroll.appendChild(overviewSection('Top tracks', '--user-accentcolor-music', topFrom(stats.tracks, 'track', 'title'), 'track'));
	}

	/* ☆======= Removed tab: the blacklist =======☆ */

	function buildRemoved(scroll) {
		const api = recommend();
		const blocked = api ? api.listBlocked() : [];
		if (!blocked.length) {
			scroll.appendChild(el('div', 'cfg-empty', 'Nothing removed - your blacklist is empty :3'));
			return;
		}

		scroll.appendChild(
			el('div', 'cfg-hint', 'These never show up in recommendations. Hover one for 4 seconds to let it back in.'),
		);

		const grid = el('div', 'cfg-removed-grid');
		let expanded = false;

		function paint() {
			grid.textContent = '';
			const show = expanded ? blocked : blocked.slice(0, REMOVED_PER_COLUMN);
			show.forEach((entry) => grid.appendChild(makeRemovedTile(entry)));
		}

		scroll.appendChild(grid);
		paint();

		if (blocked.length > REMOVED_PER_COLUMN) {
			const more = el('div', 'cfg-seemore', 'See more');
			more.addEventListener('click', () => {
				expanded = !expanded;
				more.textContent = expanded ? 'See less' : 'See more';
				paint();
			});
			scroll.appendChild(more);
		}
	}

	// one removed thing. hold your cursor on it for 4s and a ring fills up - when it's
	// full, the thing is un-blocked and pops away
	function makeRemovedTile(entry) {
		const meta = entry.meta || {};
		const tile = el('div', 'cfg-removed-tile');
		const cover = el('div');
		setCover(cover, meta.imageUrl, shapeFor(entry.kind) + ' cfg-removed-cover');
		tile.appendChild(cover);
		tile.appendChild(el('div', 'cfg-removed-name', meta.title || 'Untitled'));
		const ring = el('div', 'cfg-removed-ring');
		tile.appendChild(ring);

		let timerId = null;
		function start() {
			ring.classList.add('is-filling');
			timerId = setTimeout(() => {
				const api = recommend();
				if (api) api.removeItem(entry.key);
				if (typeof window.starlExplodeViolently === 'function') window.starlExplodeViolently(tile, {});
				else tile.remove();
			}, HOLD_TO_CLEAR_MS);
		}
		function stop() {
			ring.classList.remove('is-filling');
			if (timerId) {
				clearTimeout(timerId);
				timerId = null;
			}
		}
		tile.addEventListener('pointerenter', start);
		tile.addEventListener('pointerleave', stop);
		tile.addEventListener('pointercancel', stop);
		return tile;
	}

	/* ☆======= Recommending tab: your manual boosts/debuffs =======☆ */

	function buildRecommending(scroll) {
		const api = recommend();
		const items = api ? api.listItems() : [];
		if (!items.length) {
			scroll.appendChild(el('div', 'cfg-empty', 'You have not boosted or debuffed anything yet :3'));
			return;
		}
		// strongest first, so the stuff you feel most about sits up top
		items.sort((a, b) => Math.abs(b.level) - Math.abs(a.level));
		const list = el('div', 'cfg-rec-list');
		items.forEach((item) => list.appendChild(makeRecRow(item)));
		scroll.appendChild(list);
	}

	function makeRecRow(item) {
		const meta = item.meta || {};
		const level = Number(item.level) || 0;
		const boosted = level >= 0;

		const row = el('div', 'cfg-rec-row');

		const cover = el('div');
		setCover(cover, meta.imageUrl, shapeFor(item.kind) + ' cfg-rec-cover');
		row.appendChild(cover);

		const info = el('div', 'cfg-rec-info');
		info.appendChild(el('div', 'cfg-rec-title', meta.title || 'Untitled'));

		// tracks show the boost/debuff badge; artists/albums just show what they are
		const sub = el('div', 'cfg-rec-sub');
		if (item.kind === 'track') {
			const badge = el('div', 'cfg-rec-badge ' + (boosted ? 'is-up' : 'is-down'));
			badge.appendChild(el('div', 'cfg-rec-arrow ' + (boosted ? 'rec-ico-up' : 'rec-ico-down')));
			badge.appendChild(el('span', 'cfg-rec-pct', percentText(level)));
			sub.appendChild(badge);
			if (meta.artist) sub.appendChild(el('span', 'cfg-rec-artist', meta.artist));
		} else {
			const badge = el('div', 'cfg-rec-badge ' + (boosted ? 'is-up' : 'is-down'));
			badge.appendChild(el('div', 'cfg-rec-arrow ' + (boosted ? 'rec-ico-up' : 'rec-ico-down')));
			badge.appendChild(el('span', 'cfg-rec-pct', percentText(level)));
			sub.appendChild(badge);
			sub.appendChild(el('span', 'cfg-rec-artist', item.kind === 'artist' ? 'Artist' : 'Album'));
		}
		info.appendChild(sub);
		row.appendChild(info);

		row.addEventListener('click', (e) => {
			e.stopPropagation();
			openItemMenu(row, item);
		});
		return row;
	}

	/* ☆======= the per-item menu (slider + boost/debuff/remove) =======☆ */

	function closeItemMenu() {
		if (activeItemMenu) activeItemMenu.remove();
		activeItemMenu = null;
	}

	function openItemMenu(anchor, item) {
		closeItemMenu();
		const api = recommend();
		if (!api) return;
		const limits = api.limits || {MIN_SLIDER: 0.5, MAX_LEVEL: 7};

		const menu = el('div', 'cfg-item-menu');

		// no title, just a plain-spoken description of what boosting even does
		menu.appendChild(
			el(
				'div',
				'cfg-item-desc',
				'Boosting shows this more without stealing room from everything else. It slides back to normal on its own if you stop reaching for it.',
			),
		);

		// the slider - magnitude only, 0.5x .. 7x, matching the brain's own limits
		const sliderRow = el('div', 'cfg-item-slider-row');
		const slider = document.createElement('input');
		slider.type = 'range';
		slider.className = 'appr-slider cfg-item-slider';
		slider.min = String(limits.MIN_SLIDER);
		slider.max = String(limits.MAX_LEVEL);
		slider.step = '0.5';
		slider.value = String(Math.abs(Number(item.level) || limits.MIN_SLIDER));
		const readout = el('span', 'cfg-item-readout', slider.value + 'x');
		slider.addEventListener('input', () => {
			readout.textContent = slider.value + 'x';
		});
		slider.addEventListener('change', () => {
			api.setMagnitude(item.key, Number(slider.value));
		});
		sliderRow.appendChild(slider);
		sliderRow.appendChild(readout);
		menu.appendChild(sliderRow);

		function action(label, cls, handler) {
			const btn = el('div', 'cfg-item-action' + (cls ? ' ' + cls : ''), label);
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				handler();
				closeItemMenu();
			});
			menu.appendChild(btn);
		}

		action('Remove item', 'danger', () => api.removeItem(item.key));
		action('Boost more (x2)', '', () => api.bumpKey(item.key, +1));
		action('Debuff more (x2)', '', () => api.bumpKey(item.key, -1));

		document.body.appendChild(menu);
		activeItemMenu = menu;
		const rect = anchor.getBoundingClientRect();
		menu.style.position = 'fixed';
		menu.style.top = String(Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8)) + 'px';
		menu.style.left = String(Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))) + 'px';
		menu.addEventListener('click', (e) => e.stopPropagation());
		setTimeout(() => window.addEventListener('click', closeItemMenu, {once: true}), 0);
	}

	/* ☆======= tab shell =======☆ */

	function renderTab() {
		if (!bodyEl) return;
		closeItemMenu();
		bodyEl.textContent = '';
		const scroll = el('div', 'cfg-scroll');
		bodyEl.appendChild(scroll);

		if (activeTab === 'general') buildGeneral(scroll);
		else if (activeTab === 'removed') buildRemoved(scroll);
		else buildRecommending(scroll);

		// keep the tab strip lit on the right one
		overlayEl.querySelectorAll('.cfg-tab').forEach((t) => {
			t.classList.toggle('is-active', t.dataset.tab === activeTab);
		});
	}

	function ensureDOM() {
		if (overlayEl) return;
		overlayEl = el('div', 'cfg-page hidden');

		const topbar = el('div', 'cfg-topbar');
		const back = el('div', 'cfg-back');
		back.addEventListener('click', close);
		topbar.appendChild(back);
		topbar.appendChild(el('div', 'cfg-title', 'Configure content'));
		overlayEl.appendChild(topbar);

		const tabs = el('div', 'cfg-tabs');
		TABS.forEach((tab) => {
			const btn = el('div', 'cfg-tab', tab.label);
			btn.dataset.tab = tab.id;
			btn.addEventListener('click', () => {
				activeTab = tab.id;
				renderTab();
			});
			tabs.appendChild(btn);
		});
		overlayEl.appendChild(tabs);

		bodyEl = el('div', 'cfg-body');
		overlayEl.appendChild(bodyEl);
		document.body.appendChild(overlayEl);

		// another device (or the sweep) changed something while we're open - redraw
		window.addEventListener('starl-recommend-updated', () => {
			if (overlayEl && !overlayEl.classList.contains('hidden')) renderTab();
		});
	}

	/* ☆======= open / close =======☆ */

	function open(tabId) {
		ensureDOM();
		if (tabId && TABS.some((t) => t.id === tabId)) activeTab = tabId;
		overlayEl.classList.remove('hidden');
		renderTab();
	}

	function close() {
		closeItemMenu();
		if (overlayEl) overlayEl.classList.add('hidden');
	}

	// let the Android back button pop this like it pops the other full pages
	function closeTop() {
		if (overlayEl && !overlayEl.classList.contains('hidden')) {
			close();
			return true;
		}
		return false;
	}

	/* ☆======= boot =======☆ */

	function wireButton() {
		const item = document.getElementById('configure-content-item');
		if (item) item.addEventListener('click', () => open());
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', wireButton, {once: true});
	} else {
		wireButton();
	}

	window.starlConfigureContent = {open, close, closeTop};
})();

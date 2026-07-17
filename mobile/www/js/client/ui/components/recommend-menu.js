/**
 * ☆=========================================☆
 * Recommend menu - the little "Recommend:" popup you get on home cards
 * Hover (or long-press / right-click) a recommended track, artist, or album and this
 * pops a tiny menu that talks straight to recommend-prefs.js. No descriptions, no
 * clutter - just the five things you might want to say about a thing.
 *
 * --- What this file does? ---
 * - bindCard(el, getItem, kind): wire hover + long-press + right-click on a home card
 * - builds: More of this / Less of this / None of this  (--- line ---)  Don't wanna
 *   see / Configure content
 * - "Don't wanna see" quietly explodes the card away for this session
 * - closes when you tap anywhere outside it
 *
 * --- Dictionary / Terms / Extra details ---
 * - kind is 'track' | 'artist' | 'album' - decides which pref bucket the action hits
 * - getItem() returns the normalized thing (a track/artist/album object) at click time
 * - styles live in recommend-menu.css (.rec-menu / .rec-menu-item / .rec-menu-sep)
 * ☆=========================================☆
 */

(function () {
	const HOVER_DELAY_MS = 800; // long enough that a passing cursor doesn't pop it

	let activeMenuEl = null;
	let hoverTimerId = null;

	function recommend() {
		return window.starlRecommend || null;
	}

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function closeMenu() {
		if (activeMenuEl) activeMenuEl.remove();
		activeMenuEl = null;
	}

	function clearHoverTimer() {
		if (hoverTimerId) {
			clearTimeout(hoverTimerId);
			hoverTimerId = null;
		}
	}

	/* ☆======= build =======☆ */

	// one row: an icon square + a label. iconCls maps to a background-image in the css
	function makeItem(iconCls, label, handler) {
		const row = el('div', 'rec-menu-item');
		row.appendChild(el('div', 'rec-menu-icon ' + iconCls));
		row.appendChild(el('div', 'rec-menu-label', label));
		row.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			handler();
			closeMenu();
		});
		return row;
	}

	// the card that opened us, so "Don't wanna see" can pop the right element away
	function buildMenu(kind, item, cardEl) {
		const api = recommend();
		const menu = el('div', 'rec-menu');

		menu.appendChild(el('div', 'rec-menu-title', 'Recommend:'));

		menu.appendChild(
			makeItem('rec-ico-more', 'More of this', () => {
				if (api) api.more(kind, item);
			}),
		);
		menu.appendChild(
			makeItem('rec-ico-less', 'Less of this', () => {
				if (api) api.less(kind, item);
			}),
		);
		menu.appendChild(
			makeItem('rec-ico-none', 'None of this', () => {
				if (api) api.none(kind, item);
			}),
		);

		menu.appendChild(el('div', 'rec-menu-sep'));

		menu.appendChild(
			makeItem('rec-ico-nosee', "Don't wanna see", () => {
				if (api) api.hide(kind, item);
				popCardAway(cardEl);
			}),
		);
		menu.appendChild(
			makeItem('rec-ico-config', 'Configure content', () => {
				if (window.starlConfigureContent && typeof window.starlConfigureContent.open === 'function') {
					window.starlConfigureContent.open();
				}
			}),
		);

		return menu;
	}

	// reuse the app's little "poof" animation if it's around, otherwise just yank the card
	function popCardAway(cardEl) {
		if (!cardEl || !cardEl.isConnected) return;
		if (typeof window.starlExplodeViolently === 'function') {
			window.starlExplodeViolently(cardEl, {});
		} else {
			cardEl.remove();
		}
	}

	/* ☆======= open / position =======☆ */

	function openMenu(cardEl, kind, item) {
		closeMenu();
		if (!item) return;

		const menu = buildMenu(kind, item, cardEl);
		activeMenuEl = menu;
		document.body.appendChild(menu);

		// sit it just under the card, but never let it spill off the right edge
		if (cardEl) {
			const rect = cardEl.getBoundingClientRect();
			menu.style.position = 'fixed';
			menu.style.top = String(rect.bottom + 6) + 'px';
			const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8);
			menu.style.left = String(Math.max(8, left)) + 'px';
		}

		// close on the next outside tap (the menu stops its own clicks from bubbling)
		menu.addEventListener('click', (e) => e.stopPropagation());
		setTimeout(() => window.addEventListener('click', closeMenu, {once: true}), 0);
	}

	/* ☆======= bind a card =======☆ */

	function bindCard(cardEl, getItem, kind) {
		if (!cardEl || typeof getItem !== 'function') return;

		// hover: wait a beat so brushing past doesn't fire it.
		// touch screens synthesize a pointerenter the moment a finger lands (and often
		// never send the matching pointerleave), so on mobile this would pop the menu -
		// and leave the card stuck in its :hover look - just from resting a finger there.
		// only real mouse pointers get hover-to-open; touch users long-press instead
		// (that arrives as 'contextmenu' below, which the Android WebView fires natively).
		cardEl.addEventListener('pointerenter', (e) => {
			if (e.pointerType && e.pointerType !== 'mouse') return;
			clearHoverTimer();
			hoverTimerId = setTimeout(() => {
				hoverTimerId = null;
				openMenu(cardEl, kind, getItem());
			}, HOVER_DELAY_MS);
		});
		cardEl.addEventListener('pointerleave', clearHoverTimer);
		cardEl.addEventListener('pointercancel', clearHoverTimer);

		// right-click / long-press: open it right away
		cardEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			clearHoverTimer();
			openMenu(cardEl, kind, getItem());
		});
		cardEl.addEventListener('longpress', () => {
			clearHoverTimer();
			openMenu(cardEl, kind, getItem());
		});
	}

	/* ☆======= public API =======☆ */

	window.starlRecommendMenu = {bindCard, openMenu, closeMenu};
})();

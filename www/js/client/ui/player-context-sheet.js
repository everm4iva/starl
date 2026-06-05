/*
Player context sheet
-> triggered by swiping up on the maximized player's scroll-up indicator.
-> shows a stylized hero header with the current track's artwork and artist info.
-> actions: favorite, queue, playlist, go to artist, go to album.
*/

(function () {

	// ----- Helpers -----

	function getCSSVar(name) {
		try {
			return getComputedStyle(document.documentElement)
				.getPropertyValue(name).trim()
				.replace(/^["']|["']$/g, '');
		} catch (e) { return ''; }
	}

	function extractBgUrl(cssValue) {
		const m = String(cssValue || '').match(/url\(["']?(.+?)["']?\)/);
		return m ? m[1] : '';
	}

	// ----- Current track state -----

	function getCurrentTrack() {
		const title = getCSSVar('--player-song-title') || '';
		const artist = getCSSVar('--player-song-artist') || '';
		const album = getCSSVar('--player-song-album') || '';
		const bgVar = getComputedStyle(document.documentElement).getPropertyValue('--player-bg').trim();
		const imageUrl = extractBgUrl(bgVar);
		// currentTrackKey is a global from runtime.js — access via window to survive IIFE scope
		const trackKey = (window.currentTrackKey || (typeof currentTrackKey !== 'undefined' ? currentTrackKey : '')) || '';
		return { title, artist, album, imageUrl, trackKey };
	}

	function open() {
		const track = getCurrentTrack();
		const menu = window.starlTrackContextMenu;
		if (!menu || typeof menu.openForTrack !== 'function') return;
		menu.openForTrack(track, { source: 'player' });
	}

	// ----- Gesture attachment -----

	function attachLongPress(el) {
		if (!el) return;
		let timer = null;
		const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
		el.addEventListener('pointerdown', () => { timer = setTimeout(() => { timer = null; open(); }, 600); });
		el.addEventListener('pointerup', cancel);
		el.addEventListener('pointerleave', cancel);
		el.addEventListener('pointercancel', cancel);
		// prevent context menu on long press
		el.addEventListener('contextmenu', (e) => e.preventDefault());
	}

	function attachGesture() {
		const additional = document.querySelector('.mp-additional');
		const indicator = document.querySelector('.mp-scrollupindicator');
		const cover = document.querySelector('.mp-cover');

		// Swipe-up on mp-additional
		if (additional) {
			let startY = 0;
			let startX = 0;
			let tracking = false;

			additional.addEventListener('touchstart', (e) => {
				const t = e.touches && e.touches[0];
				if (!t) return;
				startY = t.clientY;
				startX = t.clientX;
				tracking = true;
			}, { passive: true });

			document.addEventListener('touchend', (e) => {
				if (!tracking) return;
				tracking = false;
				const t = (e.changedTouches && e.changedTouches[0]) || {};
				const dy = (t.clientY || 0) - startY;
				const dx = Math.abs((t.clientX || 0) - startX);
				if (dy < -30 && dx < Math.abs(dy)) open();
			}, { passive: true });

			// tap on the pill
			if (indicator) indicator.addEventListener('click', open);
		}

		// Long-press on the album cover as a backup trigger
		attachLongPress(cover);
	}

	// ----- Init -----

	if (document.readyState !== 'loading') {
		attachGesture();
	} else {
		document.addEventListener('DOMContentLoaded', attachGesture, { once: true });
	}

	window.starlPlayerContextSheet = { open };

})();

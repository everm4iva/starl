/**
 * ☆=========================================☆
 * Player context sheet - actions for the currently playing track
 * Opens the track context menu for whatever song is playing right now.
 * Triggered by swiping up on the player's scroll indicator or a long-press
 * on the album cover.
 *
 * --- What this file does? ---
 * - Reads the current track info from CSS vars and the queue/history
 * - Delegates to starlTrackContextMenu.openForTrack() to show the menu
 * - Wires a swipe-up gesture on .mp-additional and a long-press on .mp-cover
 *
 * --- Dictionary / Terms / Extra details ---
 * - "player context sheet" opens the same track context menu used elsewhere,
 *   just triggered from inside the maximized player instead of a track list
 * ☆=========================================☆
 */

(function () {
	/* ☆======= Current track state =======☆ */

	function getCSSVar(name) {
		try {
			// setTextVar() (layout-tabs.js) wraps the value in quotes and backslash-escapes
			// backslashes/quotes for safe CSS string embedding - undo both here, or titles
			// like "I DON'T..." come back as "I DON\'T..." once read back from the var
			return getComputedStyle(document.documentElement)
				.getPropertyValue(name)
				.trim()
				.replace(/^["']|["']$/g, '')
				.replace(/\\(.)/g, '$1');
		} catch (e) {
			return '';
		}
	}

	function extractBgUrl(cssValue) {
		const m = String(cssValue || '').match(/url\(["']?(.+?)["']?\)/);
		return m ? m[1] : '';
	}

	function getCurrentTrack() {
		const title = getCSSVar('--player-song-title') || '';
		const artist = getCSSVar('--player-song-artist') || '';
		const album = getCSSVar('--player-song-album') || '';
		const bgVar = getComputedStyle(document.documentElement).getPropertyValue('--player-bg').trim();
		const imageUrl = extractBgUrl(bgVar);
		const trackKey = (window.starlPlaybackState && window.starlPlaybackState.currentTrackKey) || '';

		// sourceUrl: use trackKey when it's a YouTube URL, otherwise look up from queue or history
		let sourceUrl = '';
		let albumId = '';
		let artistChannelId = '';
		if (/^https?:\/\//i.test(trackKey)) {
			sourceUrl = trackKey;
		} else {
			// try the current queue track first (has sourceUrl, albumId, artistChannelId stored)
			const queueApi = window.starlPlaybackQueue;
			if (queueApi && typeof queueApi.getCurrentTrack === 'function') {
				const qt = queueApi.getCurrentTrack();
				if (qt) {
					if (qt.sourceUrl) sourceUrl = qt.sourceUrl;
					if (qt.albumId) albumId = qt.albumId;
					if (qt.artistChannelId) artistChannelId = qt.artistChannelId;
				}
			}
			// Fall back to history
			if (window.starlHistory && typeof window.starlHistory.getAll === 'function') {
				const entry = window.starlHistory.getAll().find((h) => h.trackKey === trackKey);
				if (entry) {
					if (!sourceUrl && entry.sourceUrl) sourceUrl = entry.sourceUrl;
					if (!albumId && entry.albumId) albumId = entry.albumId;
					if (!artistChannelId && entry.artistChannelId) artistChannelId = entry.artistChannelId;
				}
			}
		}
		// duration helps LRCLIB pick the right lyrics match; pull it from the last meta payload
		let duration = 0;
		try {
			const lastMeta = window.starlPlaybackState && window.starlPlaybackState.lastTrackMeta;
			duration = Number(lastMeta && lastMeta.duration) || 0;
		} catch (e) {}
		return {title, artist, album, imageUrl, trackKey, sourceUrl, albumId, artistChannelId, duration};
	}

	function open() {
		const track = getCurrentTrack();
		const menu = window.starlTrackContextMenu;
		if (!menu || typeof menu.openForTrack !== 'function') return;
		menu.openForTrack(track, {source: 'player'});
	}

	/* ☆======= Gesture attachment =======☆ */

	function attachLongPress(el) {
		if (!el) return;
		let timer = null;
		const cancel = () => {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		};
		el.addEventListener('pointerdown', () => {
			timer = setTimeout(() => {
				timer = null;
				open();
			}, 600);
		});
		el.addEventListener('pointerup', cancel);
		el.addEventListener('pointerleave', cancel);
		el.addEventListener('pointercancel', cancel);
		el.addEventListener('contextmenu', (e) => e.preventDefault());
	}

	function openArtist() {
		const menu = window.starlTrackContextMenu;
		if (!menu || typeof menu.resolveAndOpenArtist !== 'function') return;
		menu.resolveAndOpenArtist(getCurrentTrack());
	}

	function attachGesture() {
		const additional = document.querySelector('.mp-additional');
		const indicator = document.querySelector('.mp-scrollupindicator');
		const cover = document.querySelector('.mp-cover');
		const artistEl = document.querySelector('.mp-track-artist');

		if (artistEl) {
			artistEl.addEventListener('click', (e) => {
				e.stopPropagation();
				openArtist();
			});
		}

		// swipe-up on mp-additional opens the sheet
		if (additional) {
			let startY = 0;
			let startX = 0;
			let tracking = false;

			additional.addEventListener(
				'touchstart',
				(e) => {
					const t = e.touches && e.touches[0];
					if (!t) return;
					startY = t.clientY;
					startX = t.clientX;
					tracking = true;
				},
				{passive: true},
			);

			document.addEventListener(
				'touchend',
				(e) => {
					if (!tracking) return;
					tracking = false;
					const t = (e.changedTouches && e.changedTouches[0]) || {};
					const dy = (t.clientY || 0) - startY;
					const dx = Math.abs((t.clientX || 0) - startX);
					if (dy < -30 && dx < Math.abs(dy)) open();
				},
				{passive: true},
			);

			// tap on the pill indicator also opens it
			if (indicator) indicator.addEventListener('click', open);
		}

		// long-press on the album cover as a backup trigger
		attachLongPress(cover);
	}

	/* ☆======= Init =======☆ */

	if (document.readyState !== 'loading') {
		attachGesture();
	} else {
		document.addEventListener('DOMContentLoaded', attachGesture, {once: true});
	}

	window.starlPlayerContextSheet = {open, getCurrentTrack};
})();

/**
 * ☆=========================================☆
 * Inside playlist - universal track list overlay
 * A full-screen overlay that shows any "playlist-like" context: history,
 * favorites, all music, an album, or a user-created playlist.
 *
 * --- What this file does? ---
 * - open(context): populates the overlay header and track list for a given context
 * - close(): hides the overlay and fires 'starl-inside-playlist-closed'
 * - Handles play, shuffle, reorder, settings, and per-track context menus
 * - Swipe right on the header = close (wired via starlGestures)
 *
 * --- Dictionary / Terms / Extra details ---
 * - "context" = { type, id, title, tracks, ... } - describes what's being shown
 * - "reorder mode" = drag-and-drop track reordering within a user playlist
 * ☆=========================================☆
 */

(function () {
	let currentContext = null;
	let isReorderMode = false;

	// ----- Element refs -----

	let overlayEl = null;
	let headerEl = null;
	let headerBgEl = null;
	let iconEl = null;
	let coverEl = null;
	let titleEl = null;
	let detailsEl = null;
	let playBtn = null;
	let shuffleBtn = null;
	let moreBtn = null;
	let bodyEl = null;

	function init() {
		overlayEl = document.querySelector('.inside-playlist');
		if (!overlayEl) return;
		headerEl = overlayEl.querySelector('.header');
		headerBgEl = overlayEl.querySelector('.header-bg');
		iconEl = overlayEl.querySelector('.playlist-icon');
		coverEl = overlayEl.querySelector('.playlist-cover');
		titleEl = overlayEl.querySelector('.playlist-title');
		detailsEl = overlayEl.querySelector('.playlist-details');
		playBtn = overlayEl.querySelector('.playlist-btn.play');
		shuffleBtn = overlayEl.querySelector('.playlist-btn.shuffle');
		moreBtn = overlayEl.querySelector('.playlist-btn.more-vert');
		bodyEl = overlayEl.querySelector('.body');

		if (playBtn) playBtn.addEventListener('click', () => playFrom(0, false));
		if (shuffleBtn) shuffleBtn.addEventListener('click', () => playFrom(0, true));
		if (moreBtn) moreBtn.addEventListener('click', handleMore);

		if (headerEl && window.starlGestures) {
			window.starlGestures.setupPlaylistHeaderSwipe(headerEl, close);
		}
	}

	// ----- Helpers -----

	function formatDuration(s) {
		const n = Number(s);
		if (!Number.isFinite(n) || n <= 0) return '';
		const h = Math.floor(n / 3600);
		const m = Math.floor((n % 3600) / 60);
		const sec = Math.floor(n % 60);
		if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
		return m + ':' + String(sec).padStart(2, '0');
	}

	function getTotalDuration(tracks) {
		return tracks.reduce((t, r) => t + (Number(r && r.duration) || 0), 0);
	}

	function formatTotalDuration(seconds) {
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		if (h > 0) return h + ' hr ' + m + ' min';
		return m + ' min';
	}

	function resolveUrlForCss(imageUrl) {
		if (!imageUrl) return '';
		const base = typeof getApiBase === 'function' ? getApiBase() : window.STARL_API_BASE || '';
		const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
		if (token && base && imageUrl.startsWith(base)) {
			return imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
		}
		return imageUrl;
	}

	function setImageAsync(el, imageUrl, opts) {
		if (!el || !imageUrl) return;
		const cache = window.starlMediaCache;
		const variant = opts && opts.variant === 'low' ? 'low' : undefined;
		if (cache && typeof cache.resolveImageUrl === 'function') {
			cache
				.resolveImageUrl(imageUrl, variant)
				.then((url) => {
					if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
				})
				.catch(() => {
					const url = resolveUrlForCss(imageUrl);
					if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
				});
		} else {
			const url = resolveUrlForCss(imageUrl);
			el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
		}
	}

	// ----- Header population -----

	function populateHeader(context) {
		const tracks = context.tracks || [];

		// background blur: use first track image
		if (headerBgEl) {
			headerBgEl.style.backgroundImage = '';
			const firstWithImage = tracks.find((t) => t && t.imageUrl);
			if (firstWithImage) setImageAsync(headerBgEl, firstWithImage.imageUrl);
		}

		// cover grid: up to 4 images in a 2x2 grid
		if (coverEl) {
			coverEl.innerHTML = '';
			const coverTracks = tracks.slice(0, 4);
			const count = coverTracks.length;
			coverEl.className = 'playlist-cover count-' + (count || 0);
			for (let i = 0; i < Math.max(count, 1); i++) {
				const slot = document.createElement('div');
				slot.className = 'cover-slot';
				if (coverTracks[i] && coverTracks[i].imageUrl) {
					setImageAsync(slot, coverTracks[i].imageUrl);
				}
				coverEl.appendChild(slot);
			}
		}

		// title and details
		if (titleEl) titleEl.textContent = context.title || '';
		if (detailsEl) {
			const count = tracks.length;
			const total = getTotalDuration(tracks);
			detailsEl.textContent = count + ' songs • ' + formatTotalDuration(total);
		}

		// show type-specific icon
		if (iconEl) {
			const iconMap = {
				playlist: '../../media/common-icons/light/playlist_play.svg',
				history: '../../media/common-icons/light/history.svg',
				favorites: '../../media/common-icons/light/star.svg',
				music: '../../media/common-icons/light/music.svg',
				all: '../../media/common-icons/light/music.svg',
				artist: '../../media/common-icons/light/artist.svg',
				album: '../../media/common-icons/light/album.svg',
			};
			const iconUrl = iconMap[context.type] || iconMap.playlist;
			iconEl.style.display = '';
			iconEl.style.backgroundImage = 'url("' + iconUrl + '")';
		}

		// show/hide more button based on whether settings are available
		if (moreBtn) {
			moreBtn.style.display = context.canEdit ? '' : 'none';
		}
	}

	// ----- Body population -----

	function trackToPlayItem(track) {
		return {
			trackKey: track.trackKey || '',
			url: track.sourceUrl || track.streamUrl || track.trackKey || '',
			sourceUrl: track.sourceUrl || '',
			streamUrl: track.streamUrl || '',
			title: track.title || 'Untitled',
			artist: track.artist || 'Unknown artist',
			album: track.album || '',
			thumbnail: track.imageUrl || '',
			imageUrl: track.imageUrl || '',
			duration: track.duration || 0,
		};
	}

	function createTrackItem(track, index) {
		const item = document.createElement('div');
		item.className = 'item';

		const covers = document.createElement('div');
		covers.className = 'item-covers';
		const img = document.createElement('div');
		img.className = 'img1';
		if (track.imageUrl) setImageAsync(img, track.imageUrl, {variant: 'low'});
		covers.appendChild(img);

		const details = document.createElement('div');
		details.className = 'item-details';
		const titleEl = document.createElement('div');
		titleEl.className = 'item-title';
		titleEl.textContent = track.title || 'Untitled';
		const infoEl = document.createElement('div');
		infoEl.className = 'item-info';
		const infoParts = [track.artist || 'Unknown artist'];
		if (track.duration > 0) infoParts.push(formatDuration(track.duration));
		infoEl.textContent = infoParts.join(' • ');
		details.appendChild(titleEl);
		details.appendChild(infoEl);

		const actions = document.createElement('div');
		actions.className = 'item-actions';

		if (currentContext && currentContext.canReorder && isReorderMode) {
			const upBtn = document.createElement('div');
			upBtn.className = 'item-actions reorder-up';
			upBtn.style.opacity = index === 0 ? '0.3' : '';
			upBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (index > 0 && window.starlPlaylists) {
					window.starlPlaylists.moveTrackInPlaylist(currentContext.id, track.trackKey, -1);
					refresh();
				}
			});
			const downBtn = document.createElement('div');
			downBtn.className = 'item-actions reorder-down';
			downBtn.style.opacity = index === (currentContext.tracks || []).length - 1 ? '0.3' : '';
			downBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (window.starlPlaylists) {
					window.starlPlaylists.moveTrackInPlaylist(currentContext.id, track.trackKey, 1);
					refresh();
				}
			});
			actions.appendChild(upBtn);
			actions.appendChild(downBtn);
		} else {
			const moreHoriz = document.createElement('div');
			moreHoriz.className = 'item-actions more-horiz';
			moreHoriz.addEventListener('click', (e) => {
				e.stopPropagation();
			});
			if (window.starlTrackContextMenu && typeof window.starlTrackContextMenu.bindTarget === 'function') {
				window.starlTrackContextMenu.bindTarget(moreHoriz, () => track, {
					source: currentContext ? currentContext.type : 'library',
					playlistId: currentContext ? currentContext.id : null,
					directClick: true,
				});
			}
			actions.appendChild(moreHoriz);
		}

		item.appendChild(covers);
		item.appendChild(details);
		item.appendChild(actions);

		item.addEventListener('click', () => playFrom(index, false));
		return item;
	}

	function populateBody(tracks) {
		if (!bodyEl) return;
		bodyEl.innerHTML = '';
		if (!tracks || !tracks.length) {
			const empty = document.createElement('div');
			empty.className = 'inside-playlist-empty';
			empty.textContent = 'Nothing here yet.';
			bodyEl.appendChild(empty);
			return;
		}
		tracks.forEach((track, i) => {
			bodyEl.appendChild(createTrackItem(track, i));
		});
	}

	// ----- Playback -----

	function playFrom(index, shuffle) {
		if (!currentContext) return;
		const tracks = (currentContext.tracks || []).slice();
		if (!tracks.length) return;
		let startIndex = Math.max(0, Math.min(index, tracks.length - 1));
		if (shuffle) {
			for (let i = tracks.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[tracks[i], tracks[j]] = [tracks[j], tracks[i]];
			}
			startIndex = 0;
		}

		const playbackCtx = {type: currentContext.type || 'playlist', title: currentContext.title || ''};
		const player = window.starlPlayer;
		if (player && typeof player.playWithQueue === 'function') {
			player.playWithQueue(tracks.map(trackToPlayItem), startIndex, playbackCtx);
		} else if (player && typeof player.playFromSearch === 'function') {
			window.starlPlaybackContext = playbackCtx;
			player.playFromSearch(trackToPlayItem(tracks[startIndex]));
		}
	}

	// ----- More button -----

	function handleMore() {
		if (!currentContext || !currentContext.canEdit) return;
		if (window.starlPlaylists && typeof window.starlPlaylists.openSettingsModal === 'function') {
			window.starlPlaylists.openSettingsModal(currentContext.id);
		}
	}

	// ----- Refresh (for reorder) -----

	function refresh() {
		if (!currentContext || !currentContext.id || !window.starlPlaylists) return;
		const updated = window.starlPlaylists.get(currentContext.id);
		if (updated) {
			currentContext = {...currentContext, title: updated.title, tracks: updated.tracks};
			populateBody(currentContext.tracks);
			if (detailsEl) {
				const count = currentContext.tracks.length;
				const total = getTotalDuration(currentContext.tracks);
				detailsEl.textContent = count + ' songs • ' + formatTotalDuration(total);
			}
		}
	}

	// ----- Open / Close -----

	function open(context) {
		if (!overlayEl) init();
		if (!overlayEl) return;
		currentContext = context;
		isReorderMode = false;
		overlayEl.classList.remove('hidden');
		populateHeader(context);
		populateBody(context.tracks || []);
		overlayEl.scrollTop = 0;
	}

	function close() {
		if (overlayEl) overlayEl.classList.add('hidden');
		currentContext = null;
		isReorderMode = false;
	}

	function refreshTitle(newTitle) {
		if (currentContext) currentContext.title = newTitle;
		if (titleEl) titleEl.textContent = newTitle;
	}

	function toggleReorder() {
		if (!currentContext || !currentContext.canReorder) return;
		isReorderMode = !isReorderMode;
		populateBody(currentContext.tracks || []);
	}

	// ----- Public API -----

	window.starlInsidePlaylist = {open, close, refreshTitle, toggleReorder};

	window.addEventListener('starl-playlists-updated', () => {
		if (currentContext && currentContext.type === 'playlist' && currentContext.id) {
			refresh();
		}
	});

	if (document.readyState !== 'loading') {
		init();
	} else {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	}
})();

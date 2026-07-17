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
	let compactHeaderEl = null;
	let compactTitleEl = null;

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

		if (headerEl && bodyEl) bodyEl.insertBefore(headerEl, bodyEl.firstChild);

		buildCompactHeader();
		if (bodyEl) bodyEl.addEventListener('scroll', onBodyScroll, {passive: true});
	}

	// ----- Collapsing compact header -----
	// as the body scrolls down the tall header slides up out of view (onBodyScroll) and this
	// slim bar fades in: [back] [title] ........ [play] [shuffle] [scroll-to-top]

	function buildCompactHeader() {
		if (!overlayEl || compactHeaderEl) return;
		compactHeaderEl = document.createElement('div');
		compactHeaderEl.className = 'ip-compact-header';

		const back = document.createElement('div');
		back.className = 'iphc-btn iphc-back';
		back.addEventListener('click', close);

		compactTitleEl = document.createElement('div');
		compactTitleEl.className = 'iphc-title';

		const play = document.createElement('div');
		play.className = 'iphc-btn iphc-play';
		play.addEventListener('click', () => playFrom(0, false));

		const shuffle = document.createElement('div');
		shuffle.className = 'iphc-btn iphc-shuffle';
		shuffle.addEventListener('click', () => playFrom(0, true));

		const top = document.createElement('div');
		top.className = 'iphc-btn iphc-top';
		top.addEventListener('click', () => {
			if (bodyEl) bodyEl.scrollTo({top: 0, behavior: 'smooth'});
		});

		compactHeaderEl.appendChild(back);
		compactHeaderEl.appendChild(compactTitleEl);
		compactHeaderEl.appendChild(play);
		compactHeaderEl.appendChild(shuffle);
		compactHeaderEl.appendChild(top);
		overlayEl.insertBefore(compactHeaderEl, overlayEl.firstChild);
	}

	// once the header has scrolled mostly out of view, fade the compact bar in. Just a class
	// toggle (no per-frame work)
	function onBodyScroll() {
		if (!overlayEl || !bodyEl) return;
		const y = bodyEl.scrollTop;
		if (y > 64) overlayEl.classList.add('scrolled');
		else if (y < 12) overlayEl.classList.remove('scrolled');
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

	// ----- Lazy cover loading -----
	// only fetch a row's cover once the row nears the viewport. without this, opening a
	// large list fired one resolveImageUrl (IndexedDB read + possible network fetch) per
	// track all at once - the main cause of the "open a big playlist and it chugs" lag
	let imageObserver = null;

	function getImageObserver() {
		if (imageObserver || typeof IntersectionObserver === 'undefined') return imageObserver;
		imageObserver = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (!entry.isIntersecting) return;
					const el = entry.target;
					imageObserver.unobserve(el);
					const url = el.dataset.bgUrl;
					if (url) setImageAsync(el, url, {variant: 'low'});
				});
			},
			// load a screen ahead so covers are ready by the time a row scrolls in
			{root: bodyEl, rootMargin: '300px 0px'},
		);
		return imageObserver;
	}

	function observeCover(el, imageUrl) {
		if (!el || !imageUrl) return;
		const observer = getImageObserver();
		if (observer) {
			el.dataset.bgUrl = imageUrl;
			observer.observe(el);
		} else {
			// no IntersectionObserver (very old WebView): fall back to eager load
			setImageAsync(el, imageUrl, {variant: 'low'});
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
		if (compactTitleEl) compactTitleEl.textContent = context.title || '';
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
		const trackKey = track.trackKey || '';
		const canSwipeRemove = !!(currentContext && currentContext.canEdit && currentContext.id && !isReorderMode);

		const row = document.createElement('div');
		row.className = canSwipeRemove ? 'item-row swipeable' : 'item-row';

		const item = document.createElement('div');
		item.className = 'item';

		const covers = document.createElement('div');
		covers.className = 'item-covers';
		const img = document.createElement('div');
		img.className = 'img1';
		if (track.imageUrl) observeCover(img, track.imageUrl);
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

		const nowPlayingIcon = document.createElement('div');
		nowPlayingIcon.className = 'item-now-playing-icon';
		actions.appendChild(nowPlayingIcon);

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

		// resolve the index at click time, not build time: the reconciler reuses row
		// elements across edits, so a captured index would go stale after a remove/reorder
		item.addEventListener('click', () => {
			const list = (currentContext && currentContext.tracks) || [];
			const i = list.findIndex((t) => trackId(t) === trackKey);
			playFrom(i >= 0 ? i : index, false);
		});
		// alias keys so offline-availability can match cached tracks stored under
		// sourceUrl/streamUrl rather than trackKey
		item.dataset.cacheKeys = [track.sourceUrl, track.streamUrl].filter(Boolean).join('\n');
		if (window.starlNowPlaying) {
			window.starlNowPlaying.markTrackRow(item, trackKey);
		}

		if (!canSwipeRemove) {
			item.dataset.trackKey = trackKey;
			return item;
		}

		const removeBg = document.createElement('div');
		removeBg.className = 'item-remove-bg';
		const removeIcon = document.createElement('div');
		removeIcon.className = 'item-remove-icon';
		removeBg.appendChild(removeIcon);

		row.appendChild(removeBg);
		row.appendChild(item);
		row.dataset.trackKey = trackKey;

		if (window.starlGestures && typeof window.starlGestures.setupSwipeToRemove === 'function') {
			window.starlGestures.setupSwipeToRemove(row, item, () => {
				if (window.starlPlaylists) {
					window.starlPlaylists.removeTrackFromPlaylist(currentContext.id, trackKey);
				}
			});
		}

		return row;
	}

	function populateBody(tracks) {
		if (!bodyEl) return;
		// drop any cover observations from the previous list before we rebuild
		if (imageObserver) {
			imageObserver.disconnect();
			imageObserver = null;
		}
		// clear previous rows but keep the in-flow header (first child) so it keeps scrolling
		Array.from(bodyEl.children).forEach((c) => {
			if (c !== headerEl) c.remove();
		});
		if (!tracks || !tracks.length) {
			const empty = document.createElement('div');
			empty.className = 'inside-playlist-empty';
			empty.textContent = 'Nothing here yet.';
			bodyEl.appendChild(empty);
			return;
		}
		// build every row off-DOM and insert in one shot - one reflow instead of one per row
		const fragment = document.createDocumentFragment();
		tracks.forEach((track, i) => {
			fragment.appendChild(createTrackItem(track, i));
		});
		bodyEl.appendChild(fragment);
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
	function rebuildPreservingScroll(tracks) {
		const savedScroll = bodyEl ? bodyEl.scrollTop : 0;
		populateBody(tracks);
		if (bodyEl) bodyEl.scrollTop = savedScroll;
	}

	// keyed reconcile: keep the row elements that survive an edit (and their already-loaded
	// covers) exactly where they are, only creating/removing/moving what actually changed.
	// This is what stops the whole list - and every image - from blinking on a track remove.
	function reconcileBody(tracks) {
		if (!bodyEl) return;
		if (!tracks || !tracks.length) {
			populateBody(tracks); // empty-state path
			return;
		}

		// index the rows currently on screen by their track key
		const existing = new Map();
		Array.from(bodyEl.children).forEach((child) => {
			if (child === headerEl) return;
			const key = child.dataset && child.dataset.trackKey;
			if (key) existing.set(key, child);
			else child.remove(); // stray node (e.g. an old empty-state placeholder)
		});

		const desired = new Set();
		// cursor walks the existing DOM order; we slot each desired row in ahead of it
		let cursor = headerEl ? headerEl.nextSibling : bodyEl.firstChild;
		tracks.forEach((track, i) => {
			const key = trackId(track);
			desired.add(key);
			const el = existing.get(key) || createTrackItem(track, i);
			if (el === cursor) {
				cursor = cursor.nextSibling; // already in the right spot
			} else {
				bodyEl.insertBefore(el, cursor); // reuse-in-place or move; no image reload
			}
		});

		// drop rows whose track is gone
		existing.forEach((el, key) => {
			if (!desired.has(key)) el.remove();
		});
	}

	function trackId(t) {
		return (t && (t.trackKey || t.sourceUrl || t.streamUrl)) || '';
	}

	function mergePreservingOrder(currentTracks, freshTracks) {
		const freshById = new Map();
		freshTracks.forEach((t) => {
			const id = trackId(t);
			if (id) freshById.set(id, t);
		});
		const seen = new Set();
		const merged = [];
		// already-visible tracks first, in their current on-screen order (with fresh data)
		(currentTracks || []).forEach((t) => {
			const id = trackId(t);
			if (id && freshById.has(id) && !seen.has(id)) {
				seen.add(id);
				merged.push(freshById.get(id));
			}
		});

		freshTracks.forEach((t) => {
			const id = trackId(t);
			if (!id || !seen.has(id)) {
				if (id) seen.add(id);
				merged.push(t);
			}
		});
		return merged;
	}

	function performRefresh() {
		if (!currentContext || !currentContext.id || !window.starlPlaylists) return;
		const updated = window.starlPlaylists.get(currentContext.id);
		if (updated) {
			currentContext = {...currentContext, title: updated.title, tracks: updated.tracks};
			// reorder mode has its own per-row up/down buttons keyed on index, so it needs a
			// full rebuild; everything else diffs in place so nothing blinks
			if (isReorderMode) rebuildPreservingScroll(currentContext.tracks);
			else reconcileBody(currentContext.tracks);
			if (detailsEl) {
				const count = currentContext.tracks.length;
				const total = getTotalDuration(currentContext.tracks);
				detailsEl.textContent = count + ' songs • ' + formatTotalDuration(total);
			}
		}
	}

	// A single playlist write fans out into several 'starl-playlists-updated' events
	// (direct dispatch + a couple of account-state setState round-trips through the sync
	// layer). Rebuilding the whole list on each one made the list blink and jump to the
	// top ~5x per edit. Coalesce the burst into one rebuild on the next frame instead.
	let refreshScheduled = false;

	function refresh() {
		if (refreshScheduled) return;
		refreshScheduled = true;
		const run = () => {
			refreshScheduled = false;
			performRefresh();
		};
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
		else setTimeout(run, 16);
	}

	// ----- Open / Close -----

	function open(context) {
		if (!overlayEl) init();
		if (!overlayEl) return;
		currentContext = context;
		isReorderMode = false;
		overlayEl.classList.remove('hidden');
		overlayEl.classList.remove('scrolled');
		populateHeader(context);
		populateBody(context.tracks || []);
		overlayEl.scrollTop = 0;
		if (bodyEl) bodyEl.scrollTop = 0;
	}

	function close() {
		if (overlayEl) overlayEl.classList.add('hidden');
		currentContext = null;
		isReorderMode = false;
	}

	function refreshTitle(newTitle) {
		if (currentContext) currentContext.title = newTitle;
		if (titleEl) titleEl.textContent = newTitle;
		if (compactTitleEl) compactTitleEl.textContent = newTitle;
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

	function refreshFromLibraryNative() {
		if (!currentContext || !window.starlLibraryNative) return;
		if (!['history', 'favorites', 'music'].includes(currentContext.type)) return;
		let tracks;
		if (currentContext.type === 'history') tracks = window.starlLibraryNative.getHistoryTracks();
		else if (currentContext.type === 'favorites') tracks = window.starlLibraryNative.getFavoritesTracks();
		else tracks = window.starlLibraryNative.getAllTracks();
		// keep the order the user is currently looking at - don't let a play-bump reshuffle it
		tracks = mergePreservingOrder(currentContext.tracks, tracks);
		currentContext = {...currentContext, tracks};
		reconcileBody(tracks);
		if (detailsEl) {
			const count = tracks.length;
			const total = getTotalDuration(tracks);
			detailsEl.textContent = count + ' songs • ' + formatTotalDuration(total);
		}
	}

	window.addEventListener('starl-history-updated', refreshFromLibraryNative);
	window.addEventListener('starl-favorites-updated', refreshFromLibraryNative);

	if (document.readyState !== 'loading') {
		init();
	} else {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	}
})();

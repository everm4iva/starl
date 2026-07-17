/**
 * ☆=========================================☆
 * Track context queue - queue panel for the track context bottom sheet
 * Renders the current playback queue inside the track context menu when
 * it is opened from the player (source === 'player').
 * Called by track-context-menu.js via window.starlTrackContextQueue.buildQueueSection().
 *
 * --- What this file does? ---
 * - buildQueueSection(body, bs): appends the queue list to the bottom sheet body
 * - Highlights the currently playing track
 * - Clicking a row jumps playback to that queue position
 *
 * --- Dictionary / Terms / Extra details ---
 * - Exposed as window.starlTrackContextQueue so track-context-menu.js can call it
 * ☆=========================================☆
 */

(function () {
	// horizontal drag distance (px) a row must travel before it's yanked from the queue.
	// on purpose-large so a stray sideways nudge during a vertical scroll won't delete
	// anything - "low sensibility to prevent accidents" per design
	const REMOVE_THRESHOLD = 96;
	// how far horizontal has to beat vertical before we treat the drag as a swipe (and stop
	// the list from scrolling). keeps normal up/down scrolling untouched
	const DIRECTION_LOCK = 10;

	// wire left/right drag on a queue row -> remove that track. Guards against accidental
	// triggers by requiring a mostly-horizontal drag past REMOVE_THRESHOLD. onRemoved runs
	// after a successful removeAt so the caller can re-render the list
	function bindSwipeToRemove(row, getIdx, onRemoved) {
		let startX = 0;
		let startY = 0;
		let dragging = false;
		let locked = false; // committed to a horizontal swipe (vs a vertical scroll)
		let active = false;

		function onDown(e) {
			const pt = e.touches ? e.touches[0] : e;
			startX = pt.clientX;
			startY = pt.clientY;
			dragging = true;
			locked = false;
			active = true;
			row.style.transition = 'none';
		}

		function onMove(e) {
			if (!dragging) return;
			const pt = e.touches ? e.touches[0] : e;
			const dx = pt.clientX - startX;
			const dy = pt.clientY - startY;
			if (!locked) {
				if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > DIRECTION_LOCK) {
					// clearly a vertical scroll - bail out, let the list scroll
					dragging = false;
					return;
				}
				if (Math.abs(dx) > DIRECTION_LOCK) locked = true;
			}
			if (locked) {
				if (e.cancelable) e.preventDefault();
				row.style.transform = 'translateX(' + dx + 'px)';
				row.style.opacity = String(Math.max(0.3, 1 - Math.abs(dx) / (REMOVE_THRESHOLD * 2)));
			}
		}

		function onUp(e) {
			if (!dragging && !locked) {
				reset();
				return;
			}
			const pt = e.changedTouches ? e.changedTouches[0] : e;
			const dx = pt.clientX - startX;
			dragging = false;
			if (locked && Math.abs(dx) >= REMOVE_THRESHOLD) {
				const idx = getIdx();
				const queueApi = window.starlPlaybackQueue;
				if (queueApi && typeof queueApi.removeAt === 'function' && queueApi.removeAt(idx)) {
					// slide the row off the way it was flung, then re-render
					row.style.transition = 'transform 0.18s ease, opacity 0.18s ease';
					row.style.transform = 'translateX(' + (dx > 0 ? 1 : -1) * 400 + 'px)';
					row.style.opacity = '0';
					setTimeout(() => {
						if (typeof onRemoved === 'function') onRemoved();
					}, 160);
					return;
				}
			}
			reset();
		}

		function reset() {
			row.style.transition = 'transform 0.18s ease, opacity 0.18s ease';
			row.style.transform = '';
			row.style.opacity = '';
			locked = false;
		}

		row.addEventListener('touchstart', onDown, {passive: true});
		row.addEventListener('touchmove', onMove, {passive: false});
		row.addEventListener('touchend', onUp);
		row.addEventListener('touchcancel', reset);
		// pointer fallback for mouse / non-touch (dev + desktop webview)
		row.addEventListener('mousedown', (e) => {
			onDown(e);
			const mm = (ev) => onMove(ev);
			const mu = (ev) => {
				onUp(ev);
				document.removeEventListener('mousemove', mm);
				document.removeEventListener('mouseup', mu);
			};
			document.addEventListener('mousemove', mm);
			document.addEventListener('mouseup', mu);
		});
		void active;
	}

	function buildQueueSection(body, bs) {
		const queueApi = window.starlPlaybackQueue;
		if (!queueApi || typeof queueApi.getQueue !== 'function') return;
		let queue = queueApi.getQueue();
		if (!queue || !queue.length) return;

		const section = document.createElement('div');
		section.className = 'bsc-queue-section';

		const label = document.createElement('div');
		label.className = 'bsc-queue-label';
		section.appendChild(label);

		const list = document.createElement('div');
		list.className = 'bsc-queue-list';

		function renderList() {
			queue = queueApi.getQueue();
			const currentIdx = typeof queueApi.getCurrentIndex === 'function' ? queueApi.getCurrentIndex() : -1;
			label.textContent = 'Queue · ' + queue.length + ' tracks';
			list.innerHTML = '';
			queue.forEach((item, idx) => {
			const row = document.createElement('div');
			row.className = 'bsc-queue-row' + (idx === currentIdx ? ' current' : '');

			const cover = document.createElement('div');
			cover.className = 'bsc-queue-cover';
			const imgUrl = item.imageUrl || item.thumbnail || '';
			if (imgUrl) {
				const cache = window.starlMediaCache;
				if (cache && typeof cache.setImageEl === 'function') {
					cache.setImageEl(cover, imgUrl, {variant: 'low'});
				} else {
					cover.style.backgroundImage = 'url("' + imgUrl.replace(/"/g, '%22') + '")';
				}
			}

			const info = document.createElement('div');
			info.className = 'bsc-queue-info';

			const title = document.createElement('div');
			title.className = 'bsc-queue-title';
			title.textContent = item.title || 'Untitled';

			const sub = document.createElement('div');
			sub.className = 'bsc-queue-sub';
			sub.textContent = item.artist || '';

			info.appendChild(title);
			info.appendChild(sub);
			row.appendChild(cover);
			row.appendChild(info);

			if (idx === currentIdx) {
				const indicator = document.createElement('div');
				indicator.className = 'bsc-queue-playing';
				row.appendChild(indicator);
			}

			row.addEventListener('click', () => {
				bs.close();
				setTimeout(() => {
					if (queueApi && typeof queueApi.goToTrack === 'function') {
						const target = queueApi.goToTrack(idx);
						if (target && window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
							window.starlPlayer.playFromSearch(
								{
									trackKey: target.trackKey || '',
									url: target.sourceUrl || target.streamUrl || target.trackKey || '',
									sourceUrl: target.sourceUrl || '',
									streamUrl: target.streamUrl || '',
									title: target.title || '',
									artist: target.artist || '',
									album: target.album || '',
									thumbnail: target.imageUrl || target.thumbnail || '',
									imageUrl: target.imageUrl || target.thumbnail || '',
									duration: target.duration || 0,
								},
								{keepPlayerState: true},
							);
						}
					}
				}, 50);
			});

			// long-hover / right-click opens the full track context menu for this
			// queued track, so it can be favorited, added to a playlist, etc. without
			// having to jump playback to it first. a plain tap still jumps (above)
			const ctx = window.starlTrackContextMenu;
			if (ctx && typeof ctx.bindTarget === 'function') {
				ctx.bindTarget(row, () => item, {source: 'player'});
			}

			// swipe a queued track left/right to drop it - but never the one that's
			// playing (removeAt refuses it too; skipping the bind keeps the row solid)
			if (idx !== currentIdx) {
				bindSwipeToRemove(row, () => idx, renderList);
			}

			list.appendChild(row);
			});

			// scroll current track into view after render
			setTimeout(() => {
				const cur = list.querySelector('.bsc-queue-row.current');
				if (cur) cur.scrollIntoView({block: 'center', behavior: 'smooth'});
			}, 80);
		}

		renderList();
		section.appendChild(list);

		const divider = document.createElement('div');
		divider.className = 'bsc-separator';
		section.appendChild(divider);

		body.appendChild(section);
	}

	window.starlTrackContextQueue = {buildQueueSection};
})();

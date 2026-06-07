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
	function buildQueueSection(body, bs) {
		const queueApi = window.starlPlaybackQueue;
		if (!queueApi || typeof queueApi.getQueue !== 'function') return;
		const queue = queueApi.getQueue();
		if (!queue || !queue.length) return;
		const currentIdx = typeof queueApi.getCurrentIndex === 'function' ? queueApi.getCurrentIndex() : -1;

		const section = document.createElement('div');
		section.className = 'bsc-queue-section';

		const label = document.createElement('div');
		label.className = 'bsc-queue-label';
		label.textContent = 'Queue · ' + queue.length + ' tracks';
		section.appendChild(label);

		const list = document.createElement('div');
		list.className = 'bsc-queue-list';

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

			list.appendChild(row);
		});

		// scroll current track into view after render
		setTimeout(() => {
			const cur = list.querySelector('.bsc-queue-row.current');
			if (cur) cur.scrollIntoView({block: 'center', behavior: 'smooth'});
		}, 80);

		section.appendChild(list);

		const divider = document.createElement('div');
		divider.className = 'bsc-separator';
		section.appendChild(divider);

		body.appendChild(section);
	}

	window.starlTrackContextQueue = {buildQueueSection};
})();

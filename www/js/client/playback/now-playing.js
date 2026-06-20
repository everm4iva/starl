/**
 * ☆=========================================☆
 * Now playing - shared "is this row the current track" highlighting
 * Track row builders (playlist-ui, artist-cards) call markTrackRow(el, trackKey)
 * to opt a row into highlighting. This file owns the single 'starl-playback-changed'
 * listener and toggles '.is-playing' on every registered row that matches.
 * ☆=========================================☆
 */

(function () {
	const rows = new Set();

	function isCurrent(trackKey) {
		const pb = window.starlPlaybackState;
		return !!(pb && trackKey && pb.currentTrackKey === trackKey);
	}

	function applyState(el, trackKey, isPlaying) {
		const current = isCurrent(trackKey);
		el.classList.toggle('is-playing', current && isPlaying);
		el.classList.toggle('is-current', current);
	}

	function refreshAll(isPlaying) {
		rows.forEach((el) => {
			if (!el.isConnected) {
				rows.delete(el);
				return;
			}
			applyState(el, el.dataset.trackKey || '', isPlaying);
		});
	}

	// row stays registered until garbage collected; "isConnected" check above
	// prunes rows removed from the DOM (re-render, navigating away, etc.)
	function markTrackRow(el, trackKey) {
		if (!el) return;
		el.dataset.trackKey = trackKey || '';
		rows.add(el);
		const audio = window.starlPlaybackState && window.starlPlaybackState.audio;
		applyState(el, trackKey || '', !!(audio && !audio.paused));
	}

	window.addEventListener('starl-playback-changed', (e) => {
		const detail = e.detail || {};
		refreshAll(!!detail.isPlaying);
	});

	window.starlNowPlaying = {markTrackRow};
})();

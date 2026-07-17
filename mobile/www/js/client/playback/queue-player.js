/**
 * ☆=========================================☆
 * Queue player - player UI controls wired to the queue
 * Bridges the playback queue (queue.js) with the actual player buttons:
 * next, previous, and shuffle. Keeps button states in sync with queue state.
 *
 * --- What this file does? ---
 * - Wires skip-next / skip-previous buttons (both maximized and mini player)
 * - Wires the shuffle button and syncs its active state
 * - Restores a saved multi-track queue on startup
 * - Listens to 'starl-queue-updated' to refresh button states automatically
 *
 * --- Dictionary / Terms / Extra details ---
 * - "keepPlayerState" = skipping does not open or close the player card
 * ☆=========================================☆
 */

(function () {
	let isQueueInitialized = false;
	let lastKnownShuffleState = false;

	/* ☆======= API handles =======☆ */

	function getQueueApi() {
		return window.starlPlaybackQueue || null;
	}

	function getPlayerApi() {
		return window.starlPlayer || null;
	}

	/* ☆======= Button elements =======☆ */

	function getShuffleButton() {
		return document.querySelector('.mp-btn.icon.shuffle');
	}

	// both the maximized player (.mp-btn) and the mini player (.mini-player-btn) have their own skip buttons
	function getPreviousButtons() {
		return Array.from(document.querySelectorAll('.mp-btn.icon.skip-previous, .mini-player-btn.icon.skip-previous'));
	}

	function getNextButtons() {
		return Array.from(document.querySelectorAll('.mp-btn.icon.skip-next, .mini-player-btn.icon.skip-next'));
	}

	/* ☆======= Button state management =======☆ */

	function updateShuffleButtonState() {
		const queueApi = getQueueApi();
		if (!queueApi) {
			return;
		}

		const isShuffled = queueApi.isShuffleEnabled();
		const btn = getShuffleButton();

		if (btn) {
			btn.classList.toggle('active', isShuffled);
		}

		lastKnownShuffleState = isShuffled;
	}

	function updateNavigationButtonState() {
		const queueApi = getQueueApi();
		if (!queueApi) {
			return;
		}

		const length = queueApi.getQueueLength();
		const hasMultipleTracks = length > 1;

		getPreviousButtons().forEach((btn) => btn.classList.toggle('active', hasMultipleTracks));
		getNextButtons().forEach((btn) => btn.classList.toggle('active', hasMultipleTracks));
	}

	/* ☆======= Playback control handlers =======☆ */

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

	// while offline, smart-queue handles the skip by jumping straight to the next/prev
	// CACHED track (an uncached track can't play offline, so user never land on one). when
	// online it returns false and client does the normal adjacent skip below.

	async function smartQueueHandledSkip(direction) {
		const sq = window.starlSmartQueue;
		if (!sq || typeof sq.skip !== 'function') return false;
		try {
			return await sq.skip(direction);
		} catch (error) {
			return false;
		}
	}

	async function handleNextClick() {
		const queueApi = getQueueApi();
		if (!queueApi || typeof queueApi.nextTrack !== 'function') return;
		if (window.starlPlaybackState) window.starlPlaybackState.lastNavDirection = 1;
		if (await smartQueueHandledSkip(1)) return;
		const nextTrack = queueApi.nextTrack();
		if (nextTrack && window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
			window.starlPlayer.playFromSearch(trackToPlayItem(nextTrack), {keepPlayerState: true});
		}
	}

	async function handlePreviousClick() {
		const queueApi = getQueueApi();
		if (!queueApi || typeof queueApi.previousTrack !== 'function') return;
		if (window.starlPlaybackState) window.starlPlaybackState.lastNavDirection = -1;
		if (await smartQueueHandledSkip(-1)) return;
		const prevTrack = queueApi.previousTrack();
		if (prevTrack && window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
			window.starlPlayer.playFromSearch(trackToPlayItem(prevTrack), {keepPlayerState: true});
		}
	}

	function handleShuffleClick() {
		const queueApi = getQueueApi();
		if (!queueApi || typeof queueApi.toggleShuffle !== 'function') {
			return;
		}

		queueApi.toggleShuffle();
		updateShuffleButtonState();
	}

	/* ☆======= Setup + init =======☆ */

	function setupButtonHandlers() {
		getNextButtons().forEach((btn) => {
			btn.removeEventListener('click', handleNextClick);
			btn.addEventListener('click', handleNextClick);
		});

		getPreviousButtons().forEach((btn) => {
			btn.removeEventListener('click', handlePreviousClick);
			btn.addEventListener('click', handlePreviousClick);
		});

		const shuffleBtn = getShuffleButton();
		if (shuffleBtn) {
			shuffleBtn.removeEventListener('click', handleShuffleClick);
			shuffleBtn.addEventListener('click', handleShuffleClick);
		}
	}

	function setupQueueListeners() {
		window.addEventListener('starl-queue-updated', () => {
			updateNavigationButtonState();
			updateShuffleButtonState();
		});
	}

	function initializeQueue() {
		if (isQueueInitialized) {
			return;
		}

		const queueApi = getQueueApi();
		if (!queueApi || typeof queueApi.loadQueueState !== 'function') {
			return;
		}

		const savedState = queueApi.loadQueueState();
		if (savedState && typeof queueApi.restoreQueueState === 'function') {
			// only restore a real multi-track queue. a single-track entry just means the user played a standalone track, not that there's a queue to resume
			const queueTracks = Array.isArray(savedState.queue) ? savedState.queue : [];
			if (queueTracks.length > 1) {
				queueApi.restoreQueueState(savedState);
			}
		}

		setupButtonHandlers();
		setupQueueListeners();
		updateNavigationButtonState();
		updateShuffleButtonState();

		isQueueInitialized = true;
	}

	function waitForPlayerReady() {
		if (!window.starlPlayer) {
			setTimeout(waitForPlayerReady, 100);
			return;
		}
		initializeQueue();
	}

	waitForPlayerReady();
})();

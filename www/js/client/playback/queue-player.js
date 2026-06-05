/*
Queue-based player control
-> integrates playback queue with player UI controls (next, previous, shuffle).
-> keeps player in sync with queue state.
-> handles button state updates and playback transitions.
*/

(function () {
	let isQueueInitialized = false;
	let lastKnownShuffleState = false;

	// ----- Helpers -----

	function getQueueApi() {
		return window.starlPlaybackQueue || null;
	}

	function getPlayerApi() {
		return window.starlPlayer || null;
	}

	// ----- UI element access -----

	function getShuffleButton() {
		return document.querySelector('.mp-btn.icon.shuffle');
	}

	function getPreviousButton() {
		return document.querySelector('.mp-btn.icon.skip-previous');
	}

	function getNextButton() {
		return document.querySelector('.mp-btn.icon.skip-next');
	}

	function getRepeatButton() {
		return document.querySelector('.mp-btn.icon.repeat');
	}

	// ----- Button state management -----

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

		const prevBtn = getPreviousButton();
		const nextBtn = getNextButton();

		if (prevBtn) {
			prevBtn.classList.toggle('active', hasMultipleTracks);
		}
		if (nextBtn) {
			nextBtn.classList.toggle('active', hasMultipleTracks);
		}
	}

	// ----- Playback control handlers -----

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

	function handleNextClick() {
		const queueApi = getQueueApi();
		if (!queueApi || typeof queueApi.nextTrack !== 'function') return;
		const nextTrack = queueApi.nextTrack();
		if (nextTrack && window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
			window.starlPlayer.playFromSearch(trackToPlayItem(nextTrack));
		}
	}

	function handlePreviousClick() {
		const queueApi = getQueueApi();
		if (!queueApi || typeof queueApi.previousTrack !== 'function') return;
		const prevTrack = queueApi.previousTrack();
		if (prevTrack && window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
			window.starlPlayer.playFromSearch(trackToPlayItem(prevTrack));
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

	// ----- Setup -----

	function setupButtonHandlers() {
		const nextBtn = getNextButton();
		const prevBtn = getPreviousButton();
		const shuffleBtn = getShuffleButton();

		if (nextBtn) {
			nextBtn.removeEventListener('click', handleNextClick);
			nextBtn.addEventListener('click', handleNextClick);
		}

		if (prevBtn) {
			prevBtn.removeEventListener('click', handlePreviousClick);
			prevBtn.addEventListener('click', handlePreviousClick);
		}

		if (shuffleBtn) {
			shuffleBtn.removeEventListener('click', handleShuffleClick);
			shuffleBtn.addEventListener('click', handleShuffleClick);
		}
	}

	function setupQueueListeners() {
		document.addEventListener('starl-queue-updated', (e) => {
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
			queueApi.restoreQueueState(savedState);
		}

		setupButtonHandlers();
		setupQueueListeners();
		updateNavigationButtonState();
		updateShuffleButtonState();

		isQueueInitialized = true;
	}

	// ----- Listen for player initialization -----

	function waitForPlayerReady() {
		if (!window.starlPlayer) {
			setTimeout(waitForPlayerReady, 100);
			return;
		}
		initializeQueue();
	}

	waitForPlayerReady();
})();

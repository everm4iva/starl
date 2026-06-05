/*
Playback queue manager
-> owns the current playback queue, track ordering, shuffle state, and navigation.
-> handles next/previous track logic with shuffle support.
-> tracks the current index and maintains queue state.
*/

(function () {
	const QUEUE_STATE_KEY = 'starl_playback_queue';
	const UPDATE_EVENT = 'starl-queue-updated';

	let currentQueue = [];
	let currentIndex = 0;
	let shuffleEnabled = false;
	let originalQueue = [];
	let shuffledIndices = [];

	// ----- Queue state -----

	function saveQueueState() {
		try {
			const state = {
				queue: currentQueue,
				index: currentIndex,
				shuffle: shuffleEnabled,
				originalQueue: originalQueue,
				shuffledIndices: shuffledIndices,
			};
			localStorage.setItem(QUEUE_STATE_KEY, JSON.stringify(state));
		} catch (error) {
			console.warn('Failed to save queue state', error);
		}
	}

	function loadQueueState() {
		try {
			const raw = localStorage.getItem(QUEUE_STATE_KEY);
			if (!raw) {
				return null;
			}
			return JSON.parse(raw);
		} catch (error) {
			console.warn('Failed to load queue state', error);
			return null;
		}
	}

	function restoreQueueState(state) {
		if (!state || typeof state !== 'object') {
			return;
		}
		currentQueue = Array.isArray(state.queue) ? state.queue.slice() : [];
		currentIndex = Number(state.index) || 0;
		shuffleEnabled = Boolean(state.shuffle);
		originalQueue = Array.isArray(state.originalQueue) ? state.originalQueue.slice() : [];
		shuffledIndices = Array.isArray(state.shuffledIndices) ? state.shuffledIndices.slice() : [];
	}

	// ----- Queue management -----

	function setQueue(tracks, startIndex = 0) {
		if (!Array.isArray(tracks)) {
			currentQueue = [];
			currentIndex = 0;
			originalQueue = [];
			shuffledIndices = [];
			return;
		}

		currentQueue = tracks.slice();
		currentIndex = Math.max(0, Math.min(startIndex, currentQueue.length - 1));
		originalQueue = [];
		shuffledIndices = [];
		shuffleEnabled = false;

		saveQueueState();
		dispatchUpdate();
	}

	function getQueue() {
		return currentQueue.slice();
	}

	function getCurrentTrack() {
		if (currentIndex < 0 || currentIndex >= currentQueue.length) {
			return null;
		}
		return currentQueue[currentIndex];
	}

	function getCurrentIndex() {
		return currentIndex;
	}

	function getQueueLength() {
		return currentQueue.length;
	}

	// ----- Navigation -----

	function nextTrack() {
		if (currentQueue.length === 0) {
			return null;
		}

		if (currentIndex < currentQueue.length - 1) {
			currentIndex++;
		} else {
			currentIndex = 0;
		}

		saveQueueState();
		dispatchUpdate();
		return getCurrentTrack();
	}

	function previousTrack() {
		if (currentQueue.length === 0) {
			return null;
		}

		if (currentIndex > 0) {
			currentIndex--;
		} else {
			currentIndex = currentQueue.length - 1;
		}

		saveQueueState();
		dispatchUpdate();
		return getCurrentTrack();
	}

	function goToTrack(index) {
		const validIndex = Number(index) || 0;
		if (validIndex < 0 || validIndex >= currentQueue.length) {
			return null;
		}
		currentIndex = validIndex;
		saveQueueState();
		dispatchUpdate();
		return getCurrentTrack();
	}

	// ----- Shuffle -----

	function generateShuffleIndices() {
		const indices = [];
		for (let i = 0; i < currentQueue.length; i++) {
			indices.push(i);
		}

		for (let i = indices.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[indices[i], indices[j]] = [indices[j], indices[i]];
		}

		return indices;
	}

	function enableShuffle() {
		if (shuffleEnabled) {
			return;
		}

		originalQueue = currentQueue.slice();
		const currentTrack = getCurrentTrack();

		shuffledIndices = generateShuffleIndices();
		const newQueue = shuffledIndices.map((idx) => originalQueue[idx]);
		currentQueue = newQueue;

		if (currentTrack) {
			currentIndex = newQueue.findIndex((t) => t.trackKey === currentTrack.trackKey);
			if (currentIndex === -1) {
				currentIndex = 0;
			}
		} else {
			currentIndex = 0;
		}

		shuffleEnabled = true;
		saveQueueState();
		dispatchUpdate();
	}

	function disableShuffle() {
		if (!shuffleEnabled) {
			return;
		}

		const currentTrack = getCurrentTrack();
		currentQueue = originalQueue.slice();

		if (currentTrack) {
			currentIndex = currentQueue.findIndex((t) => t.trackKey === currentTrack.trackKey);
			if (currentIndex === -1) {
				currentIndex = 0;
			}
		} else {
			currentIndex = 0;
		}

		originalQueue = [];
		shuffledIndices = [];
		shuffleEnabled = false;

		saveQueueState();
		dispatchUpdate();
	}

	function toggleShuffle() {
		if (shuffleEnabled) {
			disableShuffle();
		} else {
			enableShuffle();
		}
	}

	function isShuffleEnabled() {
		return shuffleEnabled;
	}

	// ----- Events -----

	function dispatchUpdate() {
		try {
			window.dispatchEvent(
				new CustomEvent(UPDATE_EVENT, {
					detail: {
						queue: currentQueue.slice(),
						index: currentIndex,
						current: getCurrentTrack(),
						shuffle: shuffleEnabled,
					},
				}),
			);
		} catch (error) {
			console.warn('Failed to dispatch queue update', error);
		}
	}

	// ----- Queue mutations -----

	function addToEnd(track) {
		if (!track) return;
		currentQueue.push(track);
		saveQueueState();
		dispatchUpdate();
	}

	function insertAfterCurrent(track) {
		if (!track) return;
		const insertAt = Math.min(currentIndex + 1, currentQueue.length);
		currentQueue.splice(insertAt, 0, track);
		saveQueueState();
		dispatchUpdate();
	}

	// ----- Public API -----

	window.starlPlaybackQueue = {
		setQueue,
		getQueue,
		getCurrentTrack,
		getCurrentIndex,
		getQueueLength,
		nextTrack,
		previousTrack,
		goToTrack,
		addToEnd,
		insertAfterCurrent,
		enableShuffle,
		disableShuffle,
		toggleShuffle,
		isShuffleEnabled,
		saveQueueState,
		loadQueueState,
		restoreQueueState,
	};
})();

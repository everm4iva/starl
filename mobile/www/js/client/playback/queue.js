/**
 * ☆=========================================☆
 * Queue - playback queue manager
 * Owns the current track list, position, shuffle state, and navigation.
 * Nothing outside this file should mutate queue order directly
 *
 * --- What this file does? ---
 * - setQueue(): replaces the queue with a new list and start index
 * - nextTrack() / previousTrack() / goToTrack(): navigate within the queue
 * - enableShuffle() / disableShuffle() / toggleShuffle(): Fisher-Yates shuffle
 *   that remembers the original order so un-shuffling restores it
 * - Saves and restores queue state in localStorage
 * - Fires 'starl-queue-updated' whenever the queue or position changes
 *
 * --- Dictionary / Terms / Extra details ---
 * - "trackKey" = unique ID for a track (usually its source URL)
 * ☆=========================================☆
 */

(function () {
	const QUEUE_STATE_KEY = 'starl_playback_queue';
	const UPDATE_EVENT = 'starl-queue-updated';

	let currentQueue = [];
	let currentIndex = 0;
	let shuffleEnabled = false;
	let originalQueue = [];
	let shuffledIndices = [];

	/* ☆======= Queue state persistence =======☆ */

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

	/* ☆======= Queue management =======☆ */

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

	/* ☆======= Navigation =======☆ */

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

	function peekNext() {
		if (currentQueue.length === 0) return null;
		const nextIndex = currentIndex < currentQueue.length - 1 ? currentIndex + 1 : 0;
		return currentQueue[nextIndex] || null;
	}

	function peekPrev() {
		if (currentQueue.length === 0) return null;
		const prevIndex = currentIndex > 0 ? currentIndex - 1 : currentQueue.length - 1;
		return currentQueue[prevIndex] || null;
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

	/* ☆======= Shuffle =======☆ */

	function generateShuffleIndices() {
		const indices = [];
		for (let i = 0; i < currentQueue.length; i++) {
			indices.push(i);
		}
		// "fisher-Yates" shuffle, because why not go fishing for the best algorithm.. hah! bad joke, i know, i know.
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
		// user setting: where the currently playing song lands after shuffling
		const mode = (window.starlPlaybackPrefs && window.starlPlaybackPrefs.getShuffleMode()) || 'middle';

		if (mode === 'start' && currentTrack) {
			// keep the current song, shuffle only the others, then pin it to the top
			// restIndices runs parallel to rest so shuffledIndices stays a valid
			// new-position -> original-index map for state restore.
			const rest = [];
			const restIndices = [];
			for (let i = 0; i < originalQueue.length; i++) {
				if (i === currentIndex) continue;
				rest.push(originalQueue[i]);
				restIndices.push(i);
			}
			for (let i = rest.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[rest[i], rest[j]] = [rest[j], rest[i]];
				[restIndices[i], restIndices[j]] = [restIndices[j], restIndices[i]];
			}
			currentQueue = [currentTrack].concat(rest);
			shuffledIndices = [currentIndex].concat(restIndices);
			currentIndex = 0;
		} else {
			// 'middle' (default): shuffle everything; the current song lands wherever it falls
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

	/* ☆======= Queue mutations =======☆ */

	function addToEnd(track) {
		if (!track) return;
		currentQueue.push(track);
		saveQueueState();
		dispatchUpdate();
	}

	// pull one track out of the queue by position. Keeps currentIndex pointing at the
	// same playing track (shifts it down when we remove something above it). Removing the
	// track from originalQueue so un-shuffling can't resurrect it. Returns true if something was removed
	function removeAt(index) {
		const idx = Number(index);
		if (!Number.isInteger(idx) || idx < 0 || idx >= currentQueue.length) return false;
		if (idx === currentIndex) return false;

		const [removed] = currentQueue.splice(idx, 1);
		if (idx < currentIndex) currentIndex--;

		if (removed && originalQueue.length) {
			const oi = originalQueue.findIndex((t) => t.trackKey === removed.trackKey);
			if (oi >= 0) originalQueue.splice(oi, 1);
			// shuffledIndices is now a stale position map; drop it (only used for restore,
			// and disableShuffle rebuilds order straight from originalQueue anyway)
			shuffledIndices = [];
		}

		saveQueueState();
		dispatchUpdate();
		return true;
	}

	function insertAfterCurrent(track) {
		if (!track) return;
		const insertAt = Math.min(currentIndex + 1, currentQueue.length);
		currentQueue.splice(insertAt, 0, track);
		saveQueueState();
		dispatchUpdate();
	}

	/* ☆======= Events =======☆ */

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

	/* ☆======= Public API =======☆ */

	window.starlPlaybackQueue = {
		setQueue,
		getQueue,
		getCurrentTrack,
		getCurrentIndex,
		getQueueLength,
		nextTrack,
		previousTrack,
		peekNext,
		peekPrev,
		goToTrack,
		addToEnd,
		insertAfterCurrent,
		removeAt,
		enableShuffle,
		disableShuffle,
		toggleShuffle,
		isShuffleEnabled,
		saveQueueState,
		loadQueueState,
		restoreQueueState,
	};
})();

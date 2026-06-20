/**
 * ☆=========================================☆
 * Runtime media session - Web Media Session API integration
 * Keeps the browser-level media controls (lock screen, headset buttons) in sync
 * with the current audio playback state.
 * Depends on runtime.js (audio, setPlayIconState) and engine.js (updateStoredState).
 *
 * --- What this file does? ---
 * - initMediaSession(): wires play/pause/seek/next/prev/stop action handlers
 * - updateMediaSessionPlaybackState(): syncs navigator.mediaSession.playbackState
 * - updateMediaSessionPositionState(): syncs position + duration (throttled to 1s)
 *
 * --- Dictionary / Terms / Extra details ---
 * - "media session" = browser API for OS media controls (not Android-specific)
 * - These functions are called by engine.js audio event listeners
 * - next/prev delegate to handleNativeMusicControlMessage (runtime-notifications-handler.js)
 *   so Bluetooth/headset/Android Auto skip buttons reuse the same smart-queue/offline-aware
 *   routing as the native notification's Next/Prev buttons, instead of duplicating it
 * ☆=========================================☆
 */

let mediaSessionInitialized = false;
let lastMediaPositionUpdateMs = 0;

function canUseMediaSession() {
	return (
		typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof window.MediaMetadata !== 'undefined'
	);
}

function safeSetActionHandler(action, handler) {
	try {
		navigator.mediaSession.setActionHandler(action, handler);
	} catch (error) {
		// ignore unsupported actions.
	}
}

function initMediaSession() {
	if (mediaSessionInitialized || !canUseMediaSession()) {
		return;
	}
	mediaSessionInitialized = true;

	safeSetActionHandler('play', async () => {
		try {
			await audio.play();
			window.starlPlaybackState.shouldBePlaying = true;
			setPlayIconState(true);
			updateStoredState({isPlaying: true});
		} catch (error) {}
	});

	safeSetActionHandler('pause', () => {
		try {
			audio.pause();
			window.starlPlaybackState.shouldBePlaying = false;
			setPlayIconState(false);
			updateStoredState({isPlaying: false});
		} catch (error) {}
	});

	safeSetActionHandler('stop', () => {
		try {
			audio.pause();
			audio.currentTime = 0;
			window.starlPlaybackState.shouldBePlaying = false;
			setPlayIconState(false);
			updateStoredState({isPlaying: false, position: 0});
		} catch (error) {}
	});

	safeSetActionHandler('previoustrack', () => {
		try {
			handleNativeMusicControlMessage({message: 'music-controls-previous'});
		} catch (error) {}
	});

	safeSetActionHandler('nexttrack', () => {
		try {
			handleNativeMusicControlMessage({message: 'music-controls-next'});
		} catch (error) {}
	});

	safeSetActionHandler('seekto', (details) => {
		try {
			if (details && typeof details.seekTime === 'number') {
				audio.currentTime = details.seekTime;
				updateStoredState({position: details.seekTime});
			}
		} catch (error) {}
	});

	safeSetActionHandler('seekbackward', (details) => {
		try {
			const offset = (details && details.seekOffset) || 10;
			audio.currentTime = Math.max(0, (Number(audio.currentTime) || 0) - offset);
			updateStoredState({position: Number(audio.currentTime) || 0});
		} catch (error) {}
	});

	safeSetActionHandler('seekforward', (details) => {
		try {
			const offset = (details && details.seekOffset) || 10;
			const duration = Number(audio.duration) || 0;
			const next = (Number(audio.currentTime) || 0) + offset;
			audio.currentTime = duration ? Math.min(duration, next) : next;
			updateStoredState({position: Number(audio.currentTime) || 0});
		} catch (error) {}
	});
}

function updateMediaSessionPlaybackState() {
	if (!canUseMediaSession()) {
		return;
	}
	try {
		navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
	} catch (error) {}
}

function updateMediaSessionPositionState(force = false) {
	if (!canUseMediaSession() || typeof navigator.mediaSession.setPositionState !== 'function') {
		return;
	}
	const now = Date.now();
	if (!force && now - lastMediaPositionUpdateMs < 1000) {
		return;
	}
	lastMediaPositionUpdateMs = now;
	try {
		const duration = Number(audio.duration) || 0;
		const position = Number(audio.currentTime) || 0;
		if (duration > 0 && Number.isFinite(position)) {
			navigator.mediaSession.setPositionState({
				duration,
				position: Math.min(duration, Math.max(0, position)),
				playbackRate: Number(audio.playbackRate) || 1,
			});
		}
	} catch (error) {}
}

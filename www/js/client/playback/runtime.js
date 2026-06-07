/**
 * ☆=========================================☆
 * Runtime - audio element, state, and playback controls
 * Declares the global <audio> element, playback state variables, repeat mode,
 * and the play/pause button state. Blob fallback lives here too.
 * Android notification + media session live in runtime-notifications.js (loaded after).
 *
 * --- What this file does? ---
 * - Creates and owns the <audio> element (used by engine.js and notifications)
 * - Declares global state: currentTrackKey, currentStreamUrl, repeatEnabled
 * - setPlayIconState(): syncs all play/pause icon buttons to the current state
 * - setRepeatEnabled(): toggles repeat mode and persists it to localStorage
 * - Blob fallback: if a cached blob URL is revoked, switches to the stream URL
 * - Owns repeat mode and player state storage keys
 *
 * --- Dictionary / Terms / Extra details ---
 * - "blob fallback" = when a cached audio blob is revoked, switches to stream URL
 * - Notification vars (nativeMusicControlsReady etc.) declared here for file ordering
 * ☆=========================================☆
 */

/* ☆======= Audio element =======☆ */

const audio = new Audio();
audio.preload = 'metadata';

/* ☆=== Native music controls state (used by runtime-notifications.js) ===☆ */

let nativeMusicControlsReady = false;
let lastNativeElapsedUpdateMs = 0;
let lastTrackMeta = null;
let lastNativeElapsedSeconds = 0;
let lastNativeTrackKey = '';
let cordovaDeviceReady = false;
let notificationsPermissionKnown = false;
let notificationsPermissionGranted = true;
let nativePlaybackActive = false;
let lastNativeArtworkUrl = '';

/* ☆======= Playback state + blob fallback =======☆ */

let isLoadingTrack = false;
let isLoadingSince = 0;
let currentTrackKey = '';
let currentStreamUrl = '';
let repeatEnabled = false;

// if a blob URL fails (stale/revoked), switch to the network stream URL.
// Mobile browsers can aggressively revoke blobs, so this prevents a silent crash-restart loop.
let blobFallbackInProgress = false;
audio.addEventListener('error', () => {
	if (blobFallbackInProgress) return;
	const src = audio.src || '';
	if (!/^blob:/i.test(src)) return;
	if (!currentStreamUrl || /^blob:/i.test(currentStreamUrl)) return;

	blobFallbackInProgress = true;
	console.warn('Stale blob URL detected, falling back to stream URL');

	const savedPosition = Number(audio.currentTime) || 0;

	const token = typeof getAccessToken === 'function' ? getAccessToken() : localStorage.getItem('starl_access_token');
	const sep = currentStreamUrl.includes('?') ? '&' : '?';
	const fallback = token ? currentStreamUrl + sep + 'token=' + encodeURIComponent(token) : currentStreamUrl;

	audio.src = fallback;
	audio.load();

	const onReady = () => {
		audio.removeEventListener('loadedmetadata', onReady);
		if (savedPosition > 1) {
			audio.currentTime = savedPosition;
		}
	};
	audio.addEventListener('loadedmetadata', onReady);

	audio
		.play()
		.catch(() => {})
		.finally(() => {
			blobFallbackInProgress = false;
		});
});

/* ☆======= Storage keys + play buttons =======☆ */

const PLAYER_STATE_KEY =
	window.starlShared && window.starlShared.keys ? window.starlShared.keys.playerState : 'starl_player_state';
const REPEAT_STATE_KEY =
	window.starlShared && window.starlShared.keys ? window.starlShared.keys.repeatState : 'starl_player_repeat';
let lastStateSaveMs = 0;

// only the actual pause/play toggle buttons, not shuffle/repeat/nav
function getPlayButtons() {
	const buttons = Array.from(
		document.querySelectorAll(
			'.mp-controls-btncontainer .mp-btn.icon.pause,' +
				'.mp-controls-btncontainer .mp-btn.icon.play,' +
				'.mini-player-controls .mini-player-btn.icon.pause,' +
				'.mini-player-controls .mini-player-btn.icon.play',
		),
	);
	// if no matched yet (before first playback), fall back to the element that has neither shuffle/repeat/skip classes
	if (!buttons.length) {
		return Array.from(
			document.querySelectorAll(
				'.mp-controls-btncontainer .mp-btn.icon:not(.shuffle):not(.repeat):not(.skip-previous):not(.skip-next),' +
					'.mini-player-controls .mini-player-btn.icon:not(.shuffle):not(.repeat):not(.skip-previous):not(.skip-next)',
			),
		).filter(Boolean);
	}
	return buttons;
}
const repeatButton = document.querySelector('.mp-controls-btncontainer .mp-btn.repeat');

function setPlayIconState(isPlaying) {
	const buttons = getPlayButtons();
	buttons.forEach((button) => {
		button.classList.remove('play');
		button.classList.remove('pause');
		button.classList.add(isPlaying ? 'pause' : 'play');
		button.classList.add('active');
		try {
			button.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
		} catch (e) {}
	});
}

function readRepeatState() {
	try {
		return localStorage.getItem(REPEAT_STATE_KEY) === 'true';
	} catch (error) {
		return false;
	}
}

function setRepeatEnabled(enabled, persist = true) {
	repeatEnabled = Boolean(enabled);
	audio.loop = repeatEnabled;
	if (repeatButton) {
		repeatButton.classList.toggle('active', repeatEnabled);
		repeatButton.setAttribute('aria-pressed', repeatEnabled ? 'true' : 'false');
	}
	if (persist) {
		try {
			localStorage.setItem(REPEAT_STATE_KEY, repeatEnabled ? 'true' : 'false');
		} catch (error) {
			console.warn('Failed to save repeat state', error);
		}
	}
}

setRepeatEnabled(readRepeatState(), false);

/**
 * ☆=========================================☆
 * Runtime - audio wiring, play/repeat controls, blob fallback
 * The shared playback STATE now lives in playback-state.js (loaded first); this
 * file wires behavior on top of it: the play/pause icon sync, repeat mode, and
 * the stale-blob fallback. The <audio> element is owned by starlPlaybackState;
 * Keeping a global `audio` alias here so existing bare `audio` references keep working.
 * Android notification + media session live in runtime-notifications.js (loaded after).
 *
 * --- What this file does? ---
 * - Aliases the shared <audio> element as a global `audio` (back-compat)
 * - setPlayIconState(): syncs all play/pause icon buttons to the current state
 * - setRepeatEnabled(): toggles repeat mode and persists it to localStorage
 * - Blob fallback: if a cached blob URL is revoked, switches to the stream URL
 *
 * --- Dictionary / Terms / Extra details ---
 * - "blob fallback" = when a cached audio blob is revoked, switches to stream URL
 * - All mutable state (currentTrackKey, repeatEnabled, native flags...) is read
 *   and written through window.starlPlaybackState - this file owns no state of its own.
 * ☆=========================================☆
 */

/* ☆======= Audio element (alias of the owned instance) =======☆ */

const audio = window.starlPlaybackState.audio;

/* ☆======= Blob fallback =======☆ */

// if a blob URL fails (stale/revoked), switch to the network stream URL.
// Mobile browsers can aggressively revoke blobs, so this prevents a silent crash-restart loop.
audio.addEventListener('error', () => {
	const state = window.starlPlaybackState;
	if (state.blobFallbackInProgress) return;
	const src = audio.src || '';
	if (!/^blob:/i.test(src)) return;
	if (!state.currentStreamUrl || /^blob:/i.test(state.currentStreamUrl)) return;

	state.blobFallbackInProgress = true;
	console.warn('Stale blob URL detected, falling back to stream URL');

	const savedPosition = Number(audio.currentTime) || 0;

	const token = typeof getAccessToken === 'function' ? getAccessToken() : localStorage.getItem('starl_access_token');
	const sep = state.currentStreamUrl.includes('?') ? '&' : '?';
	const fallback = token
		? state.currentStreamUrl + sep + 'token=' + encodeURIComponent(token)
		: state.currentStreamUrl;

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
			state.blobFallbackInProgress = false;
		});
});

/* ☆======= Play buttons + repeat =======☆ */

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
		return localStorage.getItem(window.starlPlaybackState.REPEAT_STATE_KEY) === 'true';
	} catch (error) {
		return false;
	}
}

function setRepeatEnabled(enabled, persist = true) {
	const state = window.starlPlaybackState;
	state.repeatEnabled = Boolean(enabled);
	audio.loop = state.repeatEnabled;
	if (repeatButton) {
		repeatButton.classList.toggle('active', state.repeatEnabled);
		repeatButton.setAttribute('aria-pressed', state.repeatEnabled ? 'true' : 'false');
	}
	if (persist) {
		try {
			localStorage.setItem(state.REPEAT_STATE_KEY, state.repeatEnabled ? 'true' : 'false');
		} catch (error) {
			console.warn('Failed to save repeat state', error);
		}
	}
}

setRepeatEnabled(readRepeatState(), false);

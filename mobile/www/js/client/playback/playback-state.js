/**
 * ☆=========================================☆
 * Playback state - the single owner of shared playback state
 * Every other playback file (runtime, engine, meta, media-session, notifications)
 * used to reach for bare globals declared in runtime.js.
 *
 * --- What this file does? ---
 * - Creates and owns the single <audio> element (window.starlPlaybackState.audio)
 * - Holds playback state (currentTrackKey, currentStreamUrl, isLoadingTrack, ...)
 * - Holds native music-controls / media-session state (lastTrackMeta, flags, ...)
 * - Owns the localStorage key names (player state + repeat state)
 * - reset(): clears the "what's playing" identity (used on logout / clear-track)
 *
 * --- Dictionary / Terms / Extra details ---
 * - Loaded FIRST in the playback group so window.starlPlaybackState always exists
 *   before any other playback code runs - load order no longer affects correctness.
 * - runtime.js keeps a global `audio` alias pointing here, only so the ~90 existing
 *   bare `audio` references keep working; new code should use starlPlaybackState.audio
 * ☆=========================================☆
 */

(function () {
	const keys = (window.starlShared && window.starlShared.keys) || {};

	// the one <audio> element for the whole app. created and owned here so there is
	// a single, unambiguous owner instead of a bare `const audio` floating in runtime.js
	const audio = new Audio();
	audio.preload = 'metadata';

	window.starlPlaybackState = {
		/* ☆======= Audio element =======☆ */
		audio,

		/* ☆======= localStorage key names (single owner) =======☆ */
		PLAYER_STATE_KEY: keys.playerState || 'starl_player_state',
		REPEAT_STATE_KEY: keys.repeatState || 'starl_player_repeat',

		/* ☆======= Playback state =======☆ */
		currentTrackKey: '',
		currentStreamUrl: '',
		isLive: false,
		hls: null,
		isLoadingTrack: false,
		isLoadingSince: 0,
		lastNavDirection: 1,
		repeatEnabled: false,
		queueLoopEnabled: false,
		blobFallbackInProgress: false,
		lastStateSaveMs: 0,
		shouldBePlaying: false,

		/* ☆======= Native music controls + media session state =======☆ */
		nativeMusicControlsReady: false,
		lastNativeElapsedUpdateMs: 0,
		lastTrackMeta: null,
		lastNativeElapsedSeconds: 0,
		lastNativeTrackKey: '',
		cordovaDeviceReady: false,
		notificationsPermissionKnown: false,
		notificationsPermissionGranted: true,
		lastNativeArtworkUrl: '',

		/* ☆======= Helpers =======☆ */
		// clears the "what's playing" identity. called on logout and clear-track so
		// setPlayerOpen() correctly hides the player once nothing is loaded.
		reset() {
			this.currentTrackKey = '';
			this.currentStreamUrl = '';
		},
	};
})();

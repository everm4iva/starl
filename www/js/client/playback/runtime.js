/*
Playback runtime
-> this is the engine room for audio, notifications, background play, and media session sync.
-> it keeps the sound alive, keeps Android controls talking, and updates the track state.
-> when the song plays, pauses, or seeks, this file is the one doing the talking.
*/

// ----- Audio playback + streaming -----
const audio = new Audio();
audio.preload = 'metadata';

// ----- Native Android notification via cordova-plugin-starl-music-controls -----
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

async function blobUrlToDataUrl(blobUrl) {
	if (!blobUrl || !/^blob:/i.test(blobUrl)) {
		return blobUrl || '';
	}
	const response = await fetch(blobUrl);
	if (!response.ok) {
		return '';
	}
	const blob = await response.blob();
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(String(reader.result || ''));
		reader.onerror = () => reject(reader.error || new Error('Failed to convert cached artwork'));
		reader.readAsDataURL(blob);
	});
}

function canUseNativeMusicControls() {
	return typeof window !== 'undefined' && window.MusicControls && typeof window.MusicControls.create === 'function';
}

function canUseBackgroundPlugin() {
	return (
		typeof window !== 'undefined' &&
		window.StarlBackground &&
		typeof window.StarlBackground.isIgnoringBatteryOptimizations === 'function'
	);
}

function getPermissionsPlugin() {
	try {
		return window.cordova && cordova.plugins && cordova.plugins.permissions ? cordova.plugins.permissions : null;
	} catch (error) {
		return null;
	}
}

function ensurePostNotificationsPermission() {
	return new Promise((resolve) => {
		const permissions = getPermissionsPlugin();
		if (!permissions) {
			resolve(true);
			return;
		}
		if (!(window.cordova && cordova.platformId === 'android')) {
			resolve(true);
			return;
		}
		if (!permissions.POST_NOTIFICATIONS) {
			resolve(true);
			return;
		}

		const checkFn =
			typeof permissions.checkPermission === 'function' ? permissions.checkPermission : permissions.hasPermission;
		checkFn(
			permissions.POST_NOTIFICATIONS,
			(status) => {
				if (status && status.hasPermission) {
					resolve(true);
					return;
				}
				permissions.requestPermission(
					permissions.POST_NOTIFICATIONS,
					(reqStatus) => resolve(Boolean(reqStatus && reqStatus.hasPermission)),
					() => resolve(false),
				);
			},
			() => resolve(false),
		);
	});
}

// When the Cordova app is backgrounded, attempt to hand off playback to the
// native foreground service so notifications and play/pause work while
// the WebView is suspended. On resume, stop native playback and restore web audio.
document.addEventListener('pause', async () => {
	try {
		if (typeof MusicControls !== 'undefined' && canUseNativeMusicControls() && !audio.paused && currentStreamUrl) {
			// Some platform/plugin combinations expose `MusicControls.create` but
			// do not implement the native handoff helpers. Guard against that
			// to avoid TypeErrors in environments where `startNative` is absent.
			if (typeof MusicControls.startNative === 'function') {
				await new Promise((res, rej) => MusicControls.startNative(currentStreamUrl, res, rej));
				try {
					audio.pause();
				} catch (e) {}
				nativePlaybackActive = true;
			} else {
				console.warn('MusicControls.startNative not available on this platform; skipping native handoff');
			}
		}
	} catch (error) {
		console.warn('Native handoff failed', error);
	}
});

document.addEventListener('resume', async () => {
	try {
		if (nativePlaybackActive && typeof MusicControls !== 'undefined' && canUseNativeMusicControls()) {
			await new Promise((res, rej) => MusicControls.stopNative(res, rej));
			nativePlaybackActive = false;
			try {
				await playStream(currentStreamUrl, getAccessToken());
			} catch (e) {
				console.warn('Failed to resume web audio after native handoff', e);
			}
		}
	} catch (error) {
		console.warn('Native stop failed', error);
	}
});

function ensureBatteryOptimizationExemption() {
	if (!(window.cordova && cordova.platformId === 'android') || !canUseBackgroundPlugin()) {
		return;
	}

	try {
		window.StarlBackground.isIgnoringBatteryOptimizations(
			(isIgnoring) => {
				if (isIgnoring) {
					return;
				}

				let alreadyPrompted = false;
				try {
					alreadyPrompted = localStorage.getItem('starl_battery_prompted') === '1';
				} catch (error) {}

				if (alreadyPrompted) {
					return;
				}

				const shouldRequest = window.confirm(
					'Allow Starl to ignore battery optimizations so music can keep playing in the background?',
				);

				try {
					localStorage.setItem('starl_battery_prompted', '1');
				} catch (error) {}

				if (!shouldRequest) {
					return;
				}

				window.StarlBackground.requestIgnoreBatteryOptimizations(
					() => {},
					() => {
						try {
							window.StarlBackground.openBatteryOptimizationSettings(
								() => {},
								() => {},
							);
						} catch (error) {}
					},
				);
			},
			() => {},
		);
	} catch (error) {}
}

function parseNativeMusicControlMessage(raw) {
	if (!raw) {
		return {message: ''};
	}
	if (typeof raw === 'string') {
		try {
			return JSON.parse(raw);
		} catch (error) {
			return {message: raw};
		}
	}
	return raw;
}

function handleNativeMusicControlMessage(raw) {
	const payload = parseNativeMusicControlMessage(raw);
	const message = String(payload.message || payload.action || payload.event || '').toLowerCase();

	if (message === 'music-controls-play') {
		audio
			.play()
			.then(() => {
				setPlayIconState(true);
				updateStoredState({isPlaying: true});
				try {
					window.MusicControls.updateIsPlaying(
						true,
						() => {},
						() => {},
					);
				} catch (error) {}
			})
			.catch(() => {});
		return;
	}

	if (message === 'music-controls-pause') {
		try {
			audio.pause();
		} catch (error) {}
		setPlayIconState(false);
		updateStoredState({isPlaying: false});
		try {
			window.MusicControls.updateIsPlaying(
				false,
				() => {},
				() => {},
			);
		} catch (error) {}
		return;
	}

	if (message === 'music-controls-media-button' || message === 'music-controls-headset-unplugged') {
		// Treat as play/pause toggle.
		if (audio.paused) {
			handleNativeMusicControlMessage({message: 'music-controls-play'});
		} else {
			handleNativeMusicControlMessage({message: 'music-controls-pause'});
		}
		return;
	}

	if (message === 'music-controls-next') {
		const queueApi = window.starlPlaybackQueue;
		if (queueApi && queueApi.getQueueLength() > 1) {
			const next = queueApi.nextTrack();
			if (next && window.starlPlayer && typeof trackToPlayItem === 'function') {
				window.starlPlayer.playFromSearch(trackToPlayItem(next));
			}
		}
		return;
	}

	if (message === 'music-controls-previous') {
		const queueApi = window.starlPlaybackQueue;
		if (queueApi && queueApi.getQueueLength() > 1) {
			const prev = queueApi.previousTrack();
			if (prev && window.starlPlayer && typeof trackToPlayItem === 'function') {
				window.starlPlayer.playFromSearch(trackToPlayItem(prev));
			}
		}
		return;
	}

	if (message === 'music-controls-seek-to') {
		const position = Number(payload.position);
		if (Number.isFinite(position)) {
			try {
				audio.currentTime = position;
				updateStoredState({position});
			} catch (error) {}
		}
		return;
	}

	if (message === 'music-controls-destroy' || message === 'music-controls-close') {
		try {
			window.MusicControls.destroy(
				() => {},
				() => {},
			);
		} catch (error) {}
		return;
	}
}

function initNativeMusicControls() {
	if (nativeMusicControlsReady || !canUseNativeMusicControls()) {
		return;
	}
	nativeMusicControlsReady = true;
	try {
		window.MusicControls.subscribe(handleNativeMusicControlMessage);
		window.MusicControls.listen();
	} catch (error) {
		console.warn('Failed to init native music controls', error);
	}
}

async function resolveNativeArtworkUrl(meta) {
	const sourceUrl = meta && meta.imageUrl ? prepareArtworkUrl(meta.imageUrl) : '';
	if (!sourceUrl) {
		return '';
	}
	try {
		const cache = getMediaCache();
		if (cache && typeof cache.resolveImageUrl === 'function' && meta && meta.imageUrl) {
			const cachedUrl = await cache.resolveImageUrl(meta.imageUrl);
			if (cachedUrl) {
				return await blobUrlToDataUrl(cachedUrl);
			}
		}
	} catch (error) {}
	return sourceUrl;
}

function createOrUpdateNativeNotification(meta) {
	if (!canUseNativeMusicControls()) {
		return;
	}
	// Avoid creating the notification before deviceready / permission flow.
	if (!cordovaDeviceReady || !notificationsPermissionKnown || !notificationsPermissionGranted) {
		lastTrackMeta = meta || lastTrackMeta;
		return;
	}
	lastTrackMeta = meta || lastTrackMeta;
	const currentMeta = lastTrackMeta;
	if (!currentMeta) {
		return;
	}

	const duration = Number(currentMeta.duration) || 0;
	const elapsed = Math.floor(Number(audio.currentTime) || 0);
	const cover = currentMeta.imageUrl ? prepareArtworkUrl(currentMeta.imageUrl) : '';
	lastNativeArtworkUrl = cover;

	try {
		window.MusicControls.create(
			{
				track: currentMeta.title || 'Untitled',
				artist: currentMeta.artist || '',
				album: currentMeta.album || '',
				cover,
				ticker: currentMeta.title || 'Now playing',
				duration: duration ? Math.floor(duration) : 0,
				elapsed: elapsed,
				isPlaying: !audio.paused,
				hasPrev: true,
				hasNext: true,
				hasSkipForward: false,
				hasSkipBackward: false,
				hasScrubbing: true,
				skipForwardInterval: 10,
				skipBackwardInterval: 10,
				hasClose: true,
				dismissable: true,
			},
			() => {},
			(err) => console.warn('MusicControls.create error', err),
		);
		window.MusicControls.listen();
		resolveNativeArtworkUrl(currentMeta)
			.then((resolvedCover) => {
				if (!resolvedCover || resolvedCover === lastNativeArtworkUrl) {
					return;
				}
				if (lastTrackMeta !== currentMeta) {
					return;
				}
				lastNativeArtworkUrl = resolvedCover;
				window.MusicControls.create(
					{
						track: currentMeta.title || 'Untitled',
						artist: currentMeta.artist || '',
						album: currentMeta.album || '',
						cover: resolvedCover,
						ticker: currentMeta.title || 'Now playing',
						duration: duration ? Math.floor(duration) : 0,
						elapsed,
						isPlaying: !audio.paused,
						hasPrev: false,
						hasNext: false,
						hasSkipForward: true,
						hasSkipBackward: true,
						hasScrubbing: true,
						skipForwardInterval: 10,
						skipBackwardInterval: 10,
						hasClose: true,
						dismissable: true,
					},
					() => {},
					(err) => console.warn('MusicControls.create retry error', err),
				);
			})
			.catch(() => {});
	} catch (error) {
		console.warn('MusicControls.create failed', error);
	}
}

function updateNativePlayingState() {
	if (!canUseNativeMusicControls()) {
		return;
	}
	try {
		window.MusicControls.updateIsPlaying(
			!audio.paused,
			() => {},
			() => {},
		);
	} catch (error) {}
}

function updateNativeElapsedState(force = false) {
	if (!canUseNativeMusicControls()) {
		return;
	}
	const now = Date.now();
	if (!force && now - lastNativeElapsedUpdateMs < 1000) {
		return;
	}
	lastNativeElapsedUpdateMs = now;
	const currentTime = Number(audio.currentTime);
	if (!Number.isFinite(currentTime) || currentTime < 0) {
		// Avoid pushing invalid values (which would snap the native timebar to 0).
		return;
	}
	const duration = Number(audio.duration);
	const durationSeconds = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0;
	const elapsedSeconds = Math.floor(currentTime);

	// Keep elapsed monotonic while playing unless we clearly switched tracks.
	const trackKey =
		lastTrackMeta && (lastTrackMeta.id || lastTrackMeta.key || lastTrackMeta.streamUrl || lastTrackMeta.title)
			? String(lastTrackMeta.id || lastTrackMeta.key || lastTrackMeta.streamUrl || lastTrackMeta.title)
			: '';
	if (trackKey && trackKey !== lastNativeTrackKey) {
		lastNativeTrackKey = trackKey;
		lastNativeElapsedSeconds = 0;
	}
	const isPlaying = !audio.paused;
	const nearTrackEnd = durationSeconds > 0 && lastNativeElapsedSeconds >= Math.max(2, durationSeconds - 2);
	const loopRestart = isPlaying && elapsedSeconds <= 1 && nearTrackEnd;
	const backwardJump = isPlaying && elapsedSeconds + 2 < lastNativeElapsedSeconds && elapsedSeconds <= 1;

	if (loopRestart || backwardJump) {
		// Repeat mode or a deliberate restart: allow the native notification to return to 0.
		lastNativeElapsedSeconds = 0;
	} else if (isPlaying && elapsedSeconds === 0 && lastNativeElapsedSeconds > 2) {
		// Likely a transient WebView/decoder hiccup; don't reset the bar.
		return;
	} else {
		lastNativeElapsedSeconds = Math.max(lastNativeElapsedSeconds, elapsedSeconds);
	}
	try {
		window.MusicControls.updateElapsed(
			{
				elapsed:
					lastNativeElapsedSeconds === 0 && elapsedSeconds <= 1 ? elapsedSeconds : lastNativeElapsedSeconds,
				duration: durationSeconds,
				isPlaying,
			},
			() => {},
			() => {},
		);
	} catch (error) {}
}

document.addEventListener('deviceready', async () => {
	cordovaDeviceReady = true;
	const granted = await ensurePostNotificationsPermission();
	notificationsPermissionKnown = true;
	notificationsPermissionGranted = Boolean(granted);
	if (!notificationsPermissionGranted) {
		console.warn('POST_NOTIFICATIONS not granted; Android may hide media notifications.');
	}
	initNativeMusicControls();
	ensureBatteryOptimizationExemption();
	// Make status bar transparent with light (white) icons when possible
	try {
		if (window.StatusBar) {
			// Let the webview draw under the status bar
			if (typeof StatusBar.overlaysWebView === 'function') {
				StatusBar.overlaysWebView(true);
			}
			// Transparent background
			if (typeof StatusBar.backgroundColorByHexString === 'function') {
				StatusBar.backgroundColorByHexString('#00000000');
			}
			// Use light content (white) icons/text where supported
			if (typeof StatusBar.styleLightContent === 'function') {
				StatusBar.styleLightContent();
			}
		}
	} catch (e) {}
	if (lastTrackMeta) {
		createOrUpdateNativeNotification(lastTrackMeta);
	}
});

// ----- Media Session (Android notification / lock screen) -----
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
		// Ignore unsupported actions.
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
			setPlayIconState(true);
			updateStoredState({isPlaying: true});
		} catch (error) {}
	});

	safeSetActionHandler('pause', () => {
		try {
			audio.pause();
			setPlayIconState(false);
			updateStoredState({isPlaying: false});
		} catch (error) {}
	});

	safeSetActionHandler('stop', () => {
		try {
			audio.pause();
			audio.currentTime = 0;
			setPlayIconState(false);
			updateStoredState({isPlaying: false, position: 0});
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

let isLoadingTrack = false;
let currentTrackKey = '';
let currentStreamUrl = '';
let repeatEnabled = false;

// Fallback: if a blob URL fails to load (stale/revoked), switch to the network stream URL.
// This prevents the crash-restart loop when a cached blob is no longer accessible.
let blobFallbackInProgress = false;
audio.addEventListener('error', () => {
	if (blobFallbackInProgress) return;
	const src = audio.src || '';
	if (!/^blob:/i.test(src)) return;
	if (!currentStreamUrl || /^blob:/i.test(currentStreamUrl)) return;

	blobFallbackInProgress = true;
	console.warn('Stale blob URL detected, falling back to stream URL');

	const token = typeof getAccessToken === 'function' ? getAccessToken() : localStorage.getItem('starl_access_token');
	const sep = currentStreamUrl.includes('?') ? '&' : '?';
	const fallback = token ? currentStreamUrl + sep + 'token=' + encodeURIComponent(token) : currentStreamUrl;

	audio.src = fallback;
	audio.load();
	audio.play().catch(() => {}).finally(() => { blobFallbackInProgress = false; });
});

const PLAYER_STATE_KEY =
	window.starlShared && window.starlShared.keys ? window.starlShared.keys.playerState : 'starl_player_state';
const REPEAT_STATE_KEY =
	window.starlShared && window.starlShared.keys ? window.starlShared.keys.repeatState : 'starl_player_repeat';
let lastStateSaveMs = 0;

// Play buttons finder — only the actual pause/play toggle buttons, not shuffle/repeat/nav
function getPlayButtons() {
	const buttons = Array.from(
		document.querySelectorAll(
			'.mp-controls-btncontainer .mp-btn.icon.pause,' +
			'.mp-controls-btncontainer .mp-btn.icon.play,' +
			'.mini-player-controls .mini-player-btn.icon.pause,' +
			'.mini-player-controls .mini-player-btn.icon.play',
		),
	);
	// If no matched yet (before first playback), fall back to the element that has neither shuffle/repeat/skip classes
	if (!buttons.length) {
		return Array.from(document.querySelectorAll(
			'.mp-controls-btncontainer .mp-btn.icon:not(.shuffle):not(.repeat):not(.skip-previous):not(.skip-next),' +
			'.mini-player-controls .mini-player-btn.icon:not(.shuffle):not(.repeat):not(.skip-previous):not(.skip-next)',
		)).filter(Boolean);
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

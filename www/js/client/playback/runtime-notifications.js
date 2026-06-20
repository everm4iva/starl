/**
 * ☆=========================================☆
 * Runtime notifications - Android media controls + Web Media Session
 * Drives the lock-screen/notification player and the browser Media Session API.
 * Reads/writes shared state through window.starlPlaybackState (nativeMusicControlsReady,
 * cordovaDeviceReady, lastTrackMeta, the elapsed-tracking fields, etc.) and uses the
 * `audio` element aliased by runtime.js.
 *
 * --- What this file does? ---
 * - createOrUpdateNativeNotification(): builds/refreshes the Android media notification
 * - handleNativeMusicControlMessage(): routes play/pause/next/prev from the notification
 * - initNativeMusicControls(): subscribes to MusicControls events on deviceready
 * - initMediaSession(): wires the Web Media Session action handlers
 * - updateMediaSessionPlaybackState() / updateMediaSessionPositionState(): keeps
 *   the browser media controls in sync with the audio element
 * - updateNativePlayingState() / updateNativeElapsedState(): keeps the Android
 *   notification bar in sync
 * - ensureBatteryOptimizationExemption(): prompts the user to exempt from Doze
 *
 * --- Dictionary / Terms / Extra details ---
 * - "native music controls" = the Android notification/lock screen control
 * - "media session" = browser API for OS media controls (not Android-specific)
 * - "shouldBePlaying" (starlPlaybackState) = intent flag: true whenever audio should be
 *   playing/resume, even if a backgrounded play() was silently rejected by Android
 * ☆=========================================☆
 */

/* ☆======= Native music controls (Android notification) =======☆ */

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

// IMPORTANT: do NOT pause the WebView audio or hand off to a native MediaPlayer
// when the app is backgrounded. With KeepRunning=true (config.xml) plus the
// media foreground service that runs while playing, the WebView's <audio> keeps
// playing on its own in the background - including offline blob: tracks, which a
// native MediaPlayer cannot open at all. The old handoff paused the working web
// audio and replaced it with a native player that died within seconds (and was
// silent for cached tracks), which is exactly what broke background playback.
// leaving web audio untouched here restores the original online+offline behavior.

document.addEventListener('resume', async () => {
	try {
		// the token refresh timer doesn't fire while the app is backgrounded.
		// proactively refresh if the token expired or is about to, so the
		// resumed stream request doesn't fail with 401.
		const auth = window.starlAuth;
		if (auth) {
			const token = auth.getAccessToken();
			if (
				token &&
				typeof auth.isTokenExpiredOrExpiringSoon === 'function' &&
				auth.isTokenExpiredOrExpiringSoon(token, 60 * 1000)
			) {
				const refreshed = await auth.tryRefreshToken();
				if (!refreshed) {
					auth.clearAccessToken();
					auth.redirectToLogin();
					return;
				}
				const newToken = auth.getAccessToken();
				if (newToken && typeof auth.scheduleTokenRefresh === 'function') {
					auth.scheduleTokenRefresh(newToken);
				}
			}
		}

		// Android may kill the WebView process and restarte the foreground
		// service while backgrounded, leaving a degraded fallback notification.
		// Rebuild the full notification so it shows cover art and proper controls.
		const pb = window.starlPlaybackState;
		if (pb.lastTrackMeta && pb.nativeMusicControlsReady) {
			createOrUpdateNativeNotification(pb.lastTrackMeta);
		}

		// web audio normally keeps playing in the background on its own (KeepRunning +
		// the media foreground service). but a backgrounded queue auto-advance can have
		// its audio.play() silently rejected by Android (untrusted-gesture policy) - if so,
		// shouldBePlaying stays true while audio.paused is true. the 'resume' callback is
		// itself an OS-trusted context (same family as a notification button tap), so this
		// is the most efficient place to recover: catch the queue up the instant they reopen
		// the app, before they even look at the player.
		if (pb.shouldBePlaying && audio.paused && audio.src) {
			try {
				await audio.play();
				setPlayIconState(true);
				updateStoredState({isPlaying: true});
				updateMediaSessionPlaybackState();
				updateNativePlayingState();
			} catch (resumeError) {
				// still rejected - leave the honest paused state; the notification's
				// play button is a real user gesture the WebView will allow.
			}
		}
	} catch (error) {
		console.warn('Resume handler failed', error);
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

				const shouldRequest = window.confirm(
					'Allow Starl to ignore battery optimizations so music can keep playing in the background?',
				);

				if (!shouldRequest) {
					return;
				}

				// learned this from a friend.. nice code, shame on me if it doesn't work
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

// parseNativeMusicControlMessage / handleNativeMusicControlMessage
// are defined in runtime-notifications-handler.js (loaded before this file)

function initNativeMusicControls() {
	if (window.starlPlaybackState.nativeMusicControlsReady || !canUseNativeMusicControls()) {
		return;
	}
	window.starlPlaybackState.nativeMusicControlsReady = true;
	try {
		window.MusicControls.subscribe(handleNativeMusicControlMessage);
		window.MusicControls.listen();
	} catch (error) {
		console.warn('Failed to init native music controls', error);
	}
}

// prepareArtworkUrl and getMediaCache are declared in layout.js (global scope, loaded before this file)

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
	const pb = window.starlPlaybackState;
	if (!canUseNativeMusicControls()) {
		return;
	}
	// DO NOT create the notification before deviceready / permission flow. :3
	if (!pb.cordovaDeviceReady || !pb.notificationsPermissionKnown || !pb.notificationsPermissionGranted) {
		pb.lastTrackMeta = meta || pb.lastTrackMeta;
		return;
	}
	pb.lastTrackMeta = meta || pb.lastTrackMeta;
	const currentMeta = pb.lastTrackMeta;
	if (!currentMeta) {
		return;
	}

	const duration = Number(currentMeta.duration) || 0;
	const elapsed = Math.floor(Number(audio.currentTime) || 0);
	const cover = currentMeta.imageUrl ? prepareArtworkUrl(currentMeta.imageUrl) : '';
	pb.lastNativeArtworkUrl = cover;

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
				if (!resolvedCover || resolvedCover === pb.lastNativeArtworkUrl) {
					return;
				}
				if (pb.lastTrackMeta !== currentMeta) {
					return;
				}
				pb.lastNativeArtworkUrl = resolvedCover;
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
					(err) => console.warn('MusicControls.create retry error', err),
				);
			})
			.catch(() => {});
	} catch (error) {
		console.warn('MusicControls.create failed', error);
	}
}

let _nativePlayingStateTimer = null;
function updateNativePlayingState() {
	if (!canUseNativeMusicControls()) {
		return;
	}
	// debounce: audio briefly pauses during buffering/reconnect/offline can fire
	clearTimeout(_nativePlayingStateTimer);
	_nativePlayingStateTimer = setTimeout(() => {
		try {
			window.MusicControls.updateIsPlaying(
				!audio.paused,
				() => {},
				() => {},
			);
		} catch (error) {}
	}, 200);
}

function updateNativeElapsedState(force = false) {
	const pb = window.starlPlaybackState;
	if (!canUseNativeMusicControls()) {
		return;
	}
	const now = Date.now();
	if (!force && now - pb.lastNativeElapsedUpdateMs < 1000) {
		return;
	}
	pb.lastNativeElapsedUpdateMs = now;
	const currentTime = Number(audio.currentTime);
	if (!Number.isFinite(currentTime) || currentTime < 0) {
		// avoid pushing invalid values (which would snap the native timebar to 0). :O
		return;
	}
	const duration = Number(audio.duration);
	const durationSeconds = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0;
	const elapsedSeconds = Math.floor(currentTime);

	// keep elapsed "monotonic" while playing unless user clearly switched tracks.
	const lastTrackMeta = pb.lastTrackMeta;
	const trackKey =
		lastTrackMeta && (lastTrackMeta.id || lastTrackMeta.key || lastTrackMeta.streamUrl || lastTrackMeta.title)
			? String(lastTrackMeta.id || lastTrackMeta.key || lastTrackMeta.streamUrl || lastTrackMeta.title)
			: '';
	if (trackKey && trackKey !== pb.lastNativeTrackKey) {
		pb.lastNativeTrackKey = trackKey;
		pb.lastNativeElapsedSeconds = 0;
	}
	const isPlaying = !audio.paused;
	const nearTrackEnd = durationSeconds > 0 && pb.lastNativeElapsedSeconds >= Math.max(2, durationSeconds - 2);
	const loopRestart = isPlaying && elapsedSeconds <= 1 && nearTrackEnd;
	const backwardJump = isPlaying && elapsedSeconds + 2 < pb.lastNativeElapsedSeconds && elapsedSeconds <= 1;

	if (loopRestart || backwardJump) {
		// repeat mode or a deliberate restart: allow the native notification to return to 0.
		pb.lastNativeElapsedSeconds = 0;
	} else if (isPlaying && elapsedSeconds === 0 && pb.lastNativeElapsedSeconds > 2) {
		// likely a transient WebView/decoder "hiccup"; don't reset the bar.
		return;
	} else {
		pb.lastNativeElapsedSeconds = Math.max(pb.lastNativeElapsedSeconds, elapsedSeconds);
	}
	try {
		window.MusicControls.updateElapsed(
			{
				elapsed:
					pb.lastNativeElapsedSeconds === 0 && elapsedSeconds <= 1
						? elapsedSeconds
						: pb.lastNativeElapsedSeconds,
				duration: durationSeconds,
				isPlaying,
			},
			() => {},
			() => {},
		);
	} catch (error) {}
}

document.addEventListener('deviceready', async () => {
	const pb = window.starlPlaybackState;
	pb.cordovaDeviceReady = true;
	window._starlDeviceReady = true;
	const granted = await ensurePostNotificationsPermission();
	pb.notificationsPermissionKnown = true;
	pb.notificationsPermissionGranted = Boolean(granted);
	if (!pb.notificationsPermissionGranted) {
		console.warn('POST_NOTIFICATIONS not granted; Android may hide media notifications.');
	}
	initNativeMusicControls();
	ensureBatteryOptimizationExemption();
	// cold-start: check if the app was launched by tapping the notification
	if (canUseNativeMusicControls() && typeof window.MusicControls.getAndClearPendingOpenPlayer === 'function') {
		window.MusicControls.getAndClearPendingOpenPlayer(
			(flag) => {
				if (flag && typeof setPlayerOpen === 'function') setPlayerOpen(true);
			},
			() => {},
		);
	}
	// make status bar transparent with light (white) icons when possible
	try {
		if (window.StatusBar) {
			if (typeof StatusBar.overlaysWebView === 'function') {
				StatusBar.overlaysWebView(true);
			}
			if (typeof StatusBar.backgroundColorByHexString === 'function') {
				StatusBar.backgroundColorByHexString('#00000000');
			}
			if (typeof StatusBar.styleLightContent === 'function') {
				StatusBar.styleLightContent();
			}
		}
	} catch (e) {}
	if (pb.lastTrackMeta) {
		createOrUpdateNativeNotification(pb.lastTrackMeta);
	}
});

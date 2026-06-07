/**
 * ☆=========================================☆
 * Runtime notifications - Android media controls + Web Media Session
 * Drives the lock-screen/notification player and the browser Media Session API.
 * Depends on runtime.js (loaded first) for: audio, nativeMusicControlsReady,
 * cordovaDeviceReady, lastTrackMeta, and the other state vars declared there.
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
 * - "nativePlaybackActive" = WebView is backgrounded, driving the native service
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

		// web audio keeps playing in the background on its own (KeepRunning + the media foreground service), so there's nothing to resume here.
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
	if (!canUseNativeMusicControls()) {
		return;
	}
	// DO NOT creating the notification before deviceready / permission flow. :3
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
		// avoid pushing invalid values (which would snap the native timebar to 0). :O
		return;
	}
	const duration = Number(audio.duration);
	const durationSeconds = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0;
	const elapsedSeconds = Math.floor(currentTime);

	// keep elapsed "monotonic" while playing unless we clearly switched tracks.
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
		// repeat mode or a deliberate restart: allow the native notification to return to 0.
		lastNativeElapsedSeconds = 0;
	} else if (isPlaying && elapsedSeconds === 0 && lastNativeElapsedSeconds > 2) {
		// likely a transient WebView/decoder "hiccup"; don't reset the bar.
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
	if (lastTrackMeta) {
		createOrUpdateNativeNotification(lastTrackMeta);
	}
});

// initMediaSession / updateMediaSessionPlaybackState / updateMediaSessionPositionState
// are defined in runtime-media-session.js (loaded before this file)

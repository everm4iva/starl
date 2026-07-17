/**
 * ☆=========================================☆
 * Engine - state persistence, stream helpers, audio event listeners
 * The first half of the playback engine. Lives on top of runtime.js
 * (which owns the <audio> element and global state vars)
 * The starlPlayer API + state restore + queue live in engine-player.js (loaded after)
 *
 * --- What this file does? ---
 * - savePlayerState() / readPlayerState() / updateStoredState(): localStorage persistence
 * - playStream(): points the <audio> element at a URL and starts playback
 * - getCachedPlayableTrackUrl(): checks the local cache for an offline copy first
 * - Audio event listeners: loadedmetadata, timeupdate, ended, play, pause, scrub
 * - dispatchPlaybackState(): fires 'starl-playback-changed' custom event
 *
 * --- Dictionary / Terms / Extra details ---
 * - "trackKey" = canonical identifier for a track (usually its source URL)
 * - updateNativeElapsedState / updateMediaSession* are defined in runtime-notifications.js
 * ☆=========================================☆
 */

/* ☆======= State persistence =======☆ */

function savePlayerState(partial) {
	try {
		const now = Date.now();
		const data = partial || {};
		const serialized = JSON.stringify(data);
		localStorage.setItem(window.starlPlaybackState.PLAYER_STATE_KEY, serialized);
		window.starlPlaybackState.lastStateSaveMs = now;
	} catch (error) {
		console.warn('Failed to save player state', error);
	}
}

function readPlayerState() {
	try {
		const raw = localStorage.getItem(window.starlPlaybackState.PLAYER_STATE_KEY);
		if (!raw) {
			return null;
		}
		return JSON.parse(raw);
	} catch (error) {
		console.warn('Failed to read player state', error);
		return null;
	}
}

function updateStoredState(overrides) {
	const base = readPlayerState() || {};
	const next = {...base, ...overrides, updatedAt: Date.now()};
	savePlayerState(next);
}

/* ☆======= Stream helpers =======☆ */

function getCanonicalArtworkUrl(item, downloadData = null) {
	const apiBase = getApiBase();
	const apiArtwork = downloadData
		? downloadData.image_url
			? toAbsoluteUrl(apiBase, downloadData.image_url)
			: downloadData.thumbnail || ''
		: '';
	const itemArtwork = String((item && (item.imageUrl || item.thumbnail)) || '').trim();
	const rawArtwork = apiArtwork || itemArtwork;
	return rawArtwork ? upgradeArtworkUrl(rawArtwork) : '';
}

// retry-after-failure bookkeeping for playStream(). the token guards against a
// newer playStream() call (a real track change) being "glubglublgub" by a stale retry
// chain that was still waiting to fire for a previous track
let _playRetryTimer = null;
let _playRetryAttemptToken = 0;
const PLAY_RETRY_DELAYS_MS = [2000, 2000, 3000, 3000, 5000];

function clearPlayRetries() {
	if (_playRetryTimer) {
		clearTimeout(_playRetryTimer);
		_playRetryTimer = null;
	}
}

function schedulePlayRetries(streamUrl, attemptToken, delays) {
	if (!delays.length) return;
	const [delay, ...rest] = delays;
	_playRetryTimer = setTimeout(async () => {
		_playRetryTimer = null;
		const pb = window.starlPlaybackState;
		// bail if a newer playStream() call overcalled this one, the user/another
		// path deliberately paused, the src changed, or it's already playing again
		// overcalled = a new playStream() started for a different track or the same track again, so this retry is not important
		if (
			attemptToken !== _playRetryAttemptToken ||
			!pb.shouldBePlaying ||
			audio.src !== streamUrl ||
			!audio.paused
		) {
			return;
		}
		try {
			await audio.play();
			console.log('[starl-bg] retry recovered playback');
			setPlayIconState(true);
			updateStoredState({isPlaying: true});
			updateMediaSessionPlaybackState();
			updateNativePlayingState();
		} catch (error) {
			schedulePlayRetries(streamUrl, attemptToken, rest);
		}
	}, delay);
}

let _resumeWatchdogTimer = null;
const RESUME_WATCHDOG_DELAYS_MS = [120, 350, 800, 1600, 3000];

let _lastPlayingStartMs = 0;
const RESUME_WATCHDOG_ARM_WINDOW_MS = 5000;

let _resumeWatchdogNudges = 0;
const RESUME_WATCHDOG_MAX_NUDGES = 3;

let _sustainedPlayTimer = null;
const RESUME_WATCHDOG_SUSTAINED_MS = 2500;

function clearResumeWatchdog() {
	if (_resumeWatchdogTimer) {
		clearTimeout(_resumeWatchdogTimer);
		_resumeWatchdogTimer = null;
	}
}

function scheduleResumeWatchdog(attempt) {
	if (attempt >= RESUME_WATCHDOG_DELAYS_MS.length) return;
	clearResumeWatchdog();
	_resumeWatchdogTimer = setTimeout(async () => {
		_resumeWatchdogTimer = null;
		const pb = window.starlPlaybackState;

		if (!pb.shouldBePlaying || !audio.src || audio.ended || pb.isLive || pb.isLoadingTrack) {
			return;
		}
		if (!audio.paused) return; // already playing again
		try {
			await audio.play();
			setPlayIconState(true);
			updateStoredState({isPlaying: true});
			updateMediaSessionPlaybackState();
			updateNativePlayingState();
		} catch (error) {
			scheduleResumeWatchdog(attempt + 1);
		}
	}, RESUME_WATCHDOG_DELAYS_MS[attempt]);
}

// tear down any active hls.js instance. called before every new play so a live session is
// never left attached to the shared <audio> element when switching to another track
function teardownHls() {
	const pb = window.starlPlaybackState;
	if (pb.hls) {
		try {
			pb.hls.destroy();
		} catch (e) {}
		pb.hls = null;
	}
}

// play a live HLS manifest. Android's WebView <audio> can't play m3u8 natively, so we feed
// it through hls.js (MediaSource)
async function playLiveStream(manifestUrl) {
	const pb = window.starlPlaybackState;
	const Hls = window.Hls;
	if (Hls && Hls.isSupported()) {
		// startLevel 0 = the lowest rendition. YouTube live is muxed-only (no audio-only
		// track), so we lock the cheapest video rendition and just play its audio.
		// for a 24/7 lo-fi stream latency is irrelevant, so we sit well back from the live
		// edge with a deep buffer - a brief network/proxy hiccup then rides through the
		// buffer instead of stalling playback (the default 3-segment edge sync stutters)
		// lofi is good :3
		const hls = new Hls({
			lowLatencyMode: false,
			enableWorker: true,
			startLevel: 0,
			capLevelToPlayerSize: false,
			liveSyncDurationCount: 8, // start ~8 segments behind the edge = a real comfy cushion
			liveMaxLatencyDurationCount: 60,
			maxBufferLength: 60, // seconds buffered ahead
			maxMaxBufferLength: 180,
			backBufferLength: 30,
			fragLoadingMaxRetry: 6,
			fragLoadingRetryDelay: 500,
		});
		pb.hls = hls;
		hls.on(Hls.Events.MANIFEST_PARSED, () => {
			try {
				hls.currentLevel = 0; // lock lowest; no quality adaptation needed for audio
			} catch (e) {}
		});
		hls.on(Hls.Events.ERROR, (evt, data) => {
			if (!data || !data.fatal) return;
			// a dropped live edge should reconnect, not surface a fatal "track failed" toast
			if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
				try {
					hls.startLoad();
				} catch (e) {}
			} else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
				try {
					hls.recoverMediaError();
				} catch (e) {}
			} else {
				// unrecoverable - stop and clear the spinner so the player isn't stuck loading
				teardownHls();
				setLoadingState(false);
				if (typeof showToast === 'function') showToast('Live stream unavailable.', 'danger');
			}
		});
		hls.loadSource(manifestUrl);
		hls.attachMedia(audio);
		await new Promise((resolve) => {
			hls.once(Hls.Events.MANIFEST_PARSED, resolve);
			setTimeout(resolve, 8000); // don't hang forever if the manifest never parses
		});
	} else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
		audio.src = manifestUrl;
		audio.load();
	} else {
		console.warn('HLS not supported - cannot play live stream');
		if (typeof showToast === 'function') showToast('Live streams are not supported on this device.', 'danger');
		setLoadingState(false);
		return;
	}
	try {
		await audio.play();
		pb.shouldBePlaying = true;
		setPlayIconState(true);
	} catch (e) {
		// loaded but autoplay was rejected (backgrounded) - reflect "should be playing" so the
		// notification/play button are correct; the user's next tap resumes it. clear the spinner
		// since no 'playing' event will fire to do it
		pb.shouldBePlaying = true;
		setPlayIconState(false);
		setLoadingState(false);
	}
}

async function playStream(streamUrl, token, isLive) {
	if (!streamUrl) {
		return;
	}
	clearPlayRetries();
	clearResumeWatchdog(); // a real track change cancels any pending background-resume nudge
	_resumeWatchdogNudges = 0; // fresh track = fresh rescue budget
	const attemptToken = ++_playRetryAttemptToken;
	const pb = window.starlPlaybackState;
	const isLocalSource = /^blob:|^data:|^file:/i.test(streamUrl);
	const separator = streamUrl.includes('?') ? '&' : '?';
	teardownHls(); // drop any prior live session before starting a new source
	audio.pause();
	audio.currentTime = 0;
	pb.currentStreamUrl = streamUrl;
	pb.isLive = Boolean(isLive);
	const finalSrc = isLocalSource || !token ? streamUrl : streamUrl + separator + 'token=' + encodeURIComponent(token);
	if (pb.isLive) {
		await playLiveStream(finalSrc);
		return;
	}
	audio.src = finalSrc;
	audio.load();
	try {
		await audio.play();
	} catch (error) {
		// auto-advance (queue 'ended'/'error' handlers) calls this without a direct user
		// gesture, which some Android WebView builds reject with NotAllowedError when the
		// app is backgrounded - even though the track loaded fine. one retry recovers it
		try {
			await audio.play();
		} catch (retryError) {
			// mark it as "should be playing" so the play button and notifications show the correct state,
			console.log('[starl-bg] play() rejected on advance, scheduling retries:', retryError && retryError.name);
			window.starlPlaybackState.shouldBePlaying = true;
			setPlayIconState(false);
			updateStoredState({isPlaying: false});
			updateMediaSessionPlaybackState();
			updateNativePlayingState();
			schedulePlayRetries(finalSrc, attemptToken, PLAY_RETRY_DELAYS_MS);
			return;
		}
	}
	window.starlPlaybackState.shouldBePlaying = true;
	setPlayIconState(true);
}

async function probeBlobUrl(url) {
	if (!url || !/^blob:/i.test(url)) return true;
	try {
		const r = await fetch(url);
		return r.ok;
	} catch (e) {
		return false;
	}
}

async function getCachedPlayableTrackUrl(cache, itemOrState) {
	if (!cache || typeof cache.getTrackUrl !== 'function' || !itemOrState) {
		return '';
	}
	const candidateKeys = [itemOrState.trackKey, itemOrState.url, itemOrState.sourceUrl, itemOrState.streamUrl]
		.map((value) => String(value || '').trim())
		.filter(Boolean);
	for (const candidateKey of candidateKeys) {
		try {
			const cachedUrl = await cache.getTrackUrl(candidateKey);
			if (cachedUrl) {
				// verify the blob URL is still alive - the browser may have revoked it to save mem
				if (await probeBlobUrl(cachedUrl)) {
					return cachedUrl;
				}
				// stale blob: revoke and recreate so a fresh object URL is returned
				if (typeof cache.revokeTrackUrl === 'function') {
					cache.revokeTrackUrl(candidateKey);
				}
				const retried = await cache.getTrackUrl(candidateKey);
				if (retried && (await probeBlobUrl(retried))) {
					return retried;
				}
			}
		} catch (error) {
			console.warn('Failed to check cached track', error);
		}
	}
	return '';
}

/* ☆======= Audio event listeners =======☆ */

audio.addEventListener('loadedmetadata', () => {
	// live HLS has no finite duration (audio.duration is Infinity) - no seek bar / max
	if (window.starlPlaybackState.isLive || !isFinite(Number(audio.duration))) {
		if (playerTime) {
			playerTime.min = '0';
			playerTime.max = '0';
			playerTime.value = '0';
		}
		setTimeVars(0, 0);
		updateSliderProgress();
		updateStoredState({duration: 0});
		return;
	}
	const streamDuration = Number(audio.duration) || 0;
	const lastTrackMeta = window.starlPlaybackState.lastTrackMeta;
	const metaDuration = Number(lastTrackMeta && lastTrackMeta.duration) || 0;
	const duration = metaDuration > streamDuration ? metaDuration : streamDuration;
	if (playerTime) {
		playerTime.min = '0';
		playerTime.max = duration ? String(Math.floor(duration)) : '0';
		playerTime.value = '0';
	}
	setTimeVars(0, duration);
	updateSliderProgress();
	updateStoredState({duration});
	updateMediaSessionPositionState(true);
	updateNativeElapsedState(true);
});

audio.addEventListener('timeupdate', () => {
	// live: no position/slider/persistence (and no native elapsed - it has no meaning)
	if (window.starlPlaybackState.isLive) {
		return;
	}
	const duration = Number(audio.duration) || 0;
	const current = Number(audio.currentTime) || 0;
	setTimeVars(current, duration);
	if (playerTime && !isScrubbing) {
		playerTime.value = String(Math.floor(current));
		// use the raw float for the visual bar so it glides instead of stepping per second
		const max = Number(playerTime.max) || duration;
		if (sliderProgress && max > 0) {
			sliderProgress.style.width = Math.min(100, (current / max) * 100).toFixed(3) + '%';
		} else {
			updateSliderProgress();
		}
	}
	const now = Date.now();
	if (now - window.starlPlaybackState.lastStateSaveMs > 900) {
		updateStoredState({position: current, isPlaying: !audio.paused});
		window.starlPlaybackState.lastStateSaveMs = now;
	}
	updateMediaSessionPositionState();
	updateNativeElapsedState();
});

audio.addEventListener('ended', () => {
	const pb = window.starlPlaybackState;
	// a live stream shouldn't fire 'ended'; if it does (edge drop), hls.js owns reconnection -
	// don't run the finite-track endedEarly resume/position logic against it
	if (pb.isLive) {
		return;
	}
	setPlayIconState(false);
	const duration = Number(audio.duration) || 0;
	const position = Math.max(0, Number(audio.currentTime) || 0);
	const trackDuration = Number(pb.lastTrackMeta && pb.lastTrackMeta.duration) || 0;
	const endedEarly = trackDuration > 0 && position + 2 < trackDuration;
	setTimeVars(endedEarly ? position : duration, endedEarly ? trackDuration : duration || position);
	if (playerTime) {
		playerTime.value = String(Math.floor(endedEarly ? position : duration));
		updateSliderProgress();
	}
	updateStoredState({position: endedEarly ? position : 0, isPlaying: false});
	updateMediaSessionPlaybackState();
	updateMediaSessionPositionState(true);
	updateNativePlayingState();
	updateNativeElapsedState(true);

	if (endedEarly && pb.currentStreamUrl) {
		const queueApi = window.starlPlaybackQueue;
		const hasNextTrack = queueApi && queueApi.getQueueLength() > 1;
		if (!hasNextTrack) {
			// a blob URL here means the cached file was partial/truncated
			// evict it so the next play re-downloads a complete copy
			if (/^blob:/i.test(pb.currentStreamUrl)) {
				try {
					const cache = getMediaCache();
					if (cache && typeof cache.removeTrack === 'function' && pb.currentTrackKey) {
						cache.removeTrack(pb.currentTrackKey).catch(() => {});
					}
				} catch (e) {}
			}
			const resumePos = position;
			setTimeout(() => {
				const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
				let networkStreamUrl = pb.currentStreamUrl;
				if (/^blob:/i.test(networkStreamUrl)) {
					try {
						const state = typeof readPlayerState === 'function' ? readPlayerState() : null;
						if (state && state.streamUrl && !/^blob:/i.test(state.streamUrl)) {
							networkStreamUrl = state.streamUrl;
						}
					} catch (e) {}
				}
				if (!networkStreamUrl || /^blob:/i.test(networkStreamUrl)) return;
				const sep = networkStreamUrl.includes('?') ? '&' : '?';
				const resumeUrl = token
					? networkStreamUrl + sep + 'token=' + encodeURIComponent(token)
					: networkStreamUrl;
				audio.src = resumeUrl;
				audio.load();
				const onReady = () => {
					audio.removeEventListener('loadedmetadata', onReady);
					try {
						if (resumePos > 1) audio.currentTime = resumePos;
					} catch (e) {}
					audio.play().catch(() => {});
				};
				audio.addEventListener('loadedmetadata', onReady);
			}, 400);
		}
	}
});

function dispatchPlaybackState() {
	try {
		window.dispatchEvent(
			new CustomEvent('starl-playback-changed', {
				detail: {trackKey: window.starlPlaybackState.currentTrackKey, isPlaying: !audio.paused},
			}),
		);
	} catch (e) {}
}

audio.addEventListener('play', () => {
	updateMediaSessionPlaybackState();
	updateNativePlayingState();
	dispatchPlaybackState();
});

audio.addEventListener('pause', () => {
	updateMediaSessionPlaybackState();
	updateNativePlayingState();
	dispatchPlaybackState();

	const pb = window.starlPlaybackState;
	const withinAutoAdvanceWindow = Date.now() - _lastPlayingStartMs < RESUME_WATCHDOG_ARM_WINDOW_MS;
	if (
		pb.shouldBePlaying &&
		audio.src &&
		!audio.ended &&
		!pb.isLive &&
		!pb.isLoadingTrack &&
		// don't arm the watchdog while a playStream() retry chain is already pending -
		// two nudge loops firing audio.play() against the same rejected src is exactly
		// the pause/play flapping. one rescue mechanism at a time
		!_playRetryTimer &&
		withinAutoAdvanceWindow &&
		_resumeWatchdogNudges < RESUME_WATCHDOG_MAX_NUDGES
	) {
		_resumeWatchdogNudges++;
		scheduleResumeWatchdog(0);
	}
});

audio.addEventListener('playing', () => {
	_lastPlayingStartMs = Date.now();
	clearResumeWatchdog();
	// wait until playback has actually held for a bit before refilling the nudge budget -
	// a resume that dies 200ms later shouldn't count as a real recovery
	clearTimeout(_sustainedPlayTimer);
	_sustainedPlayTimer = setTimeout(() => {
		if (!audio.paused) _resumeWatchdogNudges = 0;
	}, RESUME_WATCHDOG_SUSTAINED_MS);
});

audio.addEventListener('playing', () => {
	if (window.starlPlaybackState.isLive) setLoadingState(false);
});
audio.addEventListener('waiting', () => {
	if (window.starlPlaybackState.isLive) setLoadingState(true);
});

getPlayButtons().forEach((button) => {
	button.addEventListener('click', async () => {
		if (!audio.src) {
			const queueApi = window.starlPlaybackQueue;
			const current =
				queueApi && typeof queueApi.getCurrentTrack === 'function' ? queueApi.getCurrentTrack() : null;
			if (current && window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
				window.starlPlayer.playFromSearch(current, {queueAlreadySet: true, keepPlayerState: true});
			}
			return;
		}
		if (audio.paused) {
			try {
				await audio.play();
				window.starlPlaybackState.shouldBePlaying = true;
				setPlayIconState(true);
				updateStoredState({isPlaying: true});
			} catch (error) {
				console.warn('Playback failed', error);
			}
		} else {
			audio.pause();
			window.starlPlaybackState.shouldBePlaying = false;
			setPlayIconState(false);
			updateStoredState({isPlaying: false});
		}
	});
});

if (playerTime) {
	playerTime.addEventListener('input', () => {
		const nextValue = Number(playerTime.value) || 0;
		if (Number.isFinite(nextValue)) {
			audio.currentTime = nextValue;
			updateStoredState({position: nextValue});
		}
	});
}

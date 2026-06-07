/**
 * ☆=========================================☆
 * Engine - state persistence, stream helpers, audio event listeners
 * The first half of the playback engine. Lives on top of runtime.js
 * (which owns the <audio> element and global state vars).
 * The starlPlayer API + state restore + queue live in engine-player.js (loaded after).
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
		localStorage.setItem(PLAYER_STATE_KEY, serialized);
		lastStateSaveMs = now;
	} catch (error) {
		console.warn('Failed to save player state', error);
	}
}

function readPlayerState() {
	try {
		const raw = localStorage.getItem(PLAYER_STATE_KEY);
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
	const apiArtwork = downloadData && downloadData.image_url ? toAbsoluteUrl(apiBase, downloadData.image_url) : '';
	const itemArtwork = String((item && (item.imageUrl || item.thumbnail)) || '').trim();
	const rawArtwork = apiArtwork || itemArtwork;
	return rawArtwork ? upgradeArtworkUrl(rawArtwork) : '';
}

async function playStream(streamUrl, token) {
	if (!streamUrl) {
		return;
	}
	const isLocalSource = /^blob:|^data:|^file:/i.test(streamUrl);
	const separator = streamUrl.includes('?') ? '&' : '?';
	audio.pause();
	audio.currentTime = 0;
	currentStreamUrl = streamUrl;
	audio.src = isLocalSource || !token ? streamUrl : streamUrl + separator + 'token=' + encodeURIComponent(token);
	audio.load();
	await audio.play();
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
				// verify the blob URL is still alive - the browser may have revoked it
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
	const streamDuration = Number(audio.duration) || 0;
	const metaDuration = Number(lastTrackMeta && lastTrackMeta.duration) || 0;
	// trust the API-provided duration when it's longer than what the stream header
	// reports - stream metadata can be slightly shorter due to encoding/container
	// issues, which would otherwise make the slider max too short.
	const duration = metaDuration > streamDuration ? metaDuration : streamDuration;
	if (playerTime) {
		playerTime.min = '0';
		playerTime.max = duration ? String(Math.floor(duration)) : '0';
	}
	setTimeVars(0, duration);
	updateSliderProgress();
	updateStoredState({duration});
	updateMediaSessionPositionState(true);
	updateNativeElapsedState(true);
});

audio.addEventListener('timeupdate', () => {
	const duration = Number(audio.duration) || 0;
	const current = Number(audio.currentTime) || 0;
	setTimeVars(current, duration);
	if (playerTime && !isScrubbing) {
		playerTime.value = String(Math.floor(current));
		updateSliderProgress();
	}
	const now = Date.now();
	if (now - lastStateSaveMs > 900) {
		updateStoredState({position: current, isPlaying: !audio.paused});
		lastStateSaveMs = now;
	}
	updateMediaSessionPositionState();
	updateNativeElapsedState();
});

audio.addEventListener('ended', () => {
	setPlayIconState(false);
	const duration = Number(audio.duration) || 0;
	const position = Math.max(0, Number(audio.currentTime) || 0);
	const trackDuration = Number(lastTrackMeta && lastTrackMeta.duration) || 0;
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

	if (endedEarly && currentStreamUrl) {
		const queueApi = window.starlPlaybackQueue;
		const hasNextTrack = queueApi && queueApi.getQueueLength() > 1;
		if (!hasNextTrack) {
			const resumePos = position;
			setTimeout(() => {
				const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
				const sep = currentStreamUrl.includes('?') ? '&' : '?';
				const resumeUrl = token
					? currentStreamUrl + sep + 'token=' + encodeURIComponent(token)
					: currentStreamUrl;
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
			new CustomEvent('starl-playback-changed', {detail: {trackKey: currentTrackKey, isPlaying: !audio.paused}}),
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
});

getPlayButtons().forEach((button) => {
	button.addEventListener('click', async () => {
		if (!audio.src) {
			return;
		}
		if (audio.paused) {
			try {
				await audio.play();
				setPlayIconState(true);
				updateStoredState({isPlaying: true});
			} catch (error) {
				console.warn('Playback failed', error);
			}
		} else {
			audio.pause();
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

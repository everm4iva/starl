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
				return cachedUrl;
			}
		} catch (error) {
			console.warn('Failed to check cached track', error);
		}
	}
	return '';
}

audio.addEventListener('loadedmetadata', () => {
	const duration = Number(audio.duration) || 0;
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
});

function dispatchPlaybackState() {
	try {
		window.dispatchEvent(new CustomEvent('starl-playback-changed', {
			detail: {trackKey: currentTrackKey, isPlaying: !audio.paused},
		}));
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

window.starlPlayer = {
	async playFromSearch(item) {
		const trackKey =
			item && (item.trackKey || item.url || item.sourceUrl || item.streamUrl)
				? String(item.trackKey || item.url || item.sourceUrl || item.streamUrl)
				: '';
		if (isLoadingTrack && trackKey && trackKey === currentTrackKey) {
			return;
		}
		isLoadingTrack = true;
		currentTrackKey = trackKey;
		setPlayIconState(false);
		dispatchPlaybackState();

		// Clear playback context when playing a single track directly (not via a playlist queue)
		const queueLength = window.starlPlaybackQueue ? window.starlPlaybackQueue.getQueueLength() : 0;
		if (queueLength <= 1) {
			window.starlPlaybackContext = null;
		}

		const token = getAccessToken();
		if (!token) {
			console.warn('Login required to play.');
			const authClient = window.starlAuth;
			if (authClient && typeof authClient.redirectToLogin === 'function') {
				authClient.redirectToLogin();
			}
			isLoadingTrack = false;
			return;
		}

		setLoadingState(true);
		const cache = getMediaCache();
		const imageUrl = getCanonicalArtworkUrl(item);
		const cachedUrl = await getCachedPlayableTrackUrl(cache, item);
		if (cachedUrl) {
			setTrackMeta({
				title: item.title || 'Untitled',
				artist: item.artist || 'Unknown artist',
				album: item.album || '',
				imageUrl,
				duration: item.duration || 0,
			});

			try {
				if (window.starlHistory && typeof window.starlHistory.record === 'function') {
					window.starlHistory.record({
						title: item.title || 'Untitled',
						artist: item.artist || 'Unknown artist',
						album: item.album || '',
						imageUrl,
						url: item.url || item.sourceUrl || item.streamUrl || '',
						trackKey,
						streamUrl: item.streamUrl || item.sourceUrl || item.url || '',
						duration: item.duration || 0,
					});
				}
			} catch (error) {}

			updateStoredState({
				title: item.title || 'Untitled',
				artist: item.artist || 'Unknown artist',
				album: item.album || '',
				imageUrl,
				streamUrl: item.url || item.sourceUrl || item.streamUrl || '',
				trackKey,
				position: 0,
				duration: item.duration || 0,
				isPlaying: false,
			});

			try {
				await playStream(cachedUrl, '');
			} catch (error) {
				console.warn('Cached playback failed', error);
			}
			updateStoredState({isPlaying: !audio.paused});
			setPlayerOpen(false);
			setLoadingState(false);
			isLoadingTrack = false;
			return;
		}

		if (!navigator.onLine) {
			console.warn('Offline playback unavailable until this song is cached.');
			setLoadingState(false);
			isLoadingTrack = false;
			return;
		}

		if (cache) {
			const cachedUrl = await getCachedPlayableTrackUrl(cache, item);
			if (cachedUrl) {
				try {
					setTrackMeta({
						title: item.title || 'Untitled',
						artist: item.artist || 'Unknown artist',
						album: item.album || '',
						imageUrl,
						duration: item.duration || 0,
					});
					await playStream(cachedUrl, '');
					setLoadingState(false);
					isLoadingTrack = false;
					return;
				} catch (error) {
					console.warn('Cached playback failed', error);
				}
			}
		}

		let downloadData = null;
		try {
			const sourceUrl = item.url || item.sourceUrl || '';
			const result = await requestTrackDownload(sourceUrl, token);
			if (result && result.authFailed) {
				isLoadingTrack = false;
				return;
			}
			downloadData = result ? result.data : null;
		} catch (error) {
			console.warn('Stream request failed', error);
			setLoadingState(false);
			isLoadingTrack = false;
			return;
		}
		const apiBase = getApiBase();

		const resolvedImageUrl = getCanonicalArtworkUrl(item, downloadData);
		const streamUrl = downloadData.stream_url ? toAbsoluteUrl(apiBase, downloadData.stream_url) : '';
		const duration = downloadData.duration || item.duration || 0;

		setTrackMeta({
			title: item.title || downloadData.title || 'Untitled',
			artist: item.artist || 'Unknown artist',
			album: item.album || '',
			imageUrl: resolvedImageUrl,
			duration,
		});

		if (cache && typeof cache.cacheTrack === 'function' && streamUrl) {
			cache
				.cacheTrack({
					trackKey,
					sourceUrl: item.url || item.sourceUrl || '',
					streamUrl,
					token,
					title: item.title || downloadData.title || 'Untitled',
					artist: item.artist || 'Unknown artist',
					album: item.album || '',
					imageUrl: resolvedImageUrl,
					duration,
				})
				.catch((error) => {
					console.warn('Track cache failed', error);
				});
		}

		if (cache && typeof cache.cacheImage === 'function' && resolvedImageUrl) {
			cache.cacheImage(resolvedImageUrl).catch(() => {});
		}

		if (cache && typeof cache.getImageUrl === 'function' && resolvedImageUrl) {
			cache
				.getImageUrl(resolvedImageUrl)
				.then((cachedImage) => {
					if (cachedImage) {
						try {
							setBgVar(cachedImage);
						} catch (e) {}
					}
				})
				.catch(() => {});
		}

		try {
			if (window.starlHistory && typeof window.starlHistory.record === 'function') {
				window.starlHistory.record({
					title: item.title || downloadData.title || 'Untitled',
					artist: item.artist || 'Unknown artist',
					album: item.album || '',
					imageUrl: resolvedImageUrl,
					url: item.url || '',
					trackKey,
					streamUrl,
					duration,
				});
			}
		} catch (error) {}

		updateStoredState({
			title: item.title || downloadData.title || 'Untitled',
			artist: item.artist || 'Unknown artist',
			album: item.album || '',
			imageUrl: resolvedImageUrl,
			streamUrl,
			trackKey,
			position: 0,
			duration,
			isPlaying: false,
		});

		try {
			await playStream(streamUrl, token);
		} catch (error) {
			console.warn('Playback start failed', error);
		}
		updateStoredState({isPlaying: !audio.paused});
		setPlayerOpen(false);
		setLoadingState(false);
		isLoadingTrack = false;
	},
};

async function restorePlayerState() {
	const state = readPlayerState();
	if (!state || !state.streamUrl) {
		setPlayerOpen(false);
		return;
	}

	currentTrackKey = state.trackKey || '';
	currentStreamUrl = state.streamUrl;
	setTrackMeta({
		title: state.title || 'Untitled',
		artist: state.artist || 'Unknown artist',
		album: state.album || '',
		imageUrl: upgradeArtworkUrl(state.imageUrl || ''),
		duration: state.duration || 0,
	});

	// If image is cached, set background immediately to avoid refetch
	try {
		const cache = getMediaCache();
		if (cache && typeof cache.getImageUrl === 'function' && state.imageUrl) {
			const cached = await cache.getImageUrl(state.imageUrl);
			if (cached) {
				try {
					setBgVar(cached);
				} catch (e) {}
			}
		}
	} catch (e) {}

	const token = getAccessToken();
	if (!token) {
		setPlayIconState(false);
		setPlayerOpen(false);
		return;
	}

	const cache = getMediaCache();
	// If a cached playable track exists for the restored state, prefer it
	let playableUrl = await getCachedPlayableTrackUrl(cache, state);
	if (!playableUrl && state.streamUrl) {
		const separator = state.streamUrl.includes('?') ? '&' : '?';
		playableUrl = state.streamUrl + separator + 'token=' + encodeURIComponent(token);
	}
	if (!playableUrl) {
		setPlayIconState(false);
		setPlayerOpen(false);
		return;
	}

	audio.src = playableUrl;
	audio.load();

	const position = Number(state.position) || 0;
	if (Number.isFinite(position) && position > 0) {
		audio.currentTime = position;
		if (playerTime) {
			playerTime.value = String(Math.floor(position));
			updateSliderProgress();
		}
		setTimeVars(position, Number(state.duration) || 0);
	}

	if (state.isPlaying) {
		audio
			.play()
			.then(() => {
				setPlayIconState(true);
			})
			.catch(() => {
				setPlayIconState(false);
			});
	} else {
		setPlayIconState(false);
	}

	setPlayerOpen(false);
	setLoadingState(false);
}

// ----- Queue integration -----

function trackToPlayItem(track) {
	return {
		trackKey: track.trackKey || '',
		url: track.sourceUrl || track.streamUrl || track.trackKey || '',
		sourceUrl: track.sourceUrl || '',
		streamUrl: track.streamUrl || '',
		title: track.title || 'Untitled',
		artist: track.artist || 'Unknown artist',
		album: track.album || '',
		thumbnail: track.imageUrl || '',
		imageUrl: track.imageUrl || '',
		duration: track.duration || 0,
	};
}

window.starlPlayer.getPlaybackState = function () {
	return {trackKey: currentTrackKey, isPlaying: !audio.paused};
};

window.starlPlayer.togglePlay = function () {
	if (!audio.src) return;
	if (audio.paused) {
		audio.play().then(() => { setPlayIconState(true); updateStoredState({isPlaying: true}); }).catch(() => {});
	} else {
		audio.pause();
		setPlayIconState(false);
		updateStoredState({isPlaying: false});
	}
};

window.starlPlayer.playWithQueue = function (tracks, startIndex, context) {
	const queue = Array.isArray(tracks) ? tracks : [];
	const idx = Math.max(0, Math.min(Number(startIndex) || 0, queue.length - 1));
	window.starlPlaybackContext = context || null;
	if (window.starlPlaybackQueue && typeof window.starlPlaybackQueue.setQueue === 'function') {
		window.starlPlaybackQueue.setQueue(queue, idx);
	}
	const target = queue[idx];
	if (target && typeof window.starlPlayer.playFromSearch === 'function') {
		window.starlPlayer.playFromSearch(target);
	}
};

audio.addEventListener('ended', function handleQueueAutoAdvance() {
	const queueApi = window.starlPlaybackQueue;
	if (!queueApi || queueApi.getQueueLength() <= 1) return;
	const next = queueApi.nextTrack();
	if (next && typeof window.starlPlayer.playFromSearch === 'function') {
		window.starlPlayer.playFromSearch(trackToPlayItem(next));
	}
});

// ----- Playback error notification -----

audio.addEventListener('error', function handlePlaybackError() {
	const err = audio.error;
	if (!err) return;
	// Ignore blob-fallback errors (handled by runtime.js)
	if (/^blob:/i.test(audio.src || '') && typeof blobFallbackInProgress !== 'undefined') return;
	const MESSAGES = {
		1: 'Playback stopped.',
		2: 'Network error while loading track.',
		3: 'Could not decode audio.',
		4: 'Format not supported or content unavailable.',
	};
	const msg = MESSAGES[err.code] || 'Playback error.';
	if (typeof showToast === 'function') {
		showToast(msg, 'danger');
	} else if (window.starlLayout && typeof window.starlLayout.showToast === 'function') {
		window.starlLayout.showToast(msg, 'danger');
	}
	setLoadingState(false);
	isLoadingTrack = false;
});

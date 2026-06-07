/**
 * ☆=========================================☆
 * Engine player - starlPlayer API, state restore, queue, error handling
 * The second half of the playback engine. Depends on engine.js (loaded first)
 * for: audio, updateStoredState, readPlayerState, getCachedPlayableTrackUrl, playStream.
 *
 * --- What this file does? ---
 * - window.starlPlayer.playFromSearch(): the main "play this track" entry point
 * - restorePlayerState(): on startup, resumes the last track at its saved position
 * - window.starlPlayer.playWithQueue() / togglePlay() / getPlaybackState()
 * - Queue auto-advance: listens to 'ended' and skips to the next queue item
 * - Playback error notification: shows a toast when the audio element errors out
 *
 * --- Dictionary / Terms / Extra details ---
 * - "trackKey" = canonical identifier for a track (usually its source URL)
 * - "keepPlayerState" = option to skip open/close the player card on queue skips
 * - "queueAlreadySet" = option to not reset the queue when playing a single track
 * ☆=========================================☆
 */

/* ☆======= Main play entry point =======☆ */

window.starlPlayer = {
	async playFromSearch(item, options) {
		// when skipping within the queue - user doesn't want to change whether the player card is open/closed - only the initial play (from search, an album, history, etc.) should minimize the browser into the player.
		const keepPlayerState = Boolean(options && options.keepPlayerState);
		const applyPlayerOpen = () => {
			if (!keepPlayerState) {
				setPlayerOpen(false);
			}
		};
		const trackKey =
			item && (item.trackKey || item.url || item.sourceUrl || item.streamUrl)
				? String(item.trackKey || item.url || item.sourceUrl || item.streamUrl)
				: '';
		// suppress only a genuine in-flight duplicate of the SAME track, and only briefly - if a previous load got stuck (an await threw before resetting the flag), don't let it wedge playback/skips forever.
		if (isLoadingTrack && trackKey && trackKey === currentTrackKey && Date.now() - isLoadingSince < 8000) {
			return;
		}
		isLoadingTrack = true;
		isLoadingSince = Date.now();
		currentTrackKey = trackKey;
		setPlayIconState(false);
		dispatchPlaybackState();

		// when playing a single track directly from search (not a queue skip, not the first play of a newly-set queue), reset the queue to just this track so next/prev don't navigate a stale queue from a previous session. playWithQueue passes queueAlreadySet:true to skip this.
		const queueAlreadySet = Boolean(options && options.queueAlreadySet);
		if (!keepPlayerState && !queueAlreadySet && window.starlPlaybackQueue) {
			window.starlPlaybackQueue.setQueue([item], 0);
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
						artistChannelId: item.artistChannelId || '',
						albumId: item.albumId || '',
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
			applyPlayerOpen();
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

		let downloadData = null;
		try {
			// only pass a URL that the server can actually resolve via yt-dlp.
			// Server stream paths (/stream/..., /proxy/...) and blob/data URLs are
			// not valid YouTube source URLs and will 422.
			const apiBase = getApiBase();
			// channel/artist/playlist/search pages aren't playable tracks - the server
			// rejects them with 422. Filter them out so user never sends a doomed request.
			const isNonTrackPage = (u) =>
				/youtube\.com|music\.youtube\.com/i.test(u) &&
				/\/(channel|c|user|playlist|browse|results|feed)\b|\/@/i.test(u);
			const isSourceUrl = (u) => {
				if (!u) return false;
				if (!/^https?:\/\//i.test(u)) return false;
				if (u.startsWith(apiBase)) return false;
				if (isNonTrackPage(u)) return false;
				return true;
			};
			let sourceUrl = [item.url, item.sourceUrl].find(isSourceUrl) || '';
			if (!sourceUrl && cache && typeof cache.getTrackRecord === 'function') {
				// fall back to the sourceUrl stored in the cache record (handles old history entries where only a server stream path was saved on the item).
				const candidateKeys = [item.trackKey, item.url, item.sourceUrl, item.streamUrl]
					.map((v) => String(v || '').trim())
					.filter(Boolean);
				for (const key of candidateKeys) {
					try {
						const record = await cache.getTrackRecord(key);
						if (record && record.sourceUrl && isSourceUrl(record.sourceUrl)) {
							sourceUrl = record.sourceUrl;
							break;
						}
					} catch (e) {}
				}
			}
			if (!sourceUrl) {
				// no YouTube source URL - try playing an existing server-side stream directly
				// (ex: tracks saved in playlists that only have a /stream/... path).
				const candidateStream = [item.streamUrl, item.url, item.sourceUrl]
					.map((v) => String(v || '').trim())
					.find(
						(v) => v && (v.startsWith(getApiBase() + '/stream/') || v.startsWith(getApiBase() + '/proxy/')),
					);
				if (candidateStream) {
					const resolvedImageUrl = getCanonicalArtworkUrl(item);
					setTrackMeta({
						title: item.title || 'Untitled',
						artist: item.artist || 'Unknown artist',
						album: item.album || '',
						imageUrl: resolvedImageUrl,
						duration: item.duration || 0,
					});
					try {
						await playStream(candidateStream, token);
					} catch (error) {
						console.warn('Direct stream playback failed', error);
					}
					updateStoredState({isPlaying: !audio.paused});
					applyPlayerOpen();
					setLoadingState(false);
					isLoadingTrack = false;
					return;
				}
				console.warn('No valid source URL for download', item);
				setLoadingState(false);
				isLoadingTrack = false;
				return;
			}
			const result = await requestTrackDownload(sourceUrl, token);
			if (result && result.authFailed) {
				isLoadingTrack = false;
				return;
			}
			downloadData = result ? result.data : null;
		} catch (error) {
			console.warn('Stream request failed', error);
			// try the local cache one more time before giving up.
			if (cache) {
				const fallbackUrl = await getCachedPlayableTrackUrl(cache, item).catch(() => '');
				if (fallbackUrl) {
					try {
						setTrackMeta({
							title: item.title || 'Untitled',
							artist: item.artist || 'Unknown artist',
							album: item.album || '',
							imageUrl,
							duration: item.duration || 0,
						});
						await playStream(fallbackUrl, '');
						updateStoredState({isPlaying: !audio.paused});
						applyPlayerOpen();
						setLoadingState(false);
						isLoadingTrack = false;
						return;
					} catch (playError) {
						console.warn('Cached fallback playback failed', playError);
					}
				}
			}
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
					artistChannelId: item.artistChannelId || '',
					albumId: item.albumId || '',
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
		applyPlayerOpen();
		setLoadingState(false);
		isLoadingTrack = false;

		// cache the track locally for offline playback.
		// prefer the SAME url the player is streaming (`streamUrl`): for an
		// uncached track that's `/proxy/{audio_id}?src=...`, which streams the full -
		// file immediately (and writes it server-side) - so the cache fetch gets real bytes right away instead of 404ing on `/stream/v/` until the proxy finishes. client kicks this off as playback starts; it no longer depends on the `ended` event firing.
		if (cache && typeof cache.cacheTrack === 'function' && downloadData) {
			const videoId = downloadData.video_id || '';
			const streamCacheUrl =
				streamUrl ||
				(videoId
					? toAbsoluteUrl(apiBase, '/stream/v/' + encodeURIComponent(videoId))
					: downloadData.audio_id
						? toAbsoluteUrl(apiBase, '/stream/' + downloadData.audio_id)
						: '');
			const cacheEntry = {
				trackKey,
				sourceUrl: item.url || item.sourceUrl || '',
				streamUrl: streamCacheUrl,
				token,
				title: item.title || downloadData.title || 'Untitled',
				artist: item.artist || 'Unknown artist',
				album: item.album || '',
				imageUrl: resolvedImageUrl,
				duration,
			};
			if (streamCacheUrl) {
				cache
					.cacheTrack(cacheEntry)
					.then((rec) => {
						if (rec && rec.blob) {
							// refresh the cached-time overlay now that the blob exists.
							try {
								setTrackMeta(lastTrackMeta || cacheEntry);
							} catch (e) {}
						}
					})
					.catch((error) => {
						console.warn('Track cache failed', error);
					});
			}
		}
	},
};

/* ☆======= State restore on startup =======☆ */

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

	// if image is cached, set background immediately to avoid refetch
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
	// if a cached playable track exists for the restored state, prefer it
	let playableUrl = await getCachedPlayableTrackUrl(cache, state);
	if (!playableUrl && state.streamUrl) {
		const apiBase = getApiBase();
		const sw = state.streamUrl;
		// only use streamUrl as a network fallback if it's a server-side stream path,
		// not a YouTube source URL (which would never resolve as audio).
		const isServerStream = sw.startsWith(apiBase + '/stream/') || sw.startsWith(apiBase + '/proxy/');
		if (isServerStream) {
			const separator = sw.includes('?') ? '&' : '?';
			playableUrl = sw + separator + 'token=' + encodeURIComponent(token);
		}
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

	setPlayIconState(false);
	setPlayerOpen(false);
	setLoadingState(false);
}

/* ☆======= Queue integration =======☆ */

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
		audio
			.play()
			.then(() => {
				setPlayIconState(true);
				updateStoredState({isPlaying: true});
			})
			.catch(() => {});
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
		window.starlPlayer.playFromSearch(target, {queueAlreadySet: true});
	}
};

audio.addEventListener('ended', function handleQueueAutoAdvance() {
	const queueApi = window.starlPlaybackQueue;
	if (!queueApi || queueApi.getQueueLength() <= 1) return;
	const next = queueApi.nextTrack();
	if (next && typeof window.starlPlayer.playFromSearch === 'function') {
		window.starlPlayer.playFromSearch(trackToPlayItem(next), {keepPlayerState: true});
	}
});

/* ☆======= Playback error notification =======☆ */

audio.addEventListener('error', function handlePlaybackError() {
	const err = audio.error;
	if (!err) return;
	// ignore blob-fallback errors (handled by runtime.js)
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

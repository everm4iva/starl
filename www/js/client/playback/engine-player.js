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

/* ☆======= Smart-queue failure bridge =======☆ */

// some failures never reach the <audio> element
// (no source URL, the /download request threw, no stream came back).
// those are real "track failed to play", or as i like to call it "track smooshed". in those
// cases too, so route them through the smart-queue recovery policy. the audio
// 'error' listener covers the network/decode/format failures separately.
function notifySmartQueueFailure() {
	// a direct pick (the user tapped this exact track) must just fail in place,
	// not get rerouted to some other track in the queue.
	if (window.starlPlaybackState.lastPlayWasDirectPick) return;
	const sq = window.starlSmartQueue;
	if (sq && typeof sq.handleFailure === 'function') {
		sq.handleFailure({direction: window.starlPlaybackState.lastNavDirection});
	}
}

/* ☆======= Queue pre-caching =======☆ */

// tracks currently being pre-cached so it doesn't kick off fucking it all up and duplicating downloads
const _precacheInFlight = new Set();
// hidden audio element that pre-buffers the next track's bytes while the current track plays
// when the user skips, either the blob is ready in IndexedDB (instant play) or the server
let _prebufferAudio = null;
let _prebufferKey = '';

function _isSourceUrl(u, apiBase) {
	if (!u) return false;
	if (!/^https?:\/\//i.test(u)) return false;
	if (u.startsWith(apiBase)) return false;
	if (/youtube\.com|music\.youtube\.com/i.test(u) && /\/(channel|c|user|playlist|browse|results|feed)\b|\/@/i.test(u))
		return false;
	return true;
}

// download and store the next queue track's audio blob in IndexedDB so the skip is instant.
// also starts a hidden audio element to pre-buffer bytes - this gives the server a head start
// writing the file to disk, so if the blob isn't ready yet the skip still loads from disk

async function _precacheNextTrack(nextTrack) {
	const token = getAccessToken();
	const _authPC = window.starlAuth;
	const _isCacheMode = _authPC && typeof _authPC.isCacheMode === 'function' && _authPC.isCacheMode();
	if (!token || !navigator.onLine || _isCacheMode) return;
	const apiBase = getApiBase();
	const cache = getMediaCache();
	if (!cache || typeof cache.cacheTrack !== 'function') return;

	const trackKey = String(nextTrack.trackKey || nextTrack.url || nextTrack.sourceUrl || '').trim();
	if (!trackKey || _precacheInFlight.has(trackKey)) return;

	// skip if already in IndexedDB
	try {
		const already = await getCachedPlayableTrackUrl(cache, nextTrack);
		if (already) return;
	} catch (e) {}

	const sourceUrl = [nextTrack.url, nextTrack.sourceUrl]
		.map((v) => String(v || '').trim())
		.find((u) => _isSourceUrl(u, apiBase));
	if (!sourceUrl) return;

	_precacheInFlight.add(trackKey);
	try {
		const res = await fetch(apiBase + '/download', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
			body: JSON.stringify({url: sourceUrl, quality: 'high'}),
		});
		const _authP = window.starlAuth;
		if (_authP && typeof _authP.handleAuthFailure === 'function' && _authP.handleAuthFailure(res)) return;
		if (!res.ok) return;
		const data = await res.json();
		const streamUrl = data.stream_url ? toAbsoluteUrl(apiBase, data.stream_url) : '';
		if (!streamUrl) return;

		// pre-buffer in a silent hidden audio element. the browser app starts downloading
		// the audio bytes which simultaneously causes the server proxy to write the file
		// to disk. on skip, either IndexedDB has the blob (instant) or the proxy is already done
		if (trackKey !== _prebufferKey) {
			if (!_prebufferAudio) {
				_prebufferAudio = new Audio();
				_prebufferAudio.preload = 'auto';
				_prebufferAudio.volume = 0;
				_prebufferAudio.muted = true;
			} else {
				_prebufferAudio.pause();
				_prebufferAudio.src = '';
			}
			const sep = streamUrl.includes('?') ? '&' : '?';
			_prebufferAudio.src = streamUrl + sep + 'token=' + encodeURIComponent(token);
			_prebufferKey = trackKey;
			_prebufferAudio.load();
		}

		// also download full blob into IndexedDB for offline, just a little fix to make is stable
		await cache.cacheTrack({
			trackKey,
			sourceUrl,
			streamUrl,
			token,
			title: nextTrack.title || data.title || '',
			artist: nextTrack.artist || '',
			album: nextTrack.album || '',
			imageUrl: nextTrack.imageUrl || nextTrack.thumbnail || '',
			duration: nextTrack.duration || data.duration || 0,
		});
	} catch (e) {
	} finally {
		_precacheInFlight.delete(trackKey);
	}
}

function _prefetchQueueNeighbors() {
	const queueApi = window.starlPlaybackQueue;
	if (!queueApi || queueApi.getQueueLength() <= 1) return;
	const token = getAccessToken();
	if (!token || !navigator.onLine) return;
	const apiBase = getApiBase();

	// peek at neighbors without advancing the queue
	const seen = new Set([window.starlPlaybackState.currentTrackKey].filter(Boolean));
	const neighbors = [
		typeof queueApi.peekNext === 'function' ? queueApi.peekNext() : null,
		typeof queueApi.peekPrev === 'function' ? queueApi.peekPrev() : null,
	]
		.filter(Boolean)
		.filter((t) => {
			const key = t.trackKey || t.url || t.sourceUrl || '';
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	if (!neighbors.length) return;

	// batch prewarm: resolves request URLs in parallel on the server right away..
	const prewarmUrls = neighbors
		.map((t) => String(t.url || t.sourceUrl || '').trim())
		.filter((u) => _isSourceUrl(u, apiBase));
	if (prewarmUrls.length) {
		fetch(apiBase + '/prewarm/batch', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
			body: JSON.stringify({urls: prewarmUrls, quality: 'high'}),
		}).catch(() => {});
	}

	// pre-cache neighbor images in IndexedDB in parallel - so artwork appears :P
	// instantly on skip instead of waiting on a server-side request fetch - i donno how to explain it better..
	const cache = getMediaCache();
	if (cache && typeof cache.cacheImage === 'function') {
		neighbors.forEach((t) => {
			const imgUrl = String(t.imageUrl || t.thumbnail || '').trim();
			if (imgUrl) cache.cacheImage(imgUrl).catch(() => {});
		});
	}

	// pre-cache the next track's full audio blob. reduced delay result!
	const nextTrack = neighbors[0]; // peekNext is first
	if (nextTrack) {
		setTimeout(() => _precacheNextTrack(nextTrack).catch(() => {}), 2000);
	}
}

// prewarm artist pages for the current track and queue neighbors - all in parallel.
function _prewarmArtistPages(currentItem) {
	const ap = window.starlArtistPage;
	if (!ap || typeof ap.prewarmArtist !== 'function') return;
	if (!navigator.onLine) return;

	const queueApi = window.starlPlaybackQueue;
	const candidates = [currentItem];
	if (queueApi && queueApi.getQueueLength() > 1) {
		const next = typeof queueApi.peekNext === 'function' ? queueApi.peekNext() : null;
		const prev = typeof queueApi.peekPrev === 'function' ? queueApi.peekPrev() : null;
		if (next) candidates.push(next);
		if (prev) candidates.push(prev);
	}

	const seen = new Set();
	candidates.forEach((t) => {
		if (!t) return;
		const channelId = String(t.artistChannelId || '').trim();
		const name = String(t.artist || '').trim();
		const key = channelId || name;
		if (!key || key === 'Unknown artist' || seen.has(key)) return;
		seen.add(key);
		ap.prewarmArtist(name, channelId || null).catch(() => {});
	});
}

/* ☆======= Main play entry point =======☆ */

window.starlPlayer = {
	async playFromSearch(item, options) {
		// if keepPlayerState is true, the player card won't open/close on this play
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

		// suppress only a in-flight duplicate of the SAME track, and only briefly - if a previous load
		// got stuck (an await threw before resetting the flag), don't let it wedge playback/skips forever
		const pb = window.starlPlaybackState;
		// a direct pick (search/library/playlist - no keepPlayerState) is a deliberate
		// choice of THIS track. if it fails, smart-queue's recovery (skip elsewhere in
		// the queue) must not run - that's only for queue auto-advance/skip failures.
		pb.lastPlayWasDirectPick = !keepPlayerState;
		if (pb.isLoadingTrack && trackKey && trackKey === pb.currentTrackKey && Date.now() - pb.isLoadingSince < 8000) {
			return;
		}
		pb.isLoadingTrack = true;
		pb.isLoadingSince = Date.now();
		pb.currentTrackKey = trackKey;
		setPlayIconState(false);
		dispatchPlaybackState();

		// without this, the title/artist/artwork only change once a stream resolves - so if this track fails (and
		// smart-queue skips on through it) the player keeps showing the previous track
		// while the queue has already moved on. the later setTrackMeta calls below refresh
		// this with the fuller resolved data (real duration, server artwork) once it loads.
		if (item) {
			setTrackMeta({
				title: item.title || 'Untitled',
				artist: item.artist || 'Unknown artist',
				album: item.album || '',
				imageUrl: getCanonicalArtworkUrl(item),
				duration: item.duration || 0,
			});
		}

		// when playing a single track directly from search (not a queue skip, not the first play of a newly-set queue), reset the queue to just this track so next/prev don't navigate a stale queue from a previous session. playWithQueue passes queueAlreadySet:true to skip this.
		const queueAlreadySet = Boolean(options && options.queueAlreadySet);
		if (!keepPlayerState && !queueAlreadySet && window.starlPlaybackQueue) {
			window.starlPlaybackQueue.setQueue([item], 0);
			window.starlPlaybackContext = null;
		}

		const token = getAccessToken();
		const _cacheMode =
			window.starlAuth && typeof window.starlAuth.isCacheMode === 'function' && window.starlAuth.isCacheMode();
		if (!token && !_cacheMode) {
			console.warn('Login required to play.');
			const authClient = window.starlAuth;
			if (authClient && typeof authClient.redirectToLogin === 'function') {
				authClient.redirectToLogin();
			}
			window.starlPlaybackState.isLoadingTrack = false;
			return;
		}

		setLoadingState(true);
		const cache = getMediaCache();
		const imageUrl = getCanonicalArtworkUrl(item);
		const cachedUrl = await getCachedPlayableTrackUrl(cache, item);
		if (cachedUrl) {
			// item.duration may be 0 for old history entries; try the cached record as a fallback
			// so the slider max and endedEarly detection have the real duration.
			let resolvedDuration = item.duration || 0;
			if (!resolvedDuration && cache && typeof cache.getTrackRecord === 'function') {
				const candidateKeys = [item.trackKey, item.url, item.sourceUrl, item.streamUrl]
					.map((v) => String(v || '').trim())
					.filter(Boolean);
				for (const key of candidateKeys) {
					try {
						const rec = await cache.getTrackRecord(key);
						if (rec && rec.duration) {
							resolvedDuration = rec.duration;
							break;
						}
					} catch (e) {}
				}
			}
			setTrackMeta({
				title: item.title || 'Untitled',
				artist:
					item.artist || (downloadData && (downloadData.artist || downloadData.uploader)) || 'Unknown artist',
				album: item.album || '',
				imageUrl,
				duration: resolvedDuration,
			});

			try {
				if (window.starlHistory && typeof window.starlHistory.record === 'function') {
					window.starlHistory.record({
						title: item.title || 'Untitled',
						artist:
							item.artist ||
							(downloadData && (downloadData.artist || downloadData.uploader)) ||
							'Unknown artist',
						album: item.album || '',
						imageUrl,
						url: item.url || item.sourceUrl || item.streamUrl || '',
						trackKey,
						streamUrl: item.streamUrl || item.sourceUrl || item.url || '',
						duration: resolvedDuration,
						artistChannelId: item.artistChannelId || '',
						albumId: item.albumId || '',
					});
				}
			} catch (error) {}

			updateStoredState({
				title: item.title || 'Untitled',
				artist:
					item.artist || (downloadData && (downloadData.artist || downloadData.uploader)) || 'Unknown artist',
				album: item.album || '',
				imageUrl,
				streamUrl: item.url || item.sourceUrl || item.streamUrl || '',
				trackKey,
				position: 0,
				duration: resolvedDuration,
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
			window.starlPlaybackState.isLoadingTrack = false;
			_prefetchQueueNeighbors();
			_prewarmArtistPages(item);
			return;
		}

		if (!navigator.onLine || _cacheMode) {
			console.warn('Offline playback unavailable until this song is cached.');
			if (typeof window.showToast === 'function') {
				window.showToast("You're offline - this song isn't cached.", 'error');
			}
			setLoadingState(false);
			window.starlPlaybackState.isLoadingTrack = false;
			notifySmartQueueFailure();
			return;
		}

		let downloadData = null;
		try {
			// only pass a URL that the server can actually resolve via streaming
			// server stream paths (/stream/..., /proxy/...) and blob/data URLs are
			// not valid YouTube source URLs and will "422" probably
			const apiBase = getApiBase();
			// channel/artist/playlist/search pages aren't playable tracks - the server
			// rejects them with 422. filter them out so user never sends a doomed request...
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
			if (!sourceUrl) {
				// some stored items (older history/playlist entries) only kept the bare
				// YouTube video ID under trackKey/url with no full URL - rebuild a watch
				// URL from it instead of treating the track as unplayable.
				const isVideoId = (v) => /^[A-Za-z0-9_-]{11}$/.test(String(v || '').trim());
				const videoId = [item.trackKey, item.url, item.sourceUrl].find(isVideoId);
				if (videoId) sourceUrl = `https://music.youtube.com/watch?v=${videoId}`;
			}
			if (!sourceUrl && cache && typeof cache.getTrackRecord === 'function') {
				// fall back to the sourceUrl stored in the cache record
				// (handles old history entries where only a server stream path was saved on the item).
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
				// (ex: tracks saved in playlists that only have a /stream/... path).. yup
				const candidateStream = [item.streamUrl, item.url, item.sourceUrl]
					.map((v) => String(v || '').trim())
					.find(
						(v) => v && (v.startsWith(getApiBase() + '/stream/') || v.startsWith(getApiBase() + '/proxy/')),
					);
				if (candidateStream) {
					const resolvedImageUrl = getCanonicalArtworkUrl(item);
					setTrackMeta({
						title: item.title || 'Untitled',
						artist:
							item.artist ||
							(downloadData && (downloadData.artist || downloadData.uploader)) ||
							'Unknown artist',
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
					window.starlPlaybackState.isLoadingTrack = false;
					return;
				}
				console.warn('No valid source URL for download', item);
				setLoadingState(false);
				window.starlPlaybackState.isLoadingTrack = false;
				notifySmartQueueFailure();
				return;
			}
			const result = await requestTrackDownload(sourceUrl, token);
			if (result && result.authFailed) {
				window.starlPlaybackState.isLoadingTrack = false;
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
							artist:
								item.artist ||
								(downloadData && (downloadData.artist || downloadData.uploader)) ||
								'Unknown artist',
							album: item.album || '',
							imageUrl,
							duration: item.duration || 0,
						});
						await playStream(fallbackUrl, '');
						updateStoredState({isPlaying: !audio.paused});
						applyPlayerOpen();
						setLoadingState(false);
						window.starlPlaybackState.isLoadingTrack = false;
						return;
					} catch (playError) {
						console.warn('Cached fallback playback failed', playError);
					}
				}
			}
			setLoadingState(false);
			window.starlPlaybackState.isLoadingTrack = false;
			notifySmartQueueFailure();
			return;
		}
		const apiBase = getApiBase();

		const resolvedImageUrl = getCanonicalArtworkUrl(item, downloadData);
		const streamUrl = downloadData.stream_url ? toAbsoluteUrl(apiBase, downloadData.stream_url) : '';
		const duration = downloadData.duration || item.duration || 0;

		setTrackMeta({
			title: item.title || downloadData.title || 'Untitled',
			artist: item.artist || (downloadData && (downloadData.artist || downloadData.uploader)) || 'Unknown artist',
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
					artist:
						item.artist ||
						(downloadData && (downloadData.artist || downloadData.uploader)) ||
						'Unknown artist',
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
			artist: item.artist || (downloadData && (downloadData.artist || downloadData.uploader)) || 'Unknown artist',
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
		window.starlPlaybackState.isLoadingTrack = false;
		_prefetchQueueNeighbors();
		_prewarmArtistPages(item);

		// cache the track locally for offline playback.
		// prefer the SAME url the player is streaming (`streamUrl`): for an
		// uncached track that's `/proxy/{audio_id}?src=...`, which streams the full -
		// file immediately (and writes it server-side) - so the cache fetch gets real bytes right away instead of 404ing on `/stream/v/` until the proxy finishes. client kicks this off as playback starts
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
				artist:
					item.artist || (downloadData && (downloadData.artist || downloadData.uploader)) || 'Unknown artist',
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
								setTrackMeta(pb.lastTrackMeta || cacheEntry);
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

	window.starlPlaybackState.currentTrackKey = state.trackKey || '';
	window.starlPlaybackState.currentStreamUrl = state.streamUrl;
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
		// not a YouTube source URL (would never resolve as audio).
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
	return {trackKey: window.starlPlaybackState.currentTrackKey, isPlaying: !audio.paused};
};

window.starlPlayer.togglePlay = function () {
	if (!audio.src) {
		const queueApi = window.starlPlaybackQueue;
		const current = queueApi && typeof queueApi.getCurrentTrack === 'function' ? queueApi.getCurrentTrack() : null;
		if (current) window.starlPlayer.playFromSearch(current, {queueAlreadySet: true, keepPlayerState: true});
		return;
	}
	if (audio.paused) {
		audio
			.play()
			.then(() => {
				window.starlPlaybackState.shouldBePlaying = true;
				setPlayIconState(true);
				updateStoredState({isPlaying: true});
			})
			.catch(() => {});
	} else {
		audio.pause();
		window.starlPlaybackState.shouldBePlaying = false;
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
	if (!queueApi || queueApi.getQueueLength() <= 1) {
		// nothing queued to advance to - the track truly finished with no
		// follow-up, so there's nothing for the resume-recovery check to resurrect.
		window.starlPlaybackState.shouldBePlaying = false;
		return;
	}
	const next = queueApi.nextTrack();
	if (next && typeof window.starlPlayer.playFromSearch === 'function') {
		window.starlPlayer.playFromSearch(trackToPlayItem(next), {keepPlayerState: true});
	}
});

/* ☆======= Playback error notification =======☆ */

audio.addEventListener('error', function handlePlaybackError() {
	const err = audio.error;
	if (!err) return;

	// hand a genuine load failure (network/decode/format - not a normal stop) to the
	// smart-queue recovery policy. code 1 (MEDIA_ERR_ABORTED) is a deliberate stop, so skip it.
	// this runs BEFORE the blob guard below: a stale blob src still means the track failed to
	// play, and smart-queue must recover. shuffled queues skip around cached neighbors a lot,
	// so the failing src is often a blob - if recovery sat below the guard it would never run.
	//
	// but defer to runtime.js's blob-fallback when it can handle this: a stale blob that has a
	// real network stream to fall back to is the SAME track recovering itself, which is better
	// than skipping. runtime.js's listener runs first (registered earlier) and sets this flag in
	// sync so checking it here is reliable. if that fallback then also fails, the
	// next error event has no network stream left and smart-queue takes over...
	const blobFallbackHandling = window.starlPlaybackState.blobFallbackInProgress;
	// a direct pick (the user tapped this exact track) must just fail in place,
	// not get re-routed to some other track in the queue - see "notifySmartQueueFailure" above
	if (
		err.code !== 1 &&
		!blobFallbackHandling &&
		!window.starlPlaybackState.lastPlayWasDirectPick &&
		window.starlSmartQueue &&
		typeof window.starlSmartQueue.handleFailure === 'function'
	) {
		window.starlSmartQueue.handleFailure({direction: window.starlPlaybackState.lastNavDirection});
	}

	// ignore blob-fallback errors (handled by runtime.js)
	// blob URL errors are handled by runtime.js's blob fallback
	if (/^blob:/i.test(audio.src || '')) return;
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
	window.starlPlaybackState.isLoadingTrack = false;
});

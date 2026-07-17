/**
 * ☆=========================================☆
 * Engine player - starlPlayer API, state restore, queue, error handling
 * The second half of the playback engine. Depends on engine.js (loaded first)
 * for: audio, updateStoredState, readPlayerState, getCachedPlayableTrackUrl, playStream
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
	// not get rerouted to some other track in the queue
	if (window.starlPlaybackState.lastPlayWasDirectPick) return;
	const sq = window.starlSmartQueue;
	if (sq && typeof sq.handleFailure === 'function') {
		sq.handleFailure({direction: window.starlPlaybackState.lastNavDirection});
	}
}

// turn a raw server/download error (yt-dlp text, HTTP detail, invalid link, etc...)
// into a short, user-facing reason. the raw text is often ugly ("ERROR: Private video. Sign in if you've been granted access") so client matches keywords and
// return something readable, falling back to a generic line when nothing matches.
function friendlyStreamError(rawDetail) {
	const detail = String(rawDetail || '').toLowerCase();
	if (/private/.test(detail)) return 'Track is private and cannot be played.';
	if (/age|sign in|log in|login required/.test(detail)) return 'Track is age-restricted and cannot be played.';
	if (/region|geo|country|not available in your/.test(detail)) return "Track isn't available in your region.";
	if (/removed|deleted|no longer|unavailable|not available|does not exist|404/.test(detail))
		return 'Track is no longer available.';
	if (/corrupt|decode|malformed|invalid data|damaged/.test(detail)) return "Track's audio is corrupted.";
	if (/invalid|no source|bad url|malformed url|not a playable/.test(detail)) return "Track's link is invalid.";
	if (/timed out|timeout|unreachable|resolver|502|503|504/.test(detail))
		return "Couldn't reach the server - try again.";
	if (/format/.test(detail)) return 'No playable audio format for this track.';
	return "Couldn't play this track.";
}

// show the mapped reason in the bottom toast so a skipped/failed track tells the
// user WHY instead of silently vanishing. repeated calls just overwrite the same
// toast (no storm) when smart-queue skips through several dead tracks in a row.
function notifyTrackUnavailable(rawDetail) {
	const msg = friendlyStreamError(rawDetail);
	if (typeof showToast === 'function') {
		showToast(msg, 'danger');
	} else if (window.starlLayout && typeof window.starlLayout.showToast === 'function') {
		window.starlLayout.showToast(msg, 'danger');
	}
}

/* ☆======= Queue pre-caching =======☆ */

// "monotonic" id bumped on every playFromSearch() call. each call captures its own id and, after
// any await, bails the moment a newer call has started - so a slow uncached track that's still
// resolving /download can't come back and clobber the track the user picked afterwards
let _playToken = 0;

// tracks currently being pre-cached so it doesn't kick the fuck off fucking it all up and duplicating downloads
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

// download and store the next queue track's audio blob in IndexedDB so the skip is instant
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

const PREFETCH_AHEAD = 8;
const PREFETCH_BEHIND = 8;
const PRECACHE_CONCURRENCY = 2;

// download + store ONE track's full audio blob into IndexedDB. same as _precacheNextTrack but
// without the hidden prebuffer <audio> element (only the immediate-next track gets that), so it
// can be fanned out across a whole window of tracks cheaply
async function _precacheTrackBlob(track) {
	const token = getAccessToken();
	const _auth = window.starlAuth;
	const _isCacheMode = _auth && typeof _auth.isCacheMode === 'function' && _auth.isCacheMode();
	if (!track || !token || !navigator.onLine || _isCacheMode) return;
	const apiBase = getApiBase();
	const cache = getMediaCache();
	if (!cache || typeof cache.cacheTrack !== 'function') return;

	const trackKey = String(track.trackKey || track.url || track.sourceUrl || '').trim();
	if (!trackKey || _precacheInFlight.has(trackKey)) return;

	// skip if already in IndexedDB
	try {
		const already = await getCachedPlayableTrackUrl(cache, track);
		if (already) return;
	} catch (e) {}

	const sourceUrl = [track.url, track.sourceUrl]
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
		const _a = window.starlAuth;
		if (_a && typeof _a.handleAuthFailure === 'function' && _a.handleAuthFailure(res)) return;
		if (!res.ok) return;
		const data = await res.json();
		const streamUrl = data.stream_url ? toAbsoluteUrl(apiBase, data.stream_url) : '';
		if (!streamUrl) return;
		await cache.cacheTrack({
			trackKey,
			sourceUrl,
			streamUrl,
			token,
			title: track.title || data.title || '',
			artist: track.artist || '',
			album: track.album || '',
			imageUrl: track.imageUrl || track.thumbnail || '',
			duration: track.duration || data.duration || 0,
		});
	} catch (e) {
	} finally {
		_precacheInFlight.delete(trackKey);
	}
}

async function _runWithConcurrency(items, limit, worker) {
	let cursor = 0;
	const runner = async () => {
		while (cursor < items.length) {
			const item = items[cursor++];
			try {
				await worker(item);
			} catch (e) {}
		}
	};
	const lanes = [];
	for (let i = 0; i < Math.min(limit, items.length); i++) lanes.push(runner());
	await Promise.all(lanes);
}

function _prefetchQueueNeighbors() {
	const queueApi = window.starlPlaybackQueue;
	if (!queueApi || queueApi.getQueueLength() <= 1) return;
	const token = getAccessToken();
	if (!token || !navigator.onLine) return;
	const apiBase = getApiBase();

	const queue = typeof queueApi.getQueue === 'function' ? queueApi.getQueue() : [];
	const currentIndex = typeof queueApi.getCurrentIndex === 'function' ? queueApi.getCurrentIndex() : 0;
	if (!queue.length) return;

	// build the prefetch window: upcoming tracks first (likelier skip), then previous ones.
	// no wrapping - we don't want to re-cache the whole queue on a small playlist. de-dupe by
	// key and skip the track that's already playing
	const seen = new Set([window.starlPlaybackState.currentTrackKey].filter(Boolean));
	const windowTracks = [];
	const pushTrack = (t) => {
		if (!t) return;
		const key = t.trackKey || t.url || t.sourceUrl || '';
		if (!key || seen.has(key)) return;
		seen.add(key);
		windowTracks.push(t);
	};
	for (let i = 1; i <= PREFETCH_AHEAD; i++) pushTrack(queue[currentIndex + i]);
	for (let i = 1; i <= PREFETCH_BEHIND; i++) pushTrack(queue[currentIndex - i]);
	if (!windowTracks.length) return;

	// batch prewarm: resolve every windowed track's request URL on the server up front, so a
	// skip anywhere in the window only waits on bytes (or nothing, once cached) - not the resolve
	const prewarmUrls = windowTracks
		.map((t) => String(t.url || t.sourceUrl || '').trim())
		.filter((u) => _isSourceUrl(u, apiBase));
	if (prewarmUrls.length) {
		fetch(apiBase + '/prewarm/batch', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
			body: JSON.stringify({urls: prewarmUrls, quality: 'high'}),
		}).catch(() => {});
	}

	// pre-cache window artwork in IndexedDB so covers appear instantly on a skip.
	const cache = getMediaCache();
	if (cache && typeof cache.cacheImage === 'function') {
		windowTracks.forEach((t) => {
			const imgUrl = String(t.imageUrl || t.thumbnail || '').trim();
			if (imgUrl) cache.cacheImage(imgUrl).catch(() => {});
		});
	}

	// the immediate next track gets the hidden-audio prebuffer (fastest possible skip-forward);
	// every other windowed track downloads its full blob into IndexedDB behind a concurrency cap
	const immediateNext = queue[currentIndex + 1];
	const blobTargets = windowTracks.filter((t) => t !== immediateNext);
	setTimeout(() => {
		if (immediateNext) _precacheNextTrack(immediateNext).catch(() => {});
		if (blobTargets.length) {
			_runWithConcurrency(blobTargets, PRECACHE_CONCURRENCY, _precacheTrackBlob).catch(() => {});
		}
	}, 1500);
}

// prewarm artist pages for the current track and queue neighbors - all in parallel, how atheists like (they don't say "as god intended")
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

		const pb = window.starlPlaybackState;
		pb.lastPlayWasDirectPick = !keepPlayerState;
		if (pb.isLoadingTrack && trackKey && trackKey === pb.currentTrackKey && Date.now() - pb.isLoadingSince < 8000) {
			return;
		}
		pb.isLoadingTrack = true;
		pb.isLoadingSince = Date.now();

		const myPlayToken = ++_playToken;
		const isStalePlay = () => myPlayToken !== _playToken;
		pb.currentTrackKey = trackKey;

		pb.isLive = false;
		setPlayIconState(false);
		dispatchPlaybackState();

		if (item) {
			setTrackMeta({
				title: item.title || 'Untitled',
				artist: item.artist || 'Unknown artist',
				album: item.album || '',
				imageUrl: getCanonicalArtworkUrl(item),
				duration: item.duration || 0,
			});
		}

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
		if (isStalePlay()) return; // a newer play started while we were checking the cache
		if (cachedUrl) {
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
				isLive: false,
				isPlaying: false,
			});

			if (isStalePlay()) return;
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
			// not valid YouTube source URLs and will "422" ... probably
			const apiBase = getApiBase();
			// channel/artist/playlist/search pages aren't playable tracks - the server
			// rejects them with 422. filter them out so user never sends a doomed request..
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
				// URL from it instead of treating the track as unplayable
				const isVideoId = (v) => /^[A-Za-z0-9_-]{11}$/.test(String(v || '').trim());
				const videoId = [item.trackKey, item.url, item.sourceUrl].find(isVideoId);
				if (videoId) sourceUrl = `https://music.youtube.com/watch?v=${videoId}`;
			}
			if (!sourceUrl && cache && typeof cache.getTrackRecord === 'function') {
				// fall back to the sourceUrl stored in the cache record
				// (handles old history entries where only a server stream path was saved on the item)
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
					if (isStalePlay()) return;
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
				notifyTrackUnavailable('invalid link');
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
			if (isStalePlay()) return; // user picked another track while /download was resolving
		} catch (error) {
			console.warn('Stream request failed', error);
			// try the local cache one more time before giving up.
			if (cache) {
				const fallbackUrl = await getCachedPlayableTrackUrl(cache, item).catch(() => '');
				if (isStalePlay()) return;
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
			// no cache fallback worked - tell the user why the server refused this track
			// (private / unavailable / corrupted / bad URL) before smart-queue moves on.
			notifyTrackUnavailable(error && error.message);
			setLoadingState(false);
			window.starlPlaybackState.isLoadingTrack = false;
			notifySmartQueueFailure();
			return;
		}
		const apiBase = getApiBase();

		const resolvedImageUrl = getCanonicalArtworkUrl(item, downloadData);
		const streamUrl = downloadData.stream_url ? toAbsoluteUrl(apiBase, downloadData.stream_url) : '';
		const isLive = Boolean(downloadData.is_live);
		// a live stream has no duration; never inherit a stale item.duration for it
		const duration = isLive ? 0 : downloadData.duration || item.duration || 0;
		// set before setTrackMeta so the LIVE pill / no-seek-bar UI applies on this render
		window.starlPlaybackState.isLive = isLive;

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
			isLive,
			isPlaying: false,
		});

		if (isStalePlay()) return;
		try {
			await playStream(streamUrl, token, isLive);
		} catch (error) {
			console.warn('Playback start failed', error);
		}
		updateStoredState({isPlaying: !audio.paused});
		applyPlayerOpen();
		window.starlPlaybackState.isLoadingTrack = false;
		// live is a single continuous stream - no queue neighbors to prefetch and nothing to cache
		// keep the spinner up until the 'playing' event fires (hls.js is still buffering the first
		// segments); the listeners in engine.js clear it when audio actually starts
		if (isLive) {
			_prewarmArtistPages(item);
			return;
		}
		setLoadingState(false);
		_prefetchQueueNeighbors();
		_prewarmArtistPages(item);

		// cache the track locally for offline playback
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
							// refresh the cached-time overlay now that the blob exists
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
	// a live manifest URL expires between launches, so restore never re-uses it: isLive keeps
	// the UI (LIVE pill, no seek bar) correct and the play button re-resolves a fresh manifest
	window.starlPlaybackState.isLive = Boolean(state.isLive);
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
		// not a YouTube source URL (would never resolve as audio)
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
		window.starlPlaybackState.shouldBePlaying = false;
		return;
	}

	const atEnd = queueApi.getCurrentIndex() >= queueApi.getQueueLength() - 1;
	if (atEnd && !window.starlPlaybackState.queueLoopEnabled) {
		window.starlPlaybackState.shouldBePlaying = false;
		if (typeof setPlayIconState === 'function') setPlayIconState(false);
		return;
	}
	const next = queueApi.nextTrack();
	if (next && typeof window.starlPlayer.playFromSearch === 'function') {
		console.log('[starl-bg] auto-advance ->', (next && next.title) || '(untitled)');
		window.starlPlayer.playFromSearch(trackToPlayItem(next), {keepPlayerState: true});
	}
});

/* ☆======= Playback error notification =======☆ */

audio.addEventListener('error', function handlePlaybackError() {
	const err = audio.error;
	if (!err) return;

	const blobFallbackHandling = window.starlPlaybackState.blobFallbackInProgress;
	if (
		err.code !== 1 &&
		!blobFallbackHandling &&
		!window.starlPlaybackState.lastPlayWasDirectPick &&
		window.starlSmartQueue &&
		typeof window.starlSmartQueue.handleFailure === 'function'
	) {
		window.starlSmartQueue.handleFailure({direction: window.starlPlaybackState.lastNavDirection});
	}

	if (/^blob:/i.test(audio.src || '')) return;
	const MESSAGES = {
		1: 'Playback stopped.',
		2: 'Network error while loading track.',
		3: 'Could not decode audio.',
		4: 'No format or content unavailable.',
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

/**
 * ☆=========================================☆
 * Meta - track metadata display and artwork handling
 * Turns raw track info into the UI text, artwork, and notification data you
 * actually see. Think of it as the label-maker for the current song
 *
 * --- What this file does? ---
 * - upgradeArtworkUrl(): bumps weak image URLs to the highest available res
 * - setTrackMeta(): pushes title/artist/album/artwork into CSS vars and the
 *   native notification, and checks whether the track is locally cached
 * - Shows a "cached" progress bar overlay when the track is downloaded
 *
 * --- Dictionary / Terms / Extra details ---
 * - CSS vars drive most of the player UI text (via content: var(--player-song-title))
 * - "cached overlay" = the white bar on the seek slider showing how much is downloaded
 * ☆=========================================☆
 */

/* ☆======= URL helpers =======☆ */

function deriveImageAssetKey(url) {
	try {
		if (!url) return null;
		const parts = String(url).split(/[?#]/, 1);
		const path = parts[0];
		const segs = path.split('/').filter(Boolean);
		if (segs.length === 0) return null;
		let name = segs[segs.length - 1];
		name = name.replace(/\.[^/.]+$/, '');
		name = name.replace(/[^a-zA-Z0-9_\-]/g, '_');
		name = name.replace(/[_\-]+/g, '_');
		name = name.toLowerCase();
		if (name.length > 32) name = name.slice(0, 32);
		return name || null;
	} catch (e) {
		return null;
	}
}

function upgradeArtworkUrl(url) {
	if (!url) {
		return url;
	}
	let upgraded = url;
	if (/ytimg\.com/i.test(upgraded) && !/maxresdefault/i.test(upgraded)) {
		upgraded = upgraded.replace(/\/(sd|hq|mq|default)default(\.(jpg|webp))/i, '/maxresdefault$2');
	}
	if (/googleusercontent\.com/i.test(upgraded)) {
		upgraded = upgraded.replace(/=w\d+-h\d+/i, '=w1000-h1000').replace(/-w\d+-h\d+-/i, '-w1000-h1000-');
	}
	return upgraded;
}

/* ☆======= Cached-track overlay =======☆ */

function setTrackMeta(meta) {
	setTextVar('--player-song-title', meta.title || 'Untitled');
	setTextVar('--player-song-artist', meta.artist || 'Unknown artist');
	setTextVar('--player-song-album', meta.album || '');
	if (meta.imageUrl) {
		const cache = getMediaCache();
		if (cache && typeof cache.resolveImageUrl === 'function') {
			cache
				.resolveImageUrl(meta.imageUrl)
				.then((resolvedUrl) => {
					setBgVar(resolvedUrl || meta.imageUrl);
				})
				.catch(() => setBgVar(meta.imageUrl));
		} else {
			setBgVar(meta.imageUrl);
		}
	}
	setTimeVars(0, meta.duration || 0);

	// live stream: swap the seek bar + time readout for a "LIVE" pill (no duration to scrub)
	try {
		const mainPlayer = document.querySelector('.main-player');
		if (mainPlayer) mainPlayer.classList.toggle('is-live', Boolean(window.starlPlaybackState.isLive));
	} catch (e) {}

	// shows the cached-time bar on the seek slider (fills when track is downloaded)
	(async () => {
		const applyCachedOverlay = (cachedPercent) => {
			document.documentElement.style.setProperty('--player-time-cached', String(cachedPercent) + '%');
			const el = document.querySelector('.slider-wrapper .player-time-cached');
			if (el) {
				el.style.width = String(cachedPercent) + '%';
				el.classList.toggle('hidden', cachedPercent === 0);
			}
		};

		const computeCachedPercent = async () => {
			try {
				const cache = getMediaCache();
				let cachedPercent = 0;
				if (cache) {
					// try several "candidate" keys from meta first, then fallback to globals and stored player state
					// took me 5 minutes to find the correct word to use for this process, but "candidates" just felt right
					const candidates = [];
					if (meta) {
						if (meta.trackKey) candidates.push(String(meta.trackKey).trim());
						if (meta.streamUrl) candidates.push(String(meta.streamUrl).trim());
						if (meta.sourceUrl) candidates.push(String(meta.sourceUrl).trim());
						if (meta.url) candidates.push(String(meta.url).trim());
					}
					if (window.starlPlaybackState.currentTrackKey)
						candidates.push(String(window.starlPlaybackState.currentTrackKey).trim());
					if (window.starlPlaybackState.currentStreamUrl)
						candidates.push(String(window.starlPlaybackState.currentStreamUrl).trim());
					try {
						if (typeof readPlayerState === 'function') {
							const state = readPlayerState() || {};
							if (state.trackKey) candidates.push(String(state.trackKey).trim());
							if (state.streamUrl) candidates.push(String(state.streamUrl).trim());
						}
					} catch (e) {}

					const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));
					for (const key of uniqueCandidates) {
						try {
							if (typeof cache.getTrackRecord === 'function') {
								const rec = await cache.getTrackRecord(key);
								if (rec && rec.blob) {
									cachedPercent = 100;
									break;
								}
							}
							if (typeof cache.getTrackUrl === 'function') {
								const url = await cache.getTrackUrl(key);
								if (url) {
									cachedPercent = 100;
									break;
								}
							}
						} catch (err) {}
					}
				}
				return cachedPercent;
			} catch (e) {
				return 0;
			}
		};

		try {
			const cachedPercent = await computeCachedPercent();
			applyCachedOverlay(cachedPercent);
			// re-check shortly after - cache writes happen async right after metadata update
			setTimeout(async () => {
				const delayedPercent = await computeCachedPercent();
				applyCachedOverlay(delayedPercent);
			}, 700);
		} catch (e) {}
	})();

	/* ☆======= Native notification + media session =======☆ */

	window.starlPlaybackState.lastTrackMeta = meta;
	createOrUpdateNativeNotification(meta);

	if (canUseMediaSession()) {
		initMediaSession();
		try {
			const artworkSrc = meta.imageUrl ? prepareArtworkUrl(meta.imageUrl) : '';
			navigator.mediaSession.metadata = new MediaMetadata({
				title: meta.title || 'Untitled',
				artist: meta.artist || '',
				album: meta.album || '',
				artwork: artworkSrc
					? [
							{src: artworkSrc, sizes: '96x96'},
							{src: artworkSrc, sizes: '128x128'},
							{src: artworkSrc, sizes: '192x192'},
							{src: artworkSrc, sizes: '256x256'},
							{src: artworkSrc, sizes: '384x384'},
							{src: artworkSrc, sizes: '512x512'},
						]
					: [],
			});
		} catch (error) {}
		updateMediaSessionPlaybackState();
		updateMediaSessionPositionState(true);
	}

	/* ☆======= Album label + favorites star =======☆ */

	try {
		const mpAlbumEl = document.querySelector('.mp-album');
		if (mpAlbumEl) {
			const ctx = window.starlPlaybackContext;
			let label = '';
			if (ctx && ctx.type) {
				const typeLabels = {
					playlist: 'Playlist',
					album: 'Album',
					history: 'History',
					favorites: 'Starred',
					music: 'All Music',
					artist: 'Artist',
					all: 'All Music',
					mix: 'Mix',
				};
				const typeLabel = typeLabels[ctx.type] || ctx.type;
				label = ctx.title ? typeLabel + ': ' + ctx.title : 'Playing from ' + typeLabel;
			}
			if (label) {
				mpAlbumEl.textContent = label;
				mpAlbumEl.style.display = '';
			} else {
				mpAlbumEl.textContent = '';
				mpAlbumEl.style.display = 'none';
			}
		}
	} catch (e) {}

	try {
		if (window.starlFavorites && typeof window.starlFavorites.refreshPlayerStar === 'function') {
			window.starlFavorites.refreshPlayerStar();
		}
	} catch (e) {}

	/* ☆======= Lyrics background warm-up =======☆ */

	// probe the server for lyrics on every track change: this warms the SERVER cache and
	// records availability so the context menu can show "Lyrics - unavailable"; Per spec it
	// does NOT persist client-side - that only happens when the lyrics screen is opened
	try {
		if (window.starlLyrics && typeof window.starlLyrics.probe === 'function') {
			window.starlLyrics.probe({
				title: meta.title,
				artist: meta.artist,
				album: meta.album,
				duration: meta.duration,
				trackKey: meta.trackKey || (window.starlPlaybackState && window.starlPlaybackState.currentTrackKey) || '',
			});
		}
	} catch (e) {}
}

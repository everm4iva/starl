/**
 * ☆=========================================☆
 * Library native - local library data providers
 * Builds the artist, album, and track lists from history + favorites + playlists.
 * Also drives the Artists/Albums tile covers in the library header.
 *
 * --- What this file does? ---
 * - getArtistList() / getAlbumList(): returns deduplicated lists from local data
 * - updateArtistTiles() / updateAlbumTiles(): fills the tile cover CSS vars
 * - Caches chosen tile cover images in localStorage for instant restore on reload
 * - Exposes getMediaCacheArtwork() to resolve cover URLs through the media cache
 *
 * --- Dictionary / Terms / Extra details ---
 * - "tile covers" = the small mosaic of images on the Artists/Albums header tiles
 * - Data comes from: listening history, favorites, and user playlists
 * ☆=========================================☆
 */

(function () {
	const TILE_CACHE_KEY = 'starl_tile_covers';

	/* ☆======= Data sources =======☆ */

	function getHistoryTracks() {
		return window.starlHistory ? window.starlHistory.getAll() : [];
	}

	function getFavoritesTracks() {
		return window.starlFavorites ? window.starlFavorites.listEntries() : [];
	}

	function getAllTracks() {
		const history = getHistoryTracks();
		const favorites = getFavoritesTracks();
		const seen = new Set();
		const all = [];
		[...history, ...favorites].forEach((t) => {
			if (t && t.trackKey && !seen.has(t.trackKey)) {
				seen.add(t.trackKey);
				all.push(t);
			}
		});
		return all;
	}

	function getArtistList() {
		const all = getAllTracks();
		const map = new Map();
		all.forEach((track) => {
			const name = String(track.artist || '').trim();
			if (!name) return; // skip tracks with no artist
			if (!map.has(name)) {
				map.set(name, {name, imageUrl: track.imageUrl || '', tracks: [], albumNames: new Set(), channelId: ''});
			}
			const entry = map.get(name);
			entry.tracks.push(track);
			if (track.album) entry.albumNames.add(track.album);
			if (!entry.channelId && track.artistChannelId) entry.channelId = track.artistChannelId;
		});
		// also merge followed artists
		if (window.starlFollows && typeof window.starlFollows.getFollowedArtists === 'function') {
			window.starlFollows.getFollowedArtists().forEach((a) => {
				const name = String(a.name || '').trim();
				if (!name) return;
				if (!map.has(name)) {
					map.set(name, {name, imageUrl: a.imageUrl || '', tracks: [], albumNames: new Set()});
				}
			});
		}
		return Array.from(map.values())
			.map((e) => ({...e, albumCount: e.albumNames.size}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	function getAlbumList() {
		// only show albums explicitly followed/saved
		if (window.starlFollows && typeof window.starlFollows.getFollowedAlbums === 'function') {
			const followed = window.starlFollows.getFollowedAlbums();
			// for each followed album, try to enrich with local tracks
			const all = getAllTracks();
			const localByName = new Map();
			all.forEach((track) => {
				const name = String(track.album || '').trim();
				if (!name) return;
				if (!localByName.has(name))
					localByName.set(name, {tracks: [], imageUrl: track.imageUrl || '', artist: track.artist || ''});
				localByName.get(name).tracks.push(track);
			});
			return followed
				.map((a) => {
					const name = String(a.name || '').trim();
					const local = localByName.get(name);
					// browseId is the YTMusic MPREb_... id needed for server fetch.
					// id is the save/lookup key (may equal browseId or fall back to name for local albums).
					const browseId = a.browseId || (a.id && a.id !== name ? a.id : '') || '';
					return {
						name,
						artist: a.artist || (local && local.artist) || '',
						imageUrl: a.imageUrl || (local && local.imageUrl) || '',
						tracks: (local && local.tracks) || [],
						followed: true,
						id: a.id || null,
						browseId,
					};
				})
				.sort((a, b) => a.name.localeCompare(b.name));
		}
		return [];
	}

	// ----- Tile cover CSS variables -----

	function loadCachedCovers() {
		try {
			const raw = localStorage.getItem(TILE_CACHE_KEY);
			return raw ? JSON.parse(raw) : null;
		} catch (error) {
			return null;
		}
	}

	function saveCachedCovers(data) {
		try {
			localStorage.setItem(TILE_CACHE_KEY, JSON.stringify(data));
		} catch (error) {}
	}

	function setCSSVar(name, url) {
		document.documentElement.style.setProperty(name, 'url("' + url.replace(/"/g, '%22') + '")');
	}

	function applyCachedCovers() {
		const cached = loadCachedCovers();
		if (!cached) return false;
		const artists = cached.artists || [];
		const albums = cached.albums || [];
		artists.forEach((url, i) => {
			if (url) setCSSVar('--artist' + (i + 1), url);
		});
		albums.forEach((url, i) => {
			if (url) setCSSVar('--album' + (i + 1), url);
		});
		return artists.length > 0 || albums.length > 0;
	}

	async function resolveUrl(imageUrl) {
		if (!imageUrl) return '';
		const cache = window.starlMediaCache;
		if (cache && typeof cache.getImageUrl === 'function') {
			try {
				const blobUrl = await cache.getImageUrl(imageUrl);
				return blobUrl || imageUrl;
			} catch (error) {
				return imageUrl;
			}
		}
		return imageUrl;
	}

	function pickRandom(arr, count) {
		const copy = arr.slice();
		const result = [];
		while (result.length < count && copy.length) {
			const idx = Math.floor(Math.random() * copy.length);
			result.push(copy.splice(idx, 1)[0]);
		}
		return result;
	}

	async function updateTileCovers() {
		// apply cached version instantly first
		applyCachedCovers();

		const artists = getArtistList().filter((a) => a.imageUrl);
		const albums = getAlbumList().filter((a) => a.imageUrl);
		if (!artists.length && !albums.length) return;

		// pick random selections for freshness
		const artistPicks = pickRandom(artists, 5);
		const albumPicks = pickRandom(albums, 2);

		const artistUrls = await Promise.all(artistPicks.map((a) => resolveUrl(a.imageUrl)));
		const albumUrls = await Promise.all(albumPicks.map((a) => resolveUrl(a.imageUrl)));

		// apply to CSS variables
		artistUrls.forEach((url, i) => {
			if (url) setCSSVar('--artist' + (i + 1), url);
		});
		albumUrls.forEach((url, i) => {
			if (url) setCSSVar('--album' + (i + 1), url);
		});

		// also set inline styles on the img-frame children for immediate effect
		const artistFrame = document.querySelector('.tile.artists .img-frame');
		if (artistFrame) {
			artistUrls.forEach((url, i) => {
				const el = artistFrame.querySelector('.img' + (i + 1));
				if (el && url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
			});
		}
		const albumFrame = document.querySelector('.tile.albums .img-frame');
		if (albumFrame) {
			albumUrls.forEach((url, i) => {
				const el = albumFrame.querySelector('.img' + (i + 1));
				if (el && url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
			});
		}

		// cache resolved URLs for next load
		saveCachedCovers({artists: artistUrls, albums: albumUrls});
	}

	// ----- Search across library -----

	function searchLibrary(query) {
		if (!query || !query.trim()) return {tracks: [], artists: [], albums: []};
		const q = query.trim().toLowerCase();
		const all = getAllTracks();
		const tracks = all.filter((t) => {
			return (
				(t.title || '').toLowerCase().includes(q) ||
				(t.artist || '').toLowerCase().includes(q) ||
				(t.album || '').toLowerCase().includes(q)
			);
		});
		const artists = getArtistList().filter((a) => a.name.toLowerCase().includes(q));
		const albums = getAlbumList().filter(
			(a) => a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q),
		);
		return {tracks: tracks.slice(0, 30), artists: artists.slice(0, 10), albums: albums.slice(0, 10)};
	}

	// ----- Public API -----

	window.starlLibraryNative = {
		getHistoryTracks,
		getFavoritesTracks,
		getAllTracks,
		getArtistList,
		getAlbumList,
		updateTileCovers,
		searchLibrary,
	};

	// refresh tiles when library data changes
	function onLibraryUpdate() {
		updateTileCovers();
	}

	window.addEventListener('starl-history-updated', onLibraryUpdate);
	window.addEventListener('starl-favorites-updated', onLibraryUpdate);
	window.addEventListener('starl-account-state-updated', onLibraryUpdate);
	window.addEventListener('starl-follows-updated', onLibraryUpdate);

	// apply cached covers immediately on load, refresh after data is ready
	if (document.readyState !== 'loading') {
		applyCachedCovers();
		setTimeout(updateTileCovers, 500);
	} else {
		document.addEventListener(
			'DOMContentLoaded',
			() => {
				applyCachedCovers();
				setTimeout(updateTileCovers, 500);
			},
			{once: true},
		);
	}
})();

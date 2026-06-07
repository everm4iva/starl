/**
 * ☆=========================================☆
 * Context menu - location-aware track action menu
 * Shows a pop-up action menu for a track based on where it lives (history,
 * playlist, favorites, etc.). Menu options change depending on context.
 *
 * --- What this file does? ---
 * - createContextMenu(): builds Play, Add to Playlist, Favorite, Remove, View Artist/Album buttons
 * - openContextMenu(): positions and shows the menu near its anchor element
 * - registerTrackProvider(): lets any element opt-in by passing a track getter function
 * - Closes when anything outside the menu is clicked
 *
 * --- Dictionary / Terms / Extra details ---
 * - "location" = where the track lives, ex: 'history', 'playlist:id123', 'favorites'
 * ☆=========================================☆
 */

(function () {
	let activeMenuEl = null;
	let activeAnchorEl = null;

	/* ☆======= API handles =======☆ */

	function getPlaylistsApi() {
		return window.starlPlaylists || null;
	}

	function getFavoritesApi() {
		return window.starlFavorites || null;
	}

	function getListeningHistoryApi() {
		return window.starlListeningHistory || null;
	}

	function normalizeTrack(track) {
		if (!track || typeof track !== 'object') {
			return null;
		}

		const title = String(track.title || '').trim() || 'Untitled';
		const artist = String(track.artist || '').trim() || 'Unknown artist';
		const album = String(track.album || '').trim();
		const imageUrl = String(track.imageUrl || track.thumbnail || '').trim();
		const sourceUrl = String(track.sourceUrl || track.url || '').trim();
		const streamUrl = String(track.streamUrl || '').trim();
		const trackKey = String(track.trackKey || sourceUrl || streamUrl || title + '|' + artist + '|' + album).trim();

		if (!trackKey) {
			return null;
		}

		return {
			title,
			artist,
			album,
			imageUrl,
			sourceUrl,
			streamUrl,
			trackKey,
			duration: Number(track.duration || 0) || 0,
			albumId: String(track.albumId || '').trim(),
			artistChannelId: String(track.artistChannelId || '').trim(),
		};
	}

	function closeActiveMenu() {
		if (activeMenuEl) {
			activeMenuEl.remove();
		}
		activeMenuEl = null;
		activeAnchorEl = null;
	}

	/* ☆======= Menu creation =======☆ */

	function createButton(label, handler) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'context-menu-button';
		button.textContent = label;

		if (typeof handler === 'function') {
			button.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				handler();
				closeActiveMenu();
			});
		} else {
			button.disabled = true;
		}

		return button;
	}

	function createContextMenu(track, location) {
		const menu = document.createElement('div');
		menu.className = 'context-menu';

		const playlistsApi = getPlaylistsApi();
		const favoritesApi = getFavoritesApi();

		// play track
		const playBtn = createButton('Play', () => {
			if (window.starlPlaybackQueue && typeof window.starlPlaybackQueue.setQueue === 'function') {
				window.starlPlaybackQueue.setQueue([track], 0);
			}
			if (window.starlPlayer && typeof window.starlPlayer.play === 'function') {
				window.starlPlayer.play(track);
			}
		});
		menu.appendChild(playBtn);

		// add to playlist
		if (playlistsApi && typeof playlistsApi.addTrackToPlaylist === 'function') {
			const addBtn = createButton('Add to playlist', () => {
				const playlistId = prompt('Enter playlist ID or select from list');
				if (playlistId) {
					playlistsApi.addTrackToPlaylist(String(playlistId).trim(), track);
				}
			});
			menu.appendChild(addBtn);
		}

		// favorite / Unfavorite
		if (favoritesApi) {
			const isFavorite =
				typeof favoritesApi.isFavorite === 'function' ? favoritesApi.isFavorite(track.trackKey) : false;

			const favoriteBtn = createButton(isFavorite ? 'Remove from favorites' : 'Add to favorites', () => {
				if (isFavorite && typeof favoritesApi.remove === 'function') {
					favoritesApi.remove(track.trackKey);
				} else if (!isFavorite && typeof favoritesApi.add === 'function') {
					favoritesApi.add(track);
				}
			});
			menu.appendChild(favoriteBtn);
		}

		// remove from history
		if (location === 'history') {
			const historyApi = getListeningHistoryApi();
			if (historyApi && typeof historyApi.removeFromHistory === 'function') {
				const removeBtn = createButton('Remove from history', () => {
					historyApi.removeFromHistory(track.trackKey);
				});
				menu.appendChild(removeBtn);
			}
		}

		// remove from playlist
		if (location && location.startsWith('playlist:')) {
			const playlistId = location.substring(9);
			if (playlistsApi && typeof playlistsApi.removeTrackFromPlaylist === 'function') {
				const removeBtn = createButton('Remove from playlist', () => {
					playlistsApi.removeTrackFromPlaylist(playlistId, track.trackKey);
				});
				menu.appendChild(removeBtn);
			}
		}

		// view album
		if (track && track.album) {
			const albumBtn = createButton('View album: ' + track.album, () => {
				if (!window.starlArtistPage) return;
				if (track.albumId && typeof window.starlArtistPage.openServerAlbum === 'function') {
					window.starlArtistPage.openServerAlbum({id: track.albumId, title: track.album, thumbnail: track.imageUrl, artist: track.artist});
					return;
				}
				const native = window.starlLibraryNative;
				const albums = native ? native.getAlbumList() : [];
				const found = albums.find((a) => a.name === track.album);
				window.starlArtistPage.openLocalAlbum(
					found || {name: track.album, artist: track.artist, imageUrl: track.imageUrl, tracks: [track]},
				);
			});
			menu.appendChild(albumBtn);
		}

		// view artist
		if (track && track.artist) {
			const artistBtn = createButton('View artist: ' + track.artist, async () => {
				if (!window.starlArtistPage) return;
				const native = window.starlLibraryNative;
				const artists = native ? native.getArtistList() : [];
				const exact = artists.find((a) => a.name.toLowerCase() === track.artist.toLowerCase());
				let channelId = (exact && exact.channelId) || track.artistChannelId || '';

				if (!channelId) {
					try {
						const base = typeof getApiBase === 'function' ? getApiBase() : '';
						const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
						if (base && token) {
							const res = await fetch(base + '/search', {
								method: 'POST',
								headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
								body: JSON.stringify({query: track.artist, kind: 'channels', limit: 1}),
							});
							if (res.ok) {
								const data = await res.json();
								const first = data && data.items && data.items[0];
								if (first && first.id) channelId = first.id;
							}
						}
					} catch (_) {}
				}

				const artistObj = exact
					? {...exact, channelId}
					: {name: track.artist, imageUrl: track.imageUrl, tracks: [track], channelId};
				window.starlArtistPage.openArtist(artistObj);
			});
			menu.appendChild(artistBtn);
		}

		return menu;
	}

	/* ☆======= Open / close =======☆ */

	function openContextMenu(anchorElement, track, location) {
		closeActiveMenu();

		const normalized = normalizeTrack(track);
		if (!normalized) {
			return;
		}

		const menu = createContextMenu(normalized, location);
		activeMenuEl = menu;
		activeAnchorEl = anchorElement;

		document.body.appendChild(menu);

		if (anchorElement) {
			const rect = anchorElement.getBoundingClientRect();
			menu.style.position = 'fixed';
			menu.style.top = String(rect.bottom + 5) + 'px';
			menu.style.left = String(Math.max(0, rect.left)) + 'px';
		}

		window.addEventListener('click', closeActiveMenu, {once: true});
	}

	/* ☆======= Track provider registration =======☆ */

	function registerTrackProvider(element, trackProvider, location) {
		if (!element || typeof trackProvider !== 'function') {
			return;
		}

		element.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const track = trackProvider();
			if (track) {
				openContextMenu(element, track, location);
			}
		});

		element.addEventListener('longpress', (e) => {
			const track = trackProvider();
			if (track) {
				openContextMenu(element, track, location);
			}
		});
	}

	/* ☆======= Public API =======☆ */

	window.starlContextMenu = {openContextMenu, closeActiveMenu, registerTrackProvider};
})();

/*
Context menu system
-> location-aware context menus for tracks in different library sections.
-> manages add to playlist, remove from collection, favorite/unfavorite actions.
-> delegates to appropriate API handlers based on context.
*/

(function () {
	let activeMenuEl = null;
	let activeAnchorEl = null;

	// ----- Helpers -----

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
		};
	}

	function closeActiveMenu() {
		if (activeMenuEl) {
			activeMenuEl.remove();
		}
		activeMenuEl = null;
		activeAnchorEl = null;
	}

	// ----- Menu creation -----

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

		// Play track
		const playBtn = createButton('Play', () => {
			if (window.starlPlaybackQueue && typeof window.starlPlaybackQueue.setQueue === 'function') {
				window.starlPlaybackQueue.setQueue([track], 0);
			}
			if (window.starlPlayer && typeof window.starlPlayer.play === 'function') {
				window.starlPlayer.play(track);
			}
		});
		menu.appendChild(playBtn);

		// Add to playlist
		if (playlistsApi && typeof playlistsApi.addTrackToPlaylist === 'function') {
			const addBtn = createButton('Add to playlist', () => {
				const playlistId = prompt('Enter playlist ID or select from list');
				if (playlistId) {
					playlistsApi.addTrackToPlaylist(String(playlistId).trim(), track);
				}
			});
			menu.appendChild(addBtn);
		}

		// Favorite / Unfavorite
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

		// Remove from history
		if (location === 'history') {
			const historyApi = getListeningHistoryApi();
			if (historyApi && typeof historyApi.removeFromHistory === 'function') {
				const removeBtn = createButton('Remove from history', () => {
					historyApi.removeFromHistory(track.trackKey);
				});
				menu.appendChild(removeBtn);
			}
		}

		// Remove from playlist
		if (location && location.startsWith('playlist:')) {
			const playlistId = location.substring(9);
			if (playlistsApi && typeof playlistsApi.removeTrackFromPlaylist === 'function') {
				const removeBtn = createButton('Remove from playlist', () => {
					playlistsApi.removeTrackFromPlaylist(playlistId, track.trackKey);
				});
				menu.appendChild(removeBtn);
			}
		}

		// View album
		if (track && track.album) {
			const albumBtn = createButton('View album: ' + track.album, () => {
				if (window.starlLibrarySearch && typeof window.starlLibrarySearch.searchAlbums === 'function') {
					const results = window.starlLibrarySearch.searchAlbums(track.album);
					try {
						window.dispatchEvent(
							new CustomEvent('starl-navigate-album', {detail: {album: track.album, results: results}}),
						);
					} catch (error) {}
				}
			});
			menu.appendChild(albumBtn);
		}

		// View artist
		if (track && track.artist) {
			const artistBtn = createButton('View artist: ' + track.artist, () => {
				if (window.starlLibrarySearch && typeof window.starlLibrarySearch.searchArtists === 'function') {
					const results = window.starlLibrarySearch.searchArtists(track.artist);
					try {
						window.dispatchEvent(
							new CustomEvent('starl-navigate-artist', {
								detail: {artist: track.artist, results: results},
							}),
						);
					} catch (error) {}
				}
			});
			menu.appendChild(artistBtn);
		}

		return menu;
	}

	// ----- Opening menu -----

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

	// ----- Track provider registration -----

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

	// ----- Public API -----

	window.starlContextMenu = {openContextMenu, closeActiveMenu, registerTrackProvider};
})();

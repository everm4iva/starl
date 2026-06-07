/**
 * ☆=========================================☆
 * Library - library tab controller
 * Manages the library tab: tiles (Artists/Albums), pills (All/History/Starred),
 * My Playlists list, view-mode toggle, and the inline library search bar.
 *
 * --- What this file does? ---
 * - Wires the Artists/Albums tiles to open the artist-page overlay
 * - Wires All Music / History / Starred pills to open inside-playlist
 * - Renders "My Playlists" in tile or list view (persists choice in localStorage)
 * - Handles the library search input and renders results inline
 *
 * --- Dictionary / Terms / Extra details ---
 * - "overview" = the main library view (tiles + playlists list)
 * - "overlay" = the inside-playlist or artist-page panel that slides over the tab
 * ☆=========================================☆
 */

(function () {
	let viewMode = 'list';
	let searchActive = false;
	let searchDebounce = null;

	/* ☆======= Element refs =======☆ */

	let playlistsListEl = null;
	let playlistsHeaderTextEl = null;
	let viewTileBtn = null;
	let viewListBtn = null;
	let searchResultsEl = null;
	let libraryHeadEl = null;
	let playlistsSectionEl = null;

	// ----- Init -----

	function init() {
		playlistsListEl = document.querySelector('.playlists.list');
		playlistsHeaderTextEl = document.querySelector('.playlists.header .text');
		viewTileBtn = document.querySelector('.viewtype .tile');
		viewListBtn = document.querySelector('.viewtype .list');
		searchResultsEl = document.querySelector('.library.search-results');
		libraryHeadEl = document.querySelector('.library.head');
		playlistsSectionEl = document.querySelector('.playlists');

		bindTiles();
		bindPills();
		bindSearch();
		bindViewToggle();
		bindCreateBtn();
		bindLibraryTabButton();
		renderPlaylists();

		// re-render playlists whenever library tab becomes active
		window.addEventListener('starl-library-focused', renderPlaylists);

		if (window.starlLibraryNative) {
			window.starlLibraryNative.updateTileCovers();
		}
	}

	// ----- Tile click bindings -----

	function bindTiles() {
		const artistsTile = document.querySelector('.list-big.tile.artists');
		if (artistsTile) {
			artistsTile.addEventListener('click', () => {
				if (window.starlArtistPage) window.starlArtistPage.openArtistsList();
			});
		}
		const albumsTile = document.querySelector('.list-big.tile.albums');
		if (albumsTile) {
			albumsTile.addEventListener('click', () => {
				if (window.starlArtistPage) window.starlArtistPage.openAlbumsList();
			});
		}
	}

	// ----- Pill click bindings -----

	function openNativePlaylist(type) {
		if (!window.starlInsidePlaylist || !window.starlLibraryNative) return;
		let tracks = [];
		let title = '';
		if (type === 'music') {
			tracks = window.starlLibraryNative.getAllTracks();
			title = 'All Music';
		} else if (type === 'history') {
			tracks = window.starlLibraryNative.getHistoryTracks();
			title = 'History';
		} else if (type === 'favorites') {
			tracks = window.starlLibraryNative.getFavoritesTracks();
			title = 'Starred';
		}
		window.starlInsidePlaylist.open({type, title, tracks});
	}

	function bindPills() {
		const musicPill = document.querySelector('.list-small.music');
		if (musicPill) musicPill.addEventListener('click', () => openNativePlaylist('music'));
		const historyPill = document.querySelector('.list-small.history');
		if (historyPill) historyPill.addEventListener('click', () => openNativePlaylist('history'));
		const favoritesPill = document.querySelector('.list-small.favorites');
		if (favoritesPill) favoritesPill.addEventListener('click', () => openNativePlaylist('favorites'));
	}

	// ----- View toggle -----

	function bindViewToggle() {
		if (viewTileBtn) {
			viewTileBtn.addEventListener('click', () => setViewMode('tiles'));
		}
		if (viewListBtn) {
			viewListBtn.addEventListener('click', () => setViewMode('list'));
		}
	}

	function setViewMode(mode) {
		viewMode = mode;
		if (viewTileBtn) viewTileBtn.classList.toggle('active', mode === 'tiles');
		if (viewListBtn) viewListBtn.classList.toggle('active', mode === 'list');
		renderPlaylists();
	}

	// ----- Create playlist button -----

	function bindCreateBtn() {
		const addBtn = document.querySelector('.search-container.icon.add');
		if (addBtn && window.starlPlaylists) {
			addBtn.addEventListener('click', () => {
				window.starlPlaylists.openCreateModal(null, {openAfterCreate: true});
			});
		}
	}

	// ----- Playlist rendering -----

	function onPlaylistOpen(playlist) {
		if (!window.starlInsidePlaylist || !window.starlPlaylists) return;
		window.starlInsidePlaylist.open({
			type: 'playlist',
			id: playlist.id,
			title: playlist.title,
			tracks: playlist.tracks,
			canReorder: true,
			canEdit: true,
		});
	}

	function renderPlaylists() {
		if (!playlistsListEl) playlistsListEl = document.querySelector('.playlists.list');
		if (!playlistsHeaderTextEl) playlistsHeaderTextEl = document.querySelector('.playlists.header .text');
		if (!playlistsListEl || !window.starlPlaylists) return;
		const playlists = window.starlPlaylists.list();
		if (playlistsHeaderTextEl) {
			playlistsHeaderTextEl.textContent = 'My Playlists (' + playlists.length + ')';
		}
		window.starlPlaylists.renderTo(playlistsListEl, viewMode, onPlaylistOpen);
	}

	// ----- Search -----

	function bindSearch() {
		const input = document.querySelector('#search-library');
		const closeBtn = document.getElementById('library-search-close');
		if (!input) return;
		input.addEventListener('input', () => {
			clearTimeout(searchDebounce);
			const q = input.value.trim();
			if (closeBtn) closeBtn.classList.toggle('hidden', !q);
			if (!q) {
				clearSearch();
				return;
			}
			searchDebounce = setTimeout(() => performSearch(q), 250);
		});
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				input.value = '';
				clearSearch();
			}
		});
		if (closeBtn) {
			closeBtn.addEventListener('click', () => {
				input.value = '';
				clearSearch();
			});
		}
	}

	let activeSearchFilter = 'all';
	let lastSearchResults = null;

	function setSearchImage(el, imageUrl) {
		if (!imageUrl) return;
		const cache = window.starlMediaCache;
		if (cache && typeof cache.resolveImageUrl === 'function') {
			cache
				.resolveImageUrl(imageUrl, 'low')
				.then((url) => {
					if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
				})
				.catch(() => {});
		} else {
			el.style.backgroundImage = 'url("' + imageUrl.replace(/"/g, '%22') + '")';
		}
	}

	function createSearchItem(item, type) {
		const row = document.createElement('div');
		row.className = 'lsr-row';

		const cover = document.createElement('div');
		cover.className = 'lsr-cover lsr-cover-' + type;
		const imageUrl = item.imageUrl || (item.tracks && item.tracks[0] && item.tracks[0].imageUrl) || '';
		if (imageUrl) setSearchImage(cover, imageUrl);
		if (type === 'playlist') {
			const icon = document.createElement('div');
			icon.className = 'lsr-playlist-icon';
			cover.appendChild(icon);
		}

		const info = document.createElement('div');
		info.className = 'lsr-info';
		const name = document.createElement('div');
		name.className = 'lsr-name';
		name.textContent = item.title || item.name || '';
		const sub = document.createElement('div');
		sub.className = 'lsr-sub';
		if (type === 'artist') {
			sub.textContent = 'Artist';
		} else if (type === 'album') {
			sub.textContent = (item.artist || '') + (item.artist ? ' · Album' : 'Album');
		} else if (type === 'playlist') {
			sub.textContent = (item.tracks ? item.tracks.length + ' songs · ' : '') + 'Playlist';
		} else {
			sub.textContent = (item.artist || '') + (item.artist ? ' · Music' : 'Music');
		}
		info.appendChild(name);
		info.appendChild(sub);
		row.appendChild(cover);
		row.appendChild(info);

		// 3-dots for music tracks only
		if (type === 'music' && window.starlTrackContextMenu) {
			const more = document.createElement('div');
			more.className = 'lsr-more-btn';
			if (window.starlTrackContextMenu && typeof window.starlTrackContextMenu.bindTarget === 'function') {
				window.starlTrackContextMenu.bindTarget(more, () => item, {source: 'library', directClick: true});
			}
			row.appendChild(more);
		}

		return row;
	}

	function renderSearchContent(results, filter) {
		if (!searchResultsEl) return;
		const list = searchResultsEl.querySelector('.lsr-list');
		if (!list) return;
		list.innerHTML = '';

		const showTracks = filter === 'all' || filter === 'music';
		const showArtists = filter === 'all' || filter === 'artists';
		const showAlbums = filter === 'all' || filter === 'albums';

		let hasAny = false;

		if (showTracks && results.tracks.length) {
			hasAny = true;
			results.tracks.forEach((track) => {
				const row = createSearchItem(track, 'music');
				row.addEventListener('click', () => {
					const p = window.starlPlayer;
					if (p && typeof p.playFromSearch === 'function') {
						p.playFromSearch({
							trackKey: track.trackKey || '',
							url: track.sourceUrl || track.streamUrl || '',
							sourceUrl: track.sourceUrl || '',
							streamUrl: track.streamUrl || '',
							title: track.title,
							artist: track.artist,
							album: track.album,
							thumbnail: track.imageUrl,
							imageUrl: track.imageUrl,
							duration: track.duration,
						});
					}
				});
				list.appendChild(row);
			});
		}
		if (showArtists && results.artists.length) {
			hasAny = true;
			results.artists.forEach((artist) => {
				const row = createSearchItem(artist, 'artist');
				row.addEventListener('click', () => {
					if (window.starlArtistPage) {
						clearSearch();
						window.starlArtistPage.openArtist(artist);
					}
				});
				list.appendChild(row);
			});
		}
		if (showAlbums && results.albums.length) {
			hasAny = true;
			results.albums.forEach((album) => {
				const row = createSearchItem(album, 'album');
				row.addEventListener('click', () => {
					if (window.starlInsidePlaylist) {
						clearSearch();
						window.starlInsidePlaylist.open({type: 'album', title: album.name, tracks: album.tracks});
					}
				});
				list.appendChild(row);
			});
		}
		if (!hasAny) {
			const empty = document.createElement('div');
			empty.className = 'library-search-empty';
			empty.textContent = 'No results.';
			list.appendChild(empty);
		}
	}

	function showSearchResults(results) {
		if (!searchResultsEl) return;
		lastSearchResults = results;
		// position overlay to start below the search bar so the input stays visible
		const searchBarEl = document.querySelector('.library.search-container');
		if (searchBarEl) {
			const rect = searchBarEl.getBoundingClientRect();
			searchResultsEl.style.top = rect.bottom + 'px';
		}
		searchResultsEl.classList.remove('hidden');
		searchResultsEl.innerHTML = '';

		// header with close button
		const header = document.createElement('div');
		header.className = 'lsr-header';
		const closeBtn = document.createElement('div');
		closeBtn.className = 'lsr-close-btn';
		closeBtn.addEventListener('click', () => {
			const input = document.querySelector('#search-library');
			if (input) input.value = '';
			clearSearch();
		});
		const title = document.createElement('div');
		title.className = 'lsr-header-title';
		title.textContent = 'Library search';
		header.appendChild(closeBtn);
		header.appendChild(title);
		searchResultsEl.appendChild(header);

		// filter pills
		const pills = document.createElement('div');
		pills.className = 'lsr-pills';
		['all', 'music', 'artists', 'albums'].forEach((f) => {
			const pill = document.createElement('div');
			pill.className = 'lsr-pill' + (f === activeSearchFilter ? ' active' : '');
			pill.textContent = f.charAt(0).toUpperCase() + f.slice(1);
			pill.addEventListener('click', () => {
				activeSearchFilter = f;
				pills.querySelectorAll('.lsr-pill').forEach((p) => p.classList.toggle('active', p === pill));
				renderSearchContent(lastSearchResults, f);
			});
			pills.appendChild(pill);
		});
		searchResultsEl.appendChild(pills);

		const list = document.createElement('div');
		list.className = 'lsr-list';
		searchResultsEl.appendChild(list);
		renderSearchContent(results, activeSearchFilter);
	}

	function performSearch(query) {
		if (!window.starlLibraryNative) return;
		const results = window.starlLibraryNative.searchLibrary(query);
		activeSearchFilter = 'all';
		searchActive = true;
		showSearchResults(results);
	}

	function clearSearch() {
		searchActive = false;
		if (searchResultsEl) searchResultsEl.classList.add('hidden');
		if (libraryHeadEl) libraryHeadEl.classList.remove('hidden');
		if (playlistsSectionEl) playlistsSectionEl.classList.remove('hidden');
	}

	function closeAllOverlays() {
		if (window.starlInsidePlaylist) window.starlInsidePlaylist.close();
		if (window.starlArtistPage) window.starlArtistPage.close();
		clearSearch();
		const input = document.querySelector('#search-library');
		if (input) input.value = '';
		renderPlaylists();
	}

	function isAnyOverlayOpen() {
		const ip = document.querySelector('.inside-playlist');
		const ap = document.querySelector('.artist-page');
		return (ip && !ip.classList.contains('hidden')) || (ap && !ap.classList.contains('hidden'));
	}

	function bindLibraryTabButton() {
		const btn = document.querySelector('.tabs-btn[data-tab="library"]');
		if (!btn) return;
		btn.addEventListener(
			'click',
			() => {
				if (isAnyOverlayOpen()) {
					closeAllOverlays();
				} else {
					renderPlaylists();
					window.dispatchEvent(new CustomEvent('starl-library-focused'));
				}
			},
			true,
		); // capture phase so it runs before layout.js tab handler
	}

	// ----- Public API -----

	window.starlLibrary = {renderPlaylists, clearSearch, closeAllOverlays, openNativePlaylist};

	// ----- Event listeners -----

	window.addEventListener('starl-playlists-updated', renderPlaylists);
	window.addEventListener('starl-history-updated', () => {});
	window.addEventListener('starl-favorites-updated', () => {});

	// when home "see more" or other modules navigate to library history,
	// close any open overlay first then open the History collection.
	window.addEventListener('starl-library-open-history', () => {
		closeAllOverlays();
		openNativePlaylist('history');
	});

	if (document.readyState !== 'loading') {
		init();
	} else {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	}
})();

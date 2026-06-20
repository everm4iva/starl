/*
Playlist features integration
-> ties together all playlist feature modules into a cohesive system.
-> handles playback queue, view modes, reordering, settings, and gestures.
*/

(function () {
	let currentPlaylistId = '';
	let isDetailViewOpen = false;
	let draggedElement = null;
	let draggedIndex = -1;

	// ----- Helpers -----

	function getPlaylistsApi() {
		return window.starlPlaylists || null;
	}

	function getPlaybackQueueApi() {
		return window.starlPlaybackQueue || null;
	}

	function getPlaylistUIApi() {
		return window.starlPlaylistUI || null;
	}

	function getPlaylistSettingsApi() {
		return window.starlPlaylistSettings || null;
	}

	function getPlaybackEngineApi() {
		return window.starlPlaybackEngine || null;
	}

	function getGesturesApi() {
		return window.starlGestures || null;
	}

	function getContextMenuApi() {
		return window.starlContextMenu || null;
	}

	// ----- View state -----

	function findPlaylist(playlistId) {
		const api = getPlaylistsApi();
		if (!api || typeof api.getPlaylist !== 'function') {
			return null;
		}
		return api.getPlaylist(String(playlistId || '').trim());
	}

	function getCurrentPlaylist() {
		return findPlaylist(currentPlaylistId);
	}

	// ----- Detail view management -----

	function openDetailView(playlistId) {
		currentPlaylistId = String(playlistId || '').trim();
		const playlist = getCurrentPlaylist();

		if (!playlist) {
			return;
		}

		const detailEl = document.getElementById('library-playlist-detail');
		const overviewEl = document.querySelector('.library-panel');

		if (overviewEl) {
			overviewEl.classList.add('hidden');
		}
		if (detailEl) {
			detailEl.classList.remove('hidden');
		}

		isDetailViewOpen = true;
		renderDetailView(playlist);
		setupDetailViewHandlers();
	}

	function closeDetailView() {
		currentPlaylistId = '';
		isDetailViewOpen = false;

		const detailEl = document.getElementById('library-playlist-detail');
		const overviewEl = document.querySelector('.library-panel');

		if (detailEl) {
			detailEl.classList.add('hidden');
		}
		if (overviewEl) {
			overviewEl.classList.remove('hidden');
		}
	}

	// ----- Detail view rendering -----

	function renderDetailView(playlist) {
		const titleEl = document.getElementById('library-playlist-title');
		const metaEl = document.getElementById('library-playlist-meta');
		const coverEl = document.getElementById('library-playlist-cover');
		const tracksEl = document.getElementById('library-playlist-tracks');
		const headerEl = document.getElementById('library-playlist-header');

		const tracks = Array.isArray(playlist && playlist.tracks ? playlist.tracks : []) ? playlist.tracks : [];

		if (titleEl) {
			titleEl.textContent = String(playlist && playlist.title ? playlist.title : 'Untitled');
		}

		if (metaEl) {
			const uiApi = getPlaylistUIApi();
			const duration = uiApi && typeof uiApi.getTotalDuration === 'function' ? uiApi.getTotalDuration(tracks) : 0;
			const formattedDuration =
				uiApi && typeof uiApi.formatDuration === 'function' ? uiApi.formatDuration(duration) : '';
			metaEl.textContent = String(tracks.length) + ' songs · ' + formattedDuration;
		}

		if (coverEl) {
			const uiApi = getPlaylistUIApi();
			if (uiApi && typeof uiApi.generatePlaylistCoverDataUrl === 'function') {
				const coverUrl = uiApi.generatePlaylistCoverDataUrl(tracks);
				if (coverUrl) {
					coverEl.style.backgroundImage = 'url(' + coverUrl + ')';
				}
			}
		}

		if (tracksEl && headerEl) {
			tracksEl.innerHTML = '';

			tracks.forEach((track, index) => {
				const uiApi = getPlaylistUIApi();
				if (uiApi && typeof uiApi.createTrackRow === 'function') {
					const trackEl = uiApi.createTrackRow(track, index, {draggable: false});
					if (trackEl) {
						tracksEl.appendChild(trackEl);
					}
				}
			});

			setupGestures(headerEl);
		}
	}

	function setupGestures(headerEl) {
		if (!headerEl) {
			return;
		}

		const gesturesApi = getGesturesApi();
		if (gesturesApi && typeof gesturesApi.setupPlaylistHeaderSwipe === 'function') {
			gesturesApi.setupPlaylistHeaderSwipe(headerEl, closeDetailView);
		}
	}

	// ----- Handler setup -----

	function setupDetailViewHandlers() {
		const backBtn = document.getElementById('library-playlist-back-btn');
		const playBtn = document.getElementById('library-playlist-play-btn');
		const shuffleBtn = document.getElementById('library-playlist-shuffle-btn');
		const editBtn = document.getElementById('library-playlist-edit-btn');
		const optionsBtn = document.getElementById('library-playlist-options-btn');
		const viewBtns = document.querySelectorAll('.library-playlist-view-btn');

		if (backBtn) {
			backBtn.addEventListener('click', closeDetailView);
		}

		if (playBtn) {
			playBtn.addEventListener('click', handlePlayPlaylist);
		}

		if (shuffleBtn) {
			shuffleBtn.addEventListener('click', handleShufflePlaylist);
		}

		if (editBtn) {
			editBtn.addEventListener('click', () => {
				const settingsApi = getPlaylistSettingsApi();
				if (settingsApi && typeof settingsApi.openSettingsModal === 'function') {
					settingsApi.openSettingsModal(currentPlaylistId);
				}
			});
		}

		if (optionsBtn) {
			optionsBtn.addEventListener('click', () => {
				const settingsApi = getPlaylistSettingsApi();
				if (settingsApi && typeof settingsApi.openSettingsModal === 'function') {
					settingsApi.openSettingsModal(currentPlaylistId);
				}
			});
		}

		viewBtns.forEach((btn) => {
			btn.addEventListener('click', (e) => {
				const mode = btn.dataset.mode;
				if (mode) {
					switchViewMode(mode);
				}
			});
		});
	}

	function switchViewMode(mode) {
		const uiApi = getPlaylistUIApi();
		if (uiApi && typeof uiApi.setViewMode === 'function') {
			uiApi.setViewMode(mode);
		}

		const tracksEl = document.getElementById('library-playlist-tracks');
		if (tracksEl) {
			tracksEl.classList.toggle('tiles-view', mode === 'tiles');
			tracksEl.classList.toggle('list-view', mode === 'list');
		}

		const viewBtns = document.querySelectorAll('.library-playlist-view-btn');
		viewBtns.forEach((btn) => {
			btn.classList.toggle('active', btn.dataset.mode === mode);
		});

		renderDetailView(getCurrentPlaylist());
	}

	// ----- Playback handlers -----

	function handlePlayPlaylist() {
		const playlist = getCurrentPlaylist();
		if (!playlist) {
			return;
		}

		const queueApi = getPlaybackQueueApi();
		if (!queueApi || typeof queueApi.setQueue !== 'function') {
			return;
		}

		const tracks = Array.isArray(playlist && playlist.tracks ? playlist.tracks : []) ? playlist.tracks : [];

		queueApi.setQueue(tracks, 0);

		if (window.starlPlayer && typeof window.starlPlayer.play === 'function') {
			window.starlPlayer.play(tracks[0]);
		}
	}

	function handleShufflePlaylist() {
		const playlist = getCurrentPlaylist();
		if (!playlist) {
			return;
		}

		const queueApi = getPlaybackQueueApi();
		if (!queueApi || typeof queueApi.setQueue !== 'function') {
			return;
		}

		const tracks = Array.isArray(playlist && playlist.tracks ? playlist.tracks : []) ? playlist.tracks : [];

		queueApi.setQueue(tracks, 0);

		if (queueApi && typeof queueApi.enableShuffle === 'function') {
			queueApi.enableShuffle();
		}

		if (window.starlPlayer && typeof window.starlPlayer.play === 'function') {
			window.starlPlayer.play(tracks[0]);
		}
	}

	// ----- Reordering -----

	function enableReorderMode() {
		const tracksEl = document.getElementById('library-playlist-tracks');
		if (!tracksEl) {
			return;
		}

		tracksEl.classList.add('reorder-mode');

		const trackRows = tracksEl.querySelectorAll('.track-row');
		trackRows.forEach((row) => {
			row.draggable = true;
			row.addEventListener('dragstart', handleDragStart);
			row.addEventListener('dragover', handleDragOver);
			row.addEventListener('drop', handleDrop);
			row.addEventListener('dragend', handleDragEnd);
		});
	}

	function handleDragStart(e) {
		draggedElement = this;
		draggedIndex = Number(this.dataset.trackIndex) || -1;
		this.classList.add('dragging');
	}

	function handleDragOver(e) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		if (this !== draggedElement) {
			this.classList.add('drag-over');
		}
	}

	function handleDrop(e) {
		e.preventDefault();
		if (this !== draggedElement && draggedIndex >= 0) {
			const targetIndex = Number(this.dataset.trackIndex) || -1;
			if (targetIndex >= 0) {
				reorderTracks(draggedIndex, targetIndex);
			}
		}
	}

	function handleDragEnd(e) {
		this.classList.remove('dragging');
		const tracksEl = document.getElementById('library-playlist-tracks');
		if (tracksEl) {
			const trackRows = tracksEl.querySelectorAll('.track-row');
			trackRows.forEach((row) => {
				row.classList.remove('drag-over');
			});
		}
	}

	function reorderTracks(fromIndex, toIndex) {
		const api = getPlaylistsApi();
		if (!api || typeof api.moveTrackInPlaylist !== 'function') {
			return;
		}

		api.moveTrackInPlaylist(currentPlaylistId, fromIndex, toIndex);
		renderDetailView(getCurrentPlaylist());
	}

	// ----- Event listeners -----

	function setupGlobalListeners() {
		document.addEventListener('starl-playlists-updated', () => {
			if (isDetailViewOpen) {
				const playlist = getCurrentPlaylist();
				if (playlist) {
					renderDetailView(playlist);
				}
			}
		});

		document.addEventListener('starl-playlist-settings-saved', () => {
			if (isDetailViewOpen) {
				const playlist = getCurrentPlaylist();
				if (playlist) {
					renderDetailView(playlist);
				}
			}
		});
	}

	// ----- Playlist click integration -----

	function setupPlaylistClickHandlers() {
		// use event delegation on library panel to catch all playlist clicks
		const libraryPanel = document.querySelector('.library-panel');
		if (!libraryPanel) {
			// Try again in a moment if panel not ready
			setTimeout(setupPlaylistClickHandlers, 500);
			return;
		}

		// when a playlist card or row is clicked, also open detail view
		libraryPanel.addEventListener(
			'click',
			function (e) {
				const playlistElement = e.target.closest('[data-playlist-id]');
				if (!playlistElement) return;

				const playlistId = playlistElement.dataset.playlistId;
				if (playlistId) {
					setTimeout(() => openDetailView(playlistId), 50);
				}
			},
			true,
		);
	}

	// ----- Public API -----

	window.starlPlaylistFeatures = {openDetailView, closeDetailView, enableReorderMode};

	setupGlobalListeners();
	setupPlaylistClickHandlers();
})();

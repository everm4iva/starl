/**
 * ☆=========================================☆
 * Playlists UI - rendering, cards, and modals
 * Renders playlist cards into the library view and provides
 * the create / add-to / settings bottom-sheet modals.
 * Depends on playlists.js (loaded first) for all data operations.
 *
 * --- What this file does? ---
 * - renderTo(containerEl, mode): renders playlist cards or tiles
 * - openCreateModal(track): bottom sheet to create a new playlist
 * - openAddToPlaylistModal(track): bottom sheet to add a track to an existing playlist
 * - openSettingsModal(playlistId): bottom sheet to rename or delete a playlist
 * - Extends window.starlPlaylists with the UI methods above
 *
 * --- Dictionary / Terms / Extra details ---
 * - mode 'tiles' = grid of square tiles; default = vertical list items
 * - Cover slots: up to 4 track thumbnails shown as a mosaic on each card
 * ☆=========================================☆
 */

(function () {
	/* ☆======= Cover helpers =======☆ */

	function getCoverTracks(playlist, mode) {
		const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
		if (!tracks.length) return [];
		if (mode === 'first') return [tracks[0]];
		if (mode === 'pick') return [tracks[Math.min(playlist.coverIndex || 0, tracks.length - 1)]];
		return tracks.slice(0, 4);
	}

	function resolveUrlForCss(imageUrl) {
		if (!imageUrl) return '';
		const base = typeof getApiBase === 'function' ? getApiBase() : window.STARL_API_BASE || '';
		const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
		if (token && base && imageUrl.startsWith(base)) {
			return imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
		}
		return imageUrl;
	}

	function setCoverSlotImage(el, imageUrl) {
		if (!el || !imageUrl) return;
		const setUrl = (url) => {
			if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
		};
		const cache = window.starlMediaCache;
		if (cache && typeof cache.resolveImageUrl === 'function') {
			cache
				.resolveImageUrl(imageUrl, 'low')
				.then((url) => {
					if (url) setUrl(url);
				})
				.catch(() => {});
		} else {
			setUrl(resolveUrlForCss(imageUrl));
		}
	}

	function createCoversEl(playlist) {
		const covers = document.createElement('div');
		covers.className = 'item-covers';
		const coverTracks = getCoverTracks(playlist, playlist.coverMode);
		const tracksWithImages = coverTracks.filter((t) => t && t.imageUrl);
		const count = Math.min(tracksWithImages.length, 4);
		covers.dataset.count = String(count);
		if (count === 0) {
			const placeholder = document.createElement('div');
			placeholder.className = 'cover-slot slot-1 item-covers-placeholder';
			covers.appendChild(placeholder);
		} else {
			for (let i = 0; i < count; i++) {
				const slot = document.createElement('div');
				slot.className = 'cover-slot slot-' + (i + 1);
				setCoverSlotImage(slot, tracksWithImages[i].imageUrl);
				covers.appendChild(slot);
			}
		}
		return covers;
	}

	/* ☆======= Playlist card + tile =======☆ */

	function isPlaylistPlaying(playlist) {
		const player = window.starlPlayer;
		if (!player || typeof player.getPlaybackState !== 'function') return false;
		const state = player.getPlaybackState();
		if (!state || !state.isPlaying || !state.trackKey) return false;
		return (playlist.tracks || []).some((t) => t.trackKey === state.trackKey);
	}

	function createPlaylistItem(playlist, onOpen) {
		const item = document.createElement('div');
		item.className = 'item';
		item.dataset.playlistId = playlist.id;
		const covers = createCoversEl(playlist);
		const details = document.createElement('div');
		details.className = 'item-details';
		const titleEl = document.createElement('div');
		titleEl.className = 'item-title';
		titleEl.textContent = playlist.title;
		const infoEl = document.createElement('div');
		infoEl.className = 'item-info';
		infoEl.textContent = window.starlPlaylists.getStats(playlist).label;
		details.appendChild(titleEl);
		details.appendChild(infoEl);
		const actions = document.createElement('div');
		actions.className = 'item-actions';
		const playBtn = document.createElement('div');

		function updatePlayBtn() {
			const playing = isPlaylistPlaying(playlist);
			playBtn.className = 'item-actions ' + (playing ? 'pause' : 'play');
		}
		updatePlayBtn();

		playBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const playing = isPlaylistPlaying(playlist);
			if (playing && window.starlPlayer && typeof window.starlPlayer.togglePlay === 'function') {
				window.starlPlayer.togglePlay();
				return;
			}
			if (window.starlInsidePlaylist) {
				window.starlInsidePlaylist.open({
					type: 'playlist',
					id: playlist.id,
					title: playlist.title,
					tracks: playlist.tracks,
					canReorder: true,
					canEdit: true,
				});
			}
			if (window.starlPlayer && typeof window.starlPlayer.playWithQueue === 'function') {
				const tracks = playlist.tracks;
				if (tracks && tracks.length) {
					const items = tracks.map((t) => ({
						trackKey: t.trackKey || '',
						url: t.sourceUrl || t.streamUrl || '',
						sourceUrl: t.sourceUrl || '',
						streamUrl: t.streamUrl || '',
						title: t.title,
						artist: t.artist,
						album: t.album,
						thumbnail: t.imageUrl,
						imageUrl: t.imageUrl,
						duration: t.duration,
					}));
					window.starlPlayer.playWithQueue(items, 0, {type: 'playlist', title: playlist.title});
				}
			}
		});

		const handler = () => updatePlayBtn();
		window.addEventListener('starl-playback-changed', handler);
		// clean up when element is removed from DOM
		const observer = new MutationObserver(() => {
			if (!document.contains(item)) {
				window.removeEventListener('starl-playback-changed', handler);
				observer.disconnect();
			}
		});
		observer.observe(document.body, {childList: true, subtree: true});

		const moreBtn = document.createElement('div');
		moreBtn.className = 'item-actions more-vert';
		moreBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			openSettingsModal(playlist.id);
		});
		actions.appendChild(playBtn);
		actions.appendChild(moreBtn);
		item.appendChild(covers);
		item.appendChild(details);
		item.appendChild(actions);
		item.addEventListener('click', () => {
			if (typeof onOpen === 'function') onOpen(playlist);
		});
		return item;
	}

	function createPlaylistTile(playlist, onOpen) {
		const tile = document.createElement('div');
		tile.className = 'item tile-item';
		tile.dataset.playlistId = playlist.id;

		const covers = createCoversEl(playlist);
		covers.className = 'item-covers tile-covers';

		const footer = document.createElement('div');
		footer.className = 'tile-footer';

		const titleEl = document.createElement('div');
		titleEl.className = 'tile-title';
		titleEl.textContent = playlist.title;

		const moreBtn = document.createElement('div');
		moreBtn.className = 'tile-more-btn';
		moreBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			openSettingsModal(playlist.id);
		});

		footer.appendChild(titleEl);
		footer.appendChild(moreBtn);
		tile.appendChild(covers);
		tile.appendChild(footer);
		tile.addEventListener('click', () => {
			if (typeof onOpen === 'function') onOpen(playlist);
		});
		return tile;
	}

	function renderTo(containerEl, mode, onOpen) {
		if (!containerEl) return;
		containerEl.innerHTML = '';
		const playlists = window.starlPlaylists.list();
		const isTiles = mode === 'tiles';
		containerEl.classList.toggle('tile-mode', isTiles);
		playlists.forEach((playlist) => {
			containerEl.appendChild(
				isTiles ? createPlaylistTile(playlist, onOpen) : createPlaylistItem(playlist, onOpen),
			);
		});
	}

	/* ☆======= Create modal =======☆ */

	function openCreateModal(track, options) {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		const opts = options && typeof options === 'object' ? options : {};
		const pendingTrack = window.starlPlaylists.normalizeTrack(track);
		let inputEl = null;
		bs.open({
			render(body) {
				const heading = document.createElement('div');
				heading.className = 'bsc-settings-header';
				heading.textContent = pendingTrack ? 'Create playlist with this track' : 'New playlist';
				body.appendChild(heading);
				inputEl = document.createElement('input');
				inputEl.type = 'text';
				inputEl.className = 'bsc-settings-input';
				inputEl.placeholder = 'Playlist name';
				inputEl.autocomplete = 'off';
				inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						create();
					}
				});
				body.appendChild(inputEl);
				const row = document.createElement('div');
				row.className = 'bsc-settings-row';
				const cancelBtn = document.createElement('button');
				cancelBtn.type = 'button';
				cancelBtn.className = 'bsc-btn';
				cancelBtn.textContent = 'Cancel';
				cancelBtn.addEventListener('click', () => bs.close());
				const createBtn = document.createElement('button');
				createBtn.type = 'button';
				createBtn.className = 'bsc-btn primary';
				createBtn.textContent = pendingTrack ? 'Create and add' : 'Create';
				createBtn.addEventListener('click', create);
				row.appendChild(cancelBtn);
				row.appendChild(createBtn);
				body.appendChild(row);
				setTimeout(() => inputEl && inputEl.focus(), 100);
			},
		});
		function create() {
			const value = inputEl && inputEl.value.trim();
			if (!value) {
				if (inputEl) inputEl.focus();
				return;
			}
			window.starlPlaylists.createPlaylist(value, pendingTrack, opts);
			bs.close();
		}
	}

	function closeCreateModal() {
		if (window.starlBottomSheet) window.starlBottomSheet.close();
	}

	/* ☆======= Add-to-playlist modal =======☆ */

	let pendingAddTrack = null;

	function openAddToPlaylistModal(track) {
		pendingAddTrack = window.starlPlaylists.normalizeTrack(track);
		const bs = window.starlBottomSheet;
		if (!bs) return;
		const playlists = window.starlPlaylists.list();
		bs.open({
			render(body) {
				const heading = document.createElement('div');
				heading.className = 'bsc-settings-header';
				heading.textContent = 'Add to playlist';
				body.appendChild(heading);
				if (!playlists.length) {
					const empty = document.createElement('div');
					empty.className = 'bsc-action';
					empty.textContent = 'No playlists yet. Create one first.';
					empty.style.opacity = '0.5';
					body.appendChild(empty);
				} else {
					playlists.forEach((p) => {
						const row = document.createElement('div');
						row.className = 'bsc-action';
						row.textContent = p.title;
						row.addEventListener('click', () => {
							window.starlPlaylists.addTrackToPlaylist(p.id, pendingAddTrack);
							pendingAddTrack = null;
							bs.close();
						});
						body.appendChild(row);
					});
				}
			},
		});
	}

	/* ☆======= Settings modal =======☆ */

	function openSettingsModal(playlistId) {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		const playlist = window.starlPlaylists.get(playlistId);
		if (!playlist) return;
		let inputEl = null;
		bs.open({
			render(body) {
				const heading = document.createElement('div');
				heading.className = 'bsc-settings-header';
				heading.textContent = 'Playlist settings';
				body.appendChild(heading);

				inputEl = document.createElement('input');
				inputEl.type = 'text';
				inputEl.className = 'bsc-settings-input';
				inputEl.placeholder = 'Playlist name';
				inputEl.autocomplete = 'off';
				inputEl.value = playlist.title;
				inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						save();
					}
				});
				body.appendChild(inputEl);

				const btnRow = document.createElement('div');
				btnRow.className = 'bsc-settings-row';
				const cancelBtn = document.createElement('button');
				cancelBtn.type = 'button';
				cancelBtn.className = 'bsc-btn';
				cancelBtn.textContent = 'Cancel';
				cancelBtn.addEventListener('click', () => bs.close());
				const saveBtn = document.createElement('button');
				saveBtn.type = 'button';
				saveBtn.className = 'bsc-btn primary';
				saveBtn.textContent = 'Save';
				saveBtn.addEventListener('click', save);
				btnRow.appendChild(cancelBtn);
				btnRow.appendChild(saveBtn);
				body.appendChild(btnRow);

				const sep = document.createElement('div');
				sep.className = 'bsc-separator';
				body.appendChild(sep);

				const deleteBtn = document.createElement('div');
				deleteBtn.className = 'bsc-action danger';
				deleteBtn.textContent = 'Delete playlist';
				deleteBtn.addEventListener('click', () => {
					bs.close();
					setTimeout(() => {
						if (window.starlPlaylists.deletePlaylist(playlistId) && window.starlInsidePlaylist) {
							window.starlInsidePlaylist.close();
						}
					}, 350);
				});
				body.appendChild(deleteBtn);

				setTimeout(() => inputEl && inputEl.focus(), 100);
			},
		});

		function save() {
			const value = inputEl && inputEl.value.trim();
			if (!value) return;
			window.starlPlaylists.updateTitle(playlistId, value);
			bs.close();
			if (window.starlInsidePlaylist && typeof window.starlInsidePlaylist.refreshTitle === 'function') {
				window.starlInsidePlaylist.refreshTitle(value);
			}
		}
	}

	/* ☆======= Extend public API =======☆ */

	// attach UI methods onto the already-registered starlPlaylists object
	if (window.starlPlaylists) {
		window.starlPlaylists.renderTo = renderTo;
		window.starlPlaylists.openCreateModal = openCreateModal;
		window.starlPlaylists.closeCreateModal = closeCreateModal;
		window.starlPlaylists.openAddToPlaylistModal = openAddToPlaylistModal;
		window.starlPlaylists.openSettingsModal = openSettingsModal;
	}
})();

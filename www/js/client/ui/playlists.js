/*
Playlist data manager
-> owns CRUD for user-created playlists in account state.
-> renders playlist cards into the .playlists.list container via renderTo().
-> modals: create playlist, add-to-playlist, settings.
-> no view state — inside-playlist.js owns the detail view.
*/

(function () {
	const SECTION_KEY = 'playlists';
	const UPDATE_EVENT = 'starl-playlists-updated';

	// ----- Account state -----

	function getAccountState() {
		return window.starlAccountState || null;
	}

	function dispatch(freshList) {
		try {
			window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {detail: {playlists: freshList || list()}}));
		} catch (error) {}
	}

	// ----- Normalization -----

	function normalizeTrack(entry) {
		if (!entry || typeof entry !== 'object') return null;
		const title = String(entry.title || '').trim() || 'Untitled';
		const artist = String(entry.artist || '').trim() || 'Unknown artist';
		const album = String(entry.album || '').trim();
		const imageUrl = String(entry.imageUrl || '').trim();
		const sourceUrl = String(entry.sourceUrl || entry.url || '').trim();
		const streamUrl = String(entry.streamUrl || '').trim();
		const duration = Number(entry.duration || 0) || 0;
		const trackKey = String(entry.trackKey || sourceUrl || streamUrl || title + '|' + artist).trim();
		if (!trackKey && !sourceUrl && !streamUrl) return null;
		return {
			title,
			artist,
			album,
			imageUrl,
			sourceUrl,
			streamUrl,
			duration,
			trackKey,
			addedAt: Number(entry.addedAt || Date.now()) || Date.now(),
		};
	}

	function normalizePlaylist(entry) {
		if (!entry || typeof entry !== 'object') return null;
		const id = String(entry.id || '').trim() || createId();
		const title = String(entry.title || '').trim() || 'Untitled playlist';
		const description = String(entry.description || '').trim();
		const coverMode = String(entry.coverMode || '2x2').trim();
		const coverIndex = Number(entry.coverIndex || 0) || 0;
		const createdAt = Number(entry.createdAt || Date.now()) || Date.now();
		const updatedAt = Number(entry.updatedAt || createdAt) || createdAt;
		const tracksRaw = Array.isArray(entry.tracks) ? entry.tracks : Array.isArray(entry.items) ? entry.items : [];
		const seen = new Set();
		const tracks = [];
		tracksRaw.forEach((t) => {
			const n = normalizeTrack(t);
			if (n && !seen.has(n.trackKey)) {
				seen.add(n.trackKey);
				tracks.push(n);
			}
		});
		return {id, title, description, coverMode, coverIndex, createdAt, updatedAt, tracks};
	}

	function normalizeList(value) {
		const items = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
		return items
			.map(normalizePlaylist)
			.filter(Boolean)
			.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
	}

	function createId() {
		return 'playlist-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 8);
	}

	// ----- Storage -----

	function readPlaylists() {
		const state = getAccountState();
		if (state && typeof state.getSection === 'function') {
			return normalizeList(state.getSection(SECTION_KEY, []));
		}
		return [];
	}

	function writePlaylists(next) {
		const normalized = normalizeList(next);
		const state = getAccountState();
		if (state && typeof state.setSection === 'function') {
			// setSection is async; update local state via setState synchronously first so
			// the UI re-render sees the new data immediately, then let the async sync finish.
			if (typeof state.setState === 'function') {
				const current = (typeof state.getState === 'function') ? (state.getState() || {}) : {};
				state.setState({...current, [SECTION_KEY]: normalized});
			}
			state.setSection(SECTION_KEY, normalized);
		}
		dispatch(normalized);
		return normalized;
	}

	// ----- Helpers -----

	function formatDuration(totalSeconds) {
		const s = Number(totalSeconds);
		if (!Number.isFinite(s) || s <= 0) return '--';
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ' min';
	}

	function getStats(playlist) {
		const tracks = Array.isArray(playlist && playlist.tracks) ? playlist.tracks : [];
		const duration = tracks.reduce((t, r) => t + (Number(r && r.duration) || 0), 0);
		return {count: tracks.length, duration, label: tracks.length + ' songs • ' + formatDuration(duration)};
	}

	function updatePlaylist(id, transform) {
		const all = readPlaylists();
		let changed = false;
		const next = all.map((p) => {
			if (p.id !== id) return p;
			const result = transform({...p, tracks: (p.tracks || []).slice()});
			if (!result) return p;
			changed = true;
			return {...result, updatedAt: Date.now()};
		});
		if (!changed) return false;
		writePlaylists(next);
		return true;
	}

	// ----- Mutations -----

	function createPlaylist(title, initialTrack, options) {
		const opts = options && typeof options === 'object' ? options : {};
		const track = normalizeTrack(initialTrack);
		const playlist = {
			id: createId(),
			title: String(title || '').trim() || 'Untitled playlist',
			description: '',
			coverMode: '2x2',
			coverIndex: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			tracks: track ? [track] : [],
		};
		writePlaylists([playlist, ...readPlaylists()]);
		if (opts.openAfterCreate !== false && window.starlInsidePlaylist) {
			window.starlInsidePlaylist.open({
				type: 'playlist',
				id: playlist.id,
				title: playlist.title,
				tracks: playlist.tracks,
				canReorder: true,
				canEdit: true,
			});
		}
		return playlist;
	}

	function deletePlaylist(id) {
		if (!window.confirm('Delete this playlist?')) return false;
		writePlaylists(readPlaylists().filter((p) => p.id !== id));
		return true;
	}

	function addTrackToPlaylist(playlistId, track) {
		const t = normalizeTrack(track);
		if (!playlistId || !t) return false;
		return updatePlaylist(playlistId, (p) => {
			const exists = p.tracks.some((x) => x.trackKey === t.trackKey);
			return {...p, tracks: exists ? p.tracks : [t, ...p.tracks].slice(0, 500)};
		});
	}

	function removeTrackFromPlaylist(playlistId, trackKey) {
		const key = String(trackKey || '').trim();
		if (!playlistId || !key) return false;
		return updatePlaylist(playlistId, (p) => ({...p, tracks: p.tracks.filter((t) => t.trackKey !== key)}));
	}

	function moveTrackInPlaylist(playlistId, trackKey, direction) {
		const key = String(trackKey || '').trim();
		const offset = Number(direction || 0);
		if (!playlistId || !key || !offset) return false;
		return updatePlaylist(playlistId, (p) => {
			const tracks = p.tracks.slice();
			const from = tracks.findIndex((t) => t.trackKey === key);
			if (from < 0) return null;
			const to = from + offset;
			if (to < 0 || to >= tracks.length) return null;
			const [moved] = tracks.splice(from, 1);
			tracks.splice(to, 0, moved);
			return {...p, tracks};
		});
	}

	function updateTitle(playlistId, newTitle) {
		return updatePlaylist(playlistId, (p) => ({...p, title: String(newTitle || '').trim() || 'Untitled playlist'}));
	}

	function updateCoverMode(playlistId, mode, index) {
		return updatePlaylist(playlistId, (p) => ({
			...p,
			coverMode: String(mode || '2x2'),
			coverIndex: Number(index || 0) || 0,
		}));
	}

	// ----- Rendering: playlist card in .playlists.list -----

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
			cache.resolveImageUrl(imageUrl).then((url) => { if (url) setUrl(url); }).catch(() => {});
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
			// Empty playlist: show a placeholder icon
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
		infoEl.textContent = getStats(playlist).label;
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
		// Cleanup when element is removed from DOM
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
		const playlists = readPlaylists();
		const isTiles = mode === 'tiles';
		containerEl.classList.toggle('tile-mode', isTiles);
		playlists.forEach((playlist) => {
			containerEl.appendChild(
				isTiles ? createPlaylistTile(playlist, onOpen) : createPlaylistItem(playlist, onOpen)
			);
		});
	}

	// ----- Create playlist bottom sheet -----

	function openCreateModal(track, options) {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		const opts = options && typeof options === 'object' ? options : {};
		const pendingTrack = normalizeTrack(track);
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
			createPlaylist(value, pendingTrack, opts);
			bs.close();
		}
	}

	function closeCreateModal() {
		if (window.starlBottomSheet) window.starlBottomSheet.close();
	}

	// ----- Add-to-playlist modal -----

	let addModalEl = null;
	let addModalListEl = null;
	let pendingAddTrack = null;

	function ensureAddModal() {
		if (addModalEl) return;
		addModalEl = document.createElement('div');
		addModalEl.className = 'playlist-modal hidden';
		const dialog = document.createElement('div');
		dialog.className = 'playlist-modal-dialog playlist-modal-dialog-wide';
		const titleEl = document.createElement('div');
		titleEl.className = 'playlist-modal-title';
		titleEl.textContent = 'Add to playlist';
		addModalListEl = document.createElement('div');
		addModalListEl.className = 'playlist-modal-list';
		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'library-playlist-button';
		closeBtn.textContent = 'close';
		closeBtn.addEventListener('click', closeAddModal);
		const footer = document.createElement('div');
		footer.className = 'playlist-modal-actions';
		footer.appendChild(closeBtn);
		dialog.appendChild(titleEl);
		dialog.appendChild(addModalListEl);
		dialog.appendChild(footer);
		addModalEl.appendChild(dialog);
		addModalEl.addEventListener('click', (e) => {
			if (e.target === addModalEl) closeAddModal();
		});
		document.body.appendChild(addModalEl);
	}

	function openAddToPlaylistModal(track) {
		pendingAddTrack = normalizeTrack(track);
		const bs = window.starlBottomSheet;
		if (!bs) return;
		const playlists = readPlaylists();
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
							addTrackToPlaylist(p.id, pendingAddTrack);
							pendingAddTrack = null;
							bs.close();
						});
						body.appendChild(row);
					});
				}
			},
		});
	}

	// ----- Settings bottom sheet -----

	function openSettingsModal(playlistId) {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		const playlists = readPlaylists();
		const playlist = playlists.find((p) => p.id === playlistId);
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
						if (deletePlaylist(playlistId) && window.starlInsidePlaylist) {
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
			updateTitle(playlistId, value);
			bs.close();
			if (window.starlInsidePlaylist && typeof window.starlInsidePlaylist.refreshTitle === 'function') {
				window.starlInsidePlaylist.refreshTitle(value);
			}
		}
	}

	// ----- Public API -----

	window.starlPlaylists = {
		list() {
			return readPlaylists();
		},
		get(id) {
			return readPlaylists().find((p) => p.id === String(id || '').trim()) || null;
		},
		createPlaylist,
		deletePlaylist,
		addTrackToPlaylist,
		removeTrackFromPlaylist,
		moveTrackInPlaylist,
		updateTitle,
		updateCoverMode,
		renderTo,
		openCreateModal,
		closeCreateModal,
		openAddToPlaylistModal,
		openSettingsModal,
		getStats,
		formatDuration,
		normalizeTrack,
	};

	window.addEventListener('starl-account-state-updated', dispatch);
})();

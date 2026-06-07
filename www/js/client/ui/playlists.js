/**
 * ☆=========================================☆
 * Playlists - user playlist CRUD and data layer
 * Owns all create/read/update/delete operations for user-created playlists,
 * stored in account state.
 *
 * --- What this file does? ---
 * - createPlaylist() / deletePlaylist(): basic CRUD
 * - addTrackToPlaylist() / removeTrackFromPlaylist() / moveTrackInPlaylist(): track management
 * - readPlaylists() / writePlaylists(): account-state persistence
 * - Fires 'starl-playlists-updated' on every change
 *
 * --- Dictionary / Terms / Extra details ---
 * - Rendering and modals live in playlists-ui.js (loaded after this file)
 * - Playlists are stored under the 'playlists' section of account state
 * ☆=========================================☆
 */

(function () {
	const SECTION_KEY = 'playlists';
	const UPDATE_EVENT = 'starl-playlists-updated';

	/* ☆======= Account state =======☆ */

	function getAccountState() {
		return window.starlAccountState || null;
	}

	function dispatch(freshList) {
		try {
			window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {detail: {playlists: freshList || list()}}));
		} catch (error) {}
	}

	/* ☆======= Normalization =======☆ */

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

	/* ☆======= Storage =======☆ */

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
				const current = typeof state.getState === 'function' ? state.getState() || {} : {};
				state.setState({...current, [SECTION_KEY]: normalized});
			}
			state.setSection(SECTION_KEY, normalized);
		}
		dispatch(normalized);
		return normalized;
	}

	/* ☆======= Helpers =======☆ */

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

	/* ☆======= Mutations =======☆ */

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

	/* ☆======= Public API =======☆ */

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
		getStats,
		formatDuration,
		normalizeTrack,
		// renderTo, openCreateModal, openAddToPlaylistModal, openSettingsModal live in playlists-ui.js
	};

	window.addEventListener('starl-account-state-updated', dispatch);
})();

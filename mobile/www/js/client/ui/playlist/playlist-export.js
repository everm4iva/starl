/**
 * ☆=========================================☆
 * Playlist export - save playlists to JSON, and update one back from a file
 * The counterpart to json-import.js. Turns a playlist (or all of them) into a
 * JSON file the user saves wherever they like, and lets a single playlist be
 * refilled from a JSON file.
 *
 * --- What this file does? ---
 * - exportPlaylist(id): save one playlist as <name>.json
 * - exportAllPlaylists(): save every playlist into one starl-playlists.json
 * - updatePlaylistFromFile(id): pick a .json file and replace the playlist's tracks with it
 *
 * --- Dictionary / Terms / Extra details ---
 * - saving goes through starlFileExport (native picker on phone, blob in browser)
 * - the file shape round-trips with json-import.js: {title, tracks:[...]}; foreign
 *   exports (YT Music library dumps, bare arrays) are read leniently too
 * ☆=========================================☆
 */

(function () {
	function toast(msg, kind) {
		if (typeof window.showToast === 'function') window.showToast(msg, kind);
		else if (window.starlLayout && typeof window.starlLayout.showToast === 'function')
			window.starlLayout.showToast(msg, kind);
	}

	function getPlaylists() {
		return window.starlPlaylists || null;
	}

	/* ☆======= Track (de)serialization =======☆ */

	// the fields we persist per track - enough to re-play and re-render without the app's caches
	function trackToExport(t) {
		return {
			title: t.title || '',
			artist: t.artist || '',
			album: t.album || '',
			imageUrl: t.imageUrl || '',
			sourceUrl: t.sourceUrl || '',
			streamUrl: t.streamUrl || '',
			duration: Number(t.duration) || 0,
			trackKey: t.trackKey || '',
		};
	}

	// pull a track array out of whatever shape the file happens to be
	function pickRawTracks(json) {
		if (Array.isArray(json)) return json;
		if (json && Array.isArray(json.tracks)) return json.tracks;
		if (json && Array.isArray(json.songs)) return json.songs;
		if (json && Array.isArray(json.items)) return json.items;
		return [];
	}

	function watchUrl(videoId) {
		return videoId ? 'https://music.youtube.com/watch?v=' + videoId : '';
	}

	function rawToTrack(e) {
		if (!e || typeof e !== 'object') return null;
		const artist =
			e.artist ||
			(Array.isArray(e.artists)
				? e.artists
						.map((a) => (a && a.name ? a.name : a))
						.filter(Boolean)
						.join(', ')
				: '') ||
			e.author ||
			'';
		const album = e.album && typeof e.album === 'object' ? e.album.name || '' : e.album || '';
		const thumbs = Array.isArray(e.thumbnails) ? e.thumbnails : [];
		const imageUrl =
			e.imageUrl ||
			e.thumbnail ||
			(thumbs.length && thumbs[thumbs.length - 1] && thumbs[thumbs.length - 1].url) ||
			'';
		const videoId = e.videoId || e.id || '';
		const sourceUrl = e.sourceUrl || e.url || watchUrl(videoId) || '';
		return {
			title: e.title || e.name || 'Untitled',
			artist: String(artist || ''),
			album: String(album || ''),
			imageUrl: String(imageUrl || ''),
			sourceUrl: String(sourceUrl || ''),
			streamUrl: String(e.streamUrl || ''),
			duration: Number(e.duration) || 0,
			trackKey: String(e.trackKey || sourceUrl || ''),
		};
	}

	/* ☆======= Export =======☆ */

	function exportPlaylist(playlistId) {
		const api = getPlaylists();
		const playlist = api && typeof api.get === 'function' ? api.get(playlistId) : null;
		if (!playlist) {
			toast('Playlist not found.', 'danger');
			return;
		}
		const payload = {
			app: 'starl',
			kind: 'playlist',
			exportedAt: new Date().toISOString(),
			title: playlist.title || 'Untitled playlist',
			description: playlist.description || '',
			locked: !!playlist.locked,
			source: playlist.source || '',
			tracks: (playlist.tracks || []).map(trackToExport),
		};
		if (window.starlFileExport && typeof window.starlFileExport.saveJson === 'function') {
			window.starlFileExport.saveJson(payload.title || 'playlist', payload);
		}
	}

	function exportAllPlaylists() {
		const api = getPlaylists();
		const all = api && typeof api.list === 'function' ? api.list() : [];
		if (!all.length) {
			toast('No playlists to export yet.', 'danger');
			return;
		}
		const payload = {
			app: 'starl',
			kind: 'playlists',
			exportedAt: new Date().toISOString(),
			count: all.length,
			playlists: all.map((p) => ({
				title: p.title || 'Untitled playlist',
				description: p.description || '',
				locked: !!p.locked,
				source: p.source || '',
				tracks: (p.tracks || []).map(trackToExport),
			})),
		};
		if (window.starlFileExport && typeof window.starlFileExport.saveJson === 'function') {
			window.starlFileExport.saveJson('starl-playlists', payload);
		}
	}

	/* ☆======= Update one playlist from a file =======☆ */

	function readFile(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result || ''));
			reader.onerror = () => reject(new Error('Could not read that file.'));
			reader.readAsText(file);
		});
	}

	function refreshInsidePlaylist(playlistId) {
		// if this playlist is the one currently open, nudge it to redraw the new tracks
		try {
			window.dispatchEvent(new CustomEvent('starl-playlists-updated'));
		} catch (e) {}
	}

	function updatePlaylistFromFile(playlistId) {
		const api = getPlaylists();
		const playlist = api && typeof api.get === 'function' ? api.get(playlistId) : null;
		if (!playlist) {
			toast('Playlist not found.', 'danger');
			return;
		}
		if (playlist.locked) {
			toast('That playlist is locked (read-only).', 'danger');
			return;
		}

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,application/json';
		input.style.display = 'none';
		document.body.appendChild(input);

		input.addEventListener('change', async () => {
			const file = input.files && input.files[0];
			document.body.removeChild(input);
			if (!file) return;

			let tracks;
			try {
				const json = JSON.parse(await readFile(file));
				tracks = pickRawTracks(json)
					.map(rawToTrack)
					.filter((t) => t && (t.sourceUrl || t.title));
			} catch (err) {
				toast('That file is not a valid playlist export.', 'danger');
				return;
			}
			if (!tracks.length) {
				toast('No tracks found in that file.', 'danger');
				return;
			}

			const current = (playlist.tracks || []).length;
			if (
				!window.confirm(
					'Replace this playlist’s ' + current + ' track(s) with ' + tracks.length + ' from the file?',
				)
			)
				return;

			const ok = api.replaceTracks(playlistId, tracks);
			if (ok) {
				toast('Playlist updated (' + tracks.length + ' tracks).', 'success');
				refreshInsidePlaylist(playlistId);
			} else {
				toast('Could not update the playlist.', 'danger');
			}
		});

		input.click();
	}

	/* ☆======= Public API =======☆ */

	window.starlPlaylistExport = {exportPlaylist, exportAllPlaylists, updatePlaylistFromFile};
})();

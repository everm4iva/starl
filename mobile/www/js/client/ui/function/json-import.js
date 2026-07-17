/**
 * ☆=========================================☆
 * JSON import - import a playlist from a .json export file
 * Entry point: the "Import from file" row in the library "+" chooser.
 *
 * --- What this file does? ---
 * - openFilePicker(): pick a .json file, read + parse it
 * - Verify-at-import: each track's videoId is checked via YouTube's no-auth oEmbed.
 *     * valid    -> kept, thumbnail refetched fresh
 *     * dead/404 -> re-matched by title+artist via POST /match (same system as the
 *                   Spotify import) and the working replacement is swapped in
 *     * unknown  -> kept as-is (we never trust the file's expired stream URLs; the
 *                   player re-resolves a fresh stream at play time anyway)
 * - Hands the cleaned tracks to starlImportPlaylist.openPreview() so the user picks
 *   "Add as playlist" (editable) or "Add as locked" before it saves to the library
 *
 * --- Dictionary / Terms / Extra details ---
 * - oEmbed: https://www.youtube.com/oembed?url=...  -> 200 {title, author_name,
 *   thumbnail_url} if the video exists, 404/401 if it's gone/blocked
 * - "refetch thumbnails": signed/expiring i.ytimg URLs are rebuilt from the videoId;
 *   stable googleusercontent album art is kept (and bumped to a larger size)
 * ☆=========================================☆
 */

(function () {
	const MATCH_BATCH = 25;
	const VERIFY_CONCURRENCY = 6;
	const GENERIC_ARTIST = {song: 1, video: 1}; // YT-Music flat-export placeholder labels

	/* ☆======= Helpers =======☆ */

	function getApiBase() {
		if (typeof window.getApiBase === 'function') return window.getApiBase();
		return window.STARL_API_BASE || '';
	}

	function getToken() {
		if (window.starlShared && typeof window.starlShared.getAccessToken === 'function')
			return window.starlShared.getAccessToken();
		if (typeof window.getAccessToken === 'function') return window.getAccessToken();
		return localStorage.getItem('starl_access_token');
	}

	function joinArtists(artists) {
		return (Array.isArray(artists) ? artists : [])
			.map((a) => (a && a.name ? String(a.name).trim() : ''))
			.filter((n) => n && !GENERIC_ARTIST[n.toLowerCase()])
			.join(', ');
	}

	function watchUrl(videoId) {
		return videoId ? 'https://music.youtube.com/watch?v=' + videoId : '';
	}

	// refetch/normalize a thumbnail: keep stable album art, rebuild signed YT frames.
	function normalizeThumb(song, videoId) {
		const thumbs = (song && song.thumbnails) || [];
		const raw = (thumbs.length && thumbs[thumbs.length - 1] && thumbs[thumbs.length - 1].url) || '';
		if (/googleusercontent\.com/i.test(raw)) {
			return raw.replace(/=w\d+-h\d+/i, '=w544-h544'); // stable album art -> bump size
		}
		if (videoId) return 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
		return raw;
	}

	/* ☆======= Parse the file into tracks =======☆ */

	// returns {title, tracks:[{title, artist, album, thumbnail, url, videoId, duration}]} or throws.
	function parsePlaylist(json) {
		let title = 'Imported playlist';
		let songs = null;

		if (json && Array.isArray(json.songs)) {
			songs = json.songs;
			if (json.playlistInfo && json.playlistInfo.title) title = json.playlistInfo.title;
		} else if (json && Array.isArray(json.tracks)) {
			// our own export shape - already close to the playlist track shape
			songs = json.tracks;
			if (json.title) title = json.title;
		} else if (Array.isArray(json)) {
			songs = json;
		}

		if (!songs || !songs.length) throw new Error('No songs found in that file.');

		const tracks = songs
			.map((song) => {
				const videoId = song.videoId || song.id || '';
				const url = song.url && /youtube\.com|youtu\.be/i.test(song.url) ? song.url : watchUrl(videoId);
				return {
					title: song.title || song.name || 'Untitled',
					artist: song.artist || joinArtists(song.artists) || '',
					album: (song.album && typeof song.album === 'object' ? song.album.name : song.album) || '',
					thumbnail: normalizeThumb(song, videoId),
					url: url,
					videoId: videoId,
					duration: Number(song.duration) || 0,
				};
			})
			// a track needs *something* to resolve from (a videoId/URL or a title to match on)
			.filter((t) => t.url || t.title);

		if (!tracks.length) throw new Error('No playable songs found in that file.');
		return {title, tracks};
	}

	/* ☆======= Verify-at-import (oEmbed) + repair (/match) =======☆ */

	// resolve to {ok, status, title, artist, thumbnail}. 200 => valid; 404/401 => dead
	function checkYt(url) {
		if (!url) return Promise.resolve({ok: false, status: 0});
		return fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url))
			.then((r) => {
				if (r.ok) {
					return r
						.json()
						.then((d) => ({
							ok: true,
							status: 200,
							title: d.title || '',
							artist: d.author_name || '',
							thumbnail: d.thumbnail_url || '',
						}));
				}
				return {ok: false, status: r.status};
			})
			.catch(() => ({ok: false, status: 0})); // network error -> unknown, keep as-is
	}

	// run `worker` over items with bounded concurrency; resolves when all are done.
	function runPool(items, concurrency, worker) {
		return new Promise((resolve) => {
			let next = 0;
			let active = 0;
			let finished = 0;
			const total = items.length;
			if (!total) return resolve();
			function pump() {
				while (active < concurrency && next < total) {
					const idx = next++;
					active++;
					Promise.resolve(worker(items[idx], idx))
						.catch(() => {})
						.then(() => {
							active--;
							finished++;
							if (finished >= total) resolve();
							else pump();
						});
				}
			}
			pump();
		});
	}

	async function matchBatch(queries) {
		const token = getToken();
		if (!token) return queries.map(() => null);
		const res = await fetch(getApiBase() + '/match', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
			body: JSON.stringify({queries}),
		});
		if (!res.ok) return queries.map(() => null);
		const data = await res.json();
		return Array.isArray(data.matches) ? data.matches : queries.map(() => null);
	}

	// check every track; refetch thumbnails for valid ones; collect the dead ones'
	// indices for re-matching. `myRun`/`isCancelled` let the progress sheet abort
	async function verifyAndRepair(tracks, onProgress, isCancelled) {
		const sample = tracks.find((t) => t.url || t.videoId);
		if (sample) {
			const probe = await checkYt(sample.url);
			if (!probe.ok && probe.status === 0) {
				onProgress(tracks.length, tracks.length, 'Skipped availability check');
				return tracks;
			}
		}

		const dead = [];
		let checked = 0;

		await runPool(tracks, VERIFY_CONCURRENCY, async (t, idx) => {
			if (isCancelled()) return;
			const res = await checkYt(t.url);
			if (res.ok) {
				if (res.thumbnail) t.thumbnail = res.thumbnail; // refetch fresh thumbnail
				if (!t.artist && res.artist) t.artist = res.artist;
			} else if (res.status === 404 || res.status === 401 || res.status === 403) {
				dead.push(idx); // gone/blocked -> needs a re-match
			}
			checked++;
			onProgress(checked, tracks.length, 'Checking tracks');
		});

		if (isCancelled()) return tracks;

		// re-match the dead tracks by title+artist, in batches (same as Spotify import)
		let repaired = 0;
		for (let i = 0; i < dead.length; i += MATCH_BATCH) {
			if (isCancelled()) break;
			const slice = dead.slice(i, i + MATCH_BATCH);
			const queries = slice.map((idx) => ({title: tracks[idx].title, artist: tracks[idx].artist}));
			let matches;
			try {
				matches = await matchBatch(queries);
			} catch (e) {
				matches = queries.map(() => null);
			}
			slice.forEach((idx, k) => {
				const m = matches[k];
				if (m && (m.id || m.url)) {
					const t = tracks[idx];
					t.videoId = m.id || t.videoId;
					t.url = m.url || watchUrl(m.id);
					if (m.thumbnail || m.imageUrl) t.thumbnail = m.thumbnail || m.imageUrl;
					if (m.duration) t.duration = m.duration;
				} else {
					tracks[idx]._unresolved = true; // no replacement found -> drop it
				}
			});
			repaired += slice.length;
			onProgress(tracks.length, tracks.length, 'Repairing ' + repaired + ' / ' + dead.length);
		}

		return tracks.filter((t) => !t._unresolved);
	}

	/* ☆======= Progress sheet =======☆ */

	let runToken = 0;

	async function runImport(parsed) {
		const bs = window.starlBottomSheet;
		const myRun = ++runToken;
		const isCancelled = () => myRun !== runToken;
		let fillEl = null;
		let labelEl = null;

		if (bs) {
			bs.open({
				render(body) {
					const heading = document.createElement('div');
					heading.className = 'bsc-settings-header';
					heading.textContent = 'Importing ' + parsed.title;
					body.appendChild(heading);

					labelEl = document.createElement('div');
					labelEl.className = 'ipl-status spi-progress-label';
					labelEl.textContent = '0 / ' + parsed.tracks.length;
					body.appendChild(labelEl);

					const bar = document.createElement('div');
					bar.className = 'spi-progress-bar';
					fillEl = document.createElement('div');
					fillEl.className = 'spi-progress-fill';
					bar.appendChild(fillEl);
					body.appendChild(bar);

					const note = document.createElement('div');
					note.className = 'ipl-hint';
					note.textContent = 'Checking each track is still available and refreshing artwork.';
					body.appendChild(note);
				},
				onClose() {
					runToken++; // cancel the in-flight verify if the sheet is dismissed
				},
			});
		}

		function onProgress(done, total, phase) {
			if (isCancelled()) return;
			const pct = total ? Math.round((done / total) * 100) : 0;
			if (fillEl) fillEl.style.width = pct + '%';
			if (labelEl) labelEl.textContent = phase + ' · ' + done + ' / ' + total;
		}

		const tracks = await verifyAndRepair(parsed.tracks, onProgress, isCancelled);
		if (isCancelled()) return;

		if (!tracks.length) {
			if (labelEl) labelEl.textContent = 'No playable tracks could be resolved.';
			return;
		}

		// hand off to the shared preview (Add as playlist / Add as locked)
		if (window.starlImportPlaylist && typeof window.starlImportPlaylist.openPreview === 'function') {
			window.starlImportPlaylist.openPreview({title: parsed.title, tracks});
		}
	}

	/* ☆======= File picker =======☆ */

	function readFile(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result || ''));
			reader.onerror = () => reject(new Error('Could not read that file.'));
			reader.readAsText(file);
		});
	}

	function openFilePicker() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,application/json';
		input.style.display = 'none';
		document.body.appendChild(input);

		input.addEventListener('change', async () => {
			const file = input.files && input.files[0];
			document.body.removeChild(input);
			if (!file) return;
			let parsed;
			try {
				const text = await readFile(file);
				parsed = parsePlaylist(JSON.parse(text));
			} catch (err) {
				const bs = window.starlBottomSheet;
				const msg = (err && err.message) || 'That file is not a valid playlist export.';
				if (bs) {
					bs.open({
						render(body) {
							const m = document.createElement('div');
							m.className = 'ipl-status';
							m.textContent = msg;
							body.appendChild(m);
						},
					});
				}
				return;
			}
			runImport(parsed);
		});

		input.click();
	}

	/* ☆======= Public API =======☆ */

	window.starlJsonImport = {openFilePicker, parsePlaylist};
})();

/**
 * ☆=========================================☆
 * Spotify import - scrape a Spotify playlist, match it to YouTube, import it
 * Entry point: the "Import from Spotify" row in the library "+" chooser.
 *
 * --- What this file does? ---
 * - openModal(): paste a public Spotify playlist link, then Import
 * - Step 1: GET /spotify/playlist -> the playlist's {title, tracks:[{title,artist}]}
 * - Step 2: POST /match in batches (with a progress bar) to find each track on YouTube,
 *   since Starl can't play Spotify audio itself (DRM)
 * - Step 3: hand the YT-matched tracks to starlImportPlaylist.openPreview() so the user
 *   picks "Add as playlist" (editable) or "Add as locked" (immutable, yellow outline)
 *
 * --- Dictionary / Terms / Extra details ---
 * - Matching is best-effort: tracks with no YT result are skipped (reported in the count)
 * - Server scrape is no-auth (open.spotify.com embed) so no Spotify credentials are needed
 * ☆=========================================☆
 */

(function () {
	const BATCH_SIZE = 25;

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

	function isSpotifyPlaylistLink(value) {
		const v = String(value || '').trim();
		return /open\.spotify\.com\/playlist\/[A-Za-z0-9]{22}/.test(v) || /spotify:playlist:[A-Za-z0-9]{22}/.test(v);
	}

	async function scrapeSpotify(ref) {
		const token = getToken();
		if (!token) throw new Error('Login required');
		const res = await fetch(getApiBase() + '/spotify/playlist?id=' + encodeURIComponent(ref), {
			headers: {Authorization: 'Bearer ' + token},
		});
		if (!res.ok) {
			let msg = 'Could not read that Spotify playlist';
			try {
				const body = await res.json();
				if (body && (body.detail || body.error)) msg = body.detail || body.error;
			} catch (e) {}
			throw new Error(msg);
		}
		return res.json();
	}

	async function matchBatch(queries) {
		const token = getToken();
		if (!token) return [];
		const res = await fetch(getApiBase() + '/match', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
			body: JSON.stringify({queries}),
		});
		if (!res.ok) return queries.map(() => null);
		const data = await res.json();
		return Array.isArray(data.matches) ? data.matches : queries.map(() => null);
	}

	/* ☆======= Modal =======☆ */

	let runToken = 0;

	function openModal() {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		let inputEl = null;
		let statusEl = null;
		let importBtn = null;

		bs.open({
			render(body) {
				const heading = document.createElement('div');
				heading.className = 'bsc-settings-header';
				heading.textContent = 'Import from Spotify';
				body.appendChild(heading);

				const hint = document.createElement('div');
				hint.className = 'ipl-hint';
				hint.textContent = 'Paste a public Spotify playlist link. Tracks are matched to YouTube to play.';
				body.appendChild(hint);

				inputEl = document.createElement('input');
				inputEl.type = 'text';
				inputEl.className = 'bsc-settings-input';
				inputEl.placeholder = 'https://open.spotify.com/playlist/…';
				inputEl.autocomplete = 'off';
				inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						start();
					}
				});
				body.appendChild(inputEl);

				importBtn = document.createElement('button');
				importBtn.type = 'button';
				importBtn.className = 'bsc-btn primary spi-import-btn';
				importBtn.textContent = 'Import';
				importBtn.addEventListener('click', start);
				body.appendChild(importBtn);

				statusEl = document.createElement('div');
				statusEl.className = 'ipl-status';
				body.appendChild(statusEl);

				setTimeout(() => inputEl && inputEl.focus(), 100);
			},
			onClose() {
				runToken++; // cancel any in-flight matching when the sheet is dismissed
			},
		});

		async function start() {
			const ref = inputEl.value.trim();
			if (!ref) return;
			if (!isSpotifyPlaylistLink(ref)) {
				statusEl.textContent = 'That doesn’t look like a Spotify playlist link.';
				return;
			}
			importBtn.disabled = true;
			statusEl.textContent = 'Reading playlist…';
			try {
				await importFromLink(ref);
			} catch (err) {
				statusEl.textContent = (err && err.message) || 'Import failed';
				importBtn.disabled = false;
			}
		}
	}

	/* ☆======= Import directly from a known link (paste flow + share intent) =======☆ */

	// scrape -> match -> hand to the shared preview. used by openModal()'s Import
	// button and by the share chooser when a Spotify playlist is shared to starl
	async function importFromLink(ref) {
		if (!isSpotifyPlaylistLink(ref)) throw new Error('That doesn’t look like a Spotify playlist link.');
		const playlist = await scrapeSpotify(ref);
		const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
		if (!tracks.length) throw new Error('No tracks found in that playlist.');
		await matchAndPreview(playlist, tracks);
	}

	/* ☆======= Match with progress, then preview =======☆ */

	async function matchAndPreview(playlist, tracks) {
		const bs = window.starlBottomSheet;
		const myRun = ++runToken;
		let fillEl = null;
		let labelEl = null;

		bs.open({
			render(body) {
				const heading = document.createElement('div');
				heading.className = 'bsc-settings-header';
				heading.textContent = 'Matching to YouTube…';
				body.appendChild(heading);

				labelEl = document.createElement('div');
				labelEl.className = 'ipl-status spi-progress-label';
				labelEl.textContent = '0 / ' + tracks.length;
				body.appendChild(labelEl);

				const bar = document.createElement('div');
				bar.className = 'spi-progress-bar';
				fillEl = document.createElement('div');
				fillEl.className = 'spi-progress-fill';
				bar.appendChild(fillEl);
				body.appendChild(bar);

				const note = document.createElement('div');
				note.className = 'ipl-hint';
				note.textContent = 'Finding each Spotify song on YouTube. This can take a moment for big playlists.';
				body.appendChild(note);
			},
			onClose() {
				runToken++; // cancelled
			},
		});

		const matched = [];
		let processed = 0;
		for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
			if (myRun !== runToken) return; // sheet dismissed -> stop
			const slice = tracks.slice(i, i + BATCH_SIZE);
			const queries = slice.map((t) => ({title: t.title || '', artist: t.artist || ''}));
			let results;
			try {
				results = await matchBatch(queries);
			} catch (e) {
				results = queries.map(() => null);
			}
			if (myRun !== runToken) return;
			results.forEach((m) => {
				if (m && m.id) matched.push(m);
			});
			processed += slice.length;
			const pct = Math.round((processed / tracks.length) * 100);
			if (fillEl) fillEl.style.width = pct + '%';
			if (labelEl) labelEl.textContent = processed + ' / ' + tracks.length + ' • ' + matched.length + ' matched';
		}

		if (myRun !== runToken) return;

		if (!matched.length) {
			if (labelEl) labelEl.textContent = 'No tracks could be matched to YouTube.';
			return;
		}

		// hand off to the shared preview (Add as playlist / Add as locked).
		if (window.starlImportPlaylist && typeof window.starlImportPlaylist.openPreview === 'function') {
			window.starlImportPlaylist.openPreview({
				title: playlist.title || 'Spotify playlist',
				author: playlist.author || '',
				url: playlist.url || '',
				id: playlist.id || '',
				tracks: matched,
			});
		}
	}

	/* ☆======= Public API =======☆ */

	window.starlSpotifyImport = {openModal, importFromLink};
})();

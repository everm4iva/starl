/**
 * ☆=========================================☆
 * Playlist repair - patch up a playlist's dead tracks and stale covers
 * "Repair playlist" in the settings sheet. Walks every track and:
 *   - refetches a missing / expired cover image
 *   - re-searches a track that's gone (dead link) by title+artist and swaps in
 *     a working match (same song, fresh URL) - same engine the JSON import uses
 *
 * --- What this file does? ---
 * - repair(playlistId): run the pass with a progress sheet, then write it back
 *
 * --- Dictionary / Terms / Extra details ---
 * - availability is checked via YouTube oEmbed; the in-app WebView blocks that with
 *   CORS, so on the phone we skip the dead-track check and still refetch covers +
 *   re-match tracks that have no source at all (dead links get caught at play time
 *   by smart-queue). In a browser (dev) the full check runs.
 * - re-matching goes through POST /match (same as the Spotify / JSON imports)
 * ☆=========================================☆
 */

(function () {
	const MATCH_BATCH = 25;
	const VERIFY_CONCURRENCY = 6;

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

	function toast(msg, kind) {
		if (typeof window.showToast === 'function') window.showToast(msg, kind);
		else if (window.starlLayout && typeof window.starlLayout.showToast === 'function')
			window.starlLayout.showToast(msg, kind);
	}

	function watchUrl(videoId) {
		return videoId ? 'https://music.youtube.com/watch?v=' + videoId : '';
	}

	// dig an 11-char YouTube id out of a watch URL or a bare id
	function extractVideoId(str) {
		const s = String(str || '');
		const m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/) || s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
		if (m) return m[1];
		if (/^[A-Za-z0-9_-]{11}$/.test(s.trim())) return s.trim();
		return '';
	}

	function isStableArt(u) {
		return /googleusercontent\.com|lh3\./i.test(u || '');
	}

	// a cover needs refreshing if it's missing, or it's a signed/expiring i.ytimg frame
	function needsCover(url) {
		if (!url) return true;
		if (/i\.ytimg\.com/i.test(url) && url.indexOf('?') !== -1) return true; // signed, will expire
		return false;
	}

	function rebuildCover(videoId, current) {
		if (isStableArt(current)) return current.replace(/=w\d+-h\d+/i, '=w544-h544'); // stable art -> bump size
		if (videoId) return 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
		if (/i\.ytimg\.com/i.test(current || '')) return current.split('?')[0]; // drop the signature
		return current || '';
	}

	/* ☆======= Verify + re-match (mirrors json-import) =======☆ */

	function checkYt(url) {
		if (!url) return Promise.resolve({ok: false, status: 0});
		return fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url))
			.then((r) => {
				if (r.ok) return r.json().then((d) => ({ok: true, status: 200, thumbnail: d.thumbnail_url || ''}));
				return {ok: false, status: r.status};
			})
			.catch(() => ({ok: false, status: 0}));
	}

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

	// bust a cover from BOTH caches and pull it back fresh and nice. order matters: drop the client
	// blob, drop the server file, then cacheImage() - which fetches through the server's
	// cache/image proxy, so the server re-downloads the file AND the client re-stores it - neat and cutely
	async function bustAndReloadImage(url) {
		if (!url) return;
		const cache = window.starlMediaCache;
		try {
			if (cache && typeof cache.removeImage === 'function') await cache.removeImage(url);
		} catch (e) {}
		try {
			const token = getToken();
			await fetch(getApiBase() + '/cache/image?url=' + encodeURIComponent(url), {
				method: 'DELETE',
				headers: token ? {Authorization: 'Bearer ' + token} : {},
			});
		} catch (e) {}
		try {
			if (cache && typeof cache.cacheImage === 'function') await cache.cacheImage(url);
		} catch (e) {}
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

	// work items mirror a playlist track but track their own videoId + repair flags
	function toWork(track) {
		const videoId = extractVideoId(track.sourceUrl) || extractVideoId(track.trackKey);
		return {
			title: track.title || 'Untitled',
			artist: track.artist || '',
			album: track.album || '',
			imageUrl: track.imageUrl || '',
			sourceUrl: track.sourceUrl || '',
			streamUrl: track.streamUrl || '',
			duration: Number(track.duration) || 0,
			trackKey: track.trackKey || '',
			videoId,
		};
	}

	function workToTrack(w) {
		const sourceUrl = w.sourceUrl || watchUrl(w.videoId);
		return {
			title: w.title,
			artist: w.artist,
			album: w.album,
			imageUrl: w.imageUrl,
			sourceUrl,
			streamUrl: w.streamUrl,
			duration: w.duration,
			trackKey: w.trackKey || sourceUrl,
		};
	}

	// the actual pass. Returns {tracks, repaired, covers}
	async function runRepair(rawTracks, onProgress, isCancelled) {
		const tracks = rawTracks.map(toWork);
		let covers = 0;

		// 1. refetch missing / expiring covers (cheap, no network - just rebuilds the URL)
		tracks.forEach((t) => {
			if (needsCover(t.imageUrl)) {
				const rebuilt = rebuildCover(t.videoId, t.imageUrl);
				if (rebuilt && rebuilt !== t.imageUrl) {
					t.imageUrl = rebuilt;
					covers++;
				}
			}
		});

		// 2. figure out which tracks need a fresh source. anything with no source at all always
		// does. Where oEmbed is reachable (browser), dead links get flagged too
		const dead = [];
		tracks.forEach((t, idx) => {
			if (!t.sourceUrl && !t.videoId) dead.push(idx);
		});

		const sample = tracks.find((t) => t.sourceUrl || t.videoId);
		let canProbe = false;
		if (sample) {
			const probe = await checkYt(sample.sourceUrl || watchUrl(sample.videoId));
			canProbe = probe.ok || probe.status !== 0;
		}
		if (canProbe && !isCancelled()) {
			let checked = 0;
			await runPool(tracks, VERIFY_CONCURRENCY, async (t, idx) => {
				if (isCancelled()) return;
				if (!t.sourceUrl && !t.videoId) return; // already queued above
				const res = await checkYt(t.sourceUrl || watchUrl(t.videoId));
				if (res.ok && res.thumbnail && needsCover(t.imageUrl)) {
					t.imageUrl = res.thumbnail;
					covers++;
				} else if (res.status === 404 || res.status === 401 || res.status === 403) {
					if (dead.indexOf(idx) === -1) dead.push(idx);
				}
				checked++;
				onProgress(checked, tracks.length, 'Checking tracks');
			});
		}

		if (isCancelled()) return {tracks: rawTracks, repaired: 0, covers};

		// 3. re-match the dead ones by title+artist and swap in the working result
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
					t.sourceUrl = m.url || watchUrl(m.id);
					t.trackKey = t.sourceUrl; // point the key at the fresh, working source
					if (m.thumbnail || m.imageUrl) t.imageUrl = m.thumbnail || m.imageUrl;
					if (m.duration) t.duration = m.duration;
					repaired++;
				}
				// no match -> leave the original track untouched (never drop data on a repair)
			});
			onProgress(
				tracks.length,
				tracks.length,
				'Re-matching ' + Math.min(i + slice.length, dead.length) + ' / ' + dead.length,
			);
		}

		if (isCancelled()) return {tracks: rawTracks, repaired, covers, reloaded: 0};

		// 4. bust every cover from the client + server caches and reload it fresh, so stale or
		// expired art gets replaced (the user explicitly wants a hard image refresh here)
		const withImage = tracks.filter((t) => t.imageUrl);
		let reloaded = 0;
		await runPool(withImage, 4, async (t) => {
			if (isCancelled()) return;
			await bustAndReloadImage(t.imageUrl);
			reloaded++;
			onProgress(reloaded, withImage.length, 'Refreshing covers');
		});

		return {tracks: tracks.map(workToTrack), repaired, covers, reloaded};
	}

	/* ☆======= Progress sheet + entry point =======☆ */

	let runToken = 0;

	async function repair(playlistId) {
		const api = window.starlPlaylists;
		const playlist = api && typeof api.get === 'function' ? api.get(playlistId) : null;
		if (!playlist) {
			toast('Playlist not found.', 'danger');
			return;
		}
		if (playlist.locked) {
			toast('That playlist is locked (read-only).', 'danger');
			return;
		}
		const rawTracks = playlist.tracks || [];
		if (!rawTracks.length) {
			toast('This playlist has no tracks to repair.', 'danger');
			return;
		}

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
					heading.textContent = 'Repairing ' + (playlist.title || 'playlist');
					body.appendChild(heading);

					labelEl = document.createElement('div');
					labelEl.className = 'ipl-status spi-progress-label';
					labelEl.textContent = '0 / ' + rawTracks.length;
					body.appendChild(labelEl);

					const bar = document.createElement('div');
					bar.className = 'spi-progress-bar';
					fillEl = document.createElement('div');
					fillEl.className = 'spi-progress-fill';
					bar.appendChild(fillEl);
					body.appendChild(bar);

					const note = document.createElement('div');
					note.className = 'ipl-hint';
					note.textContent = 'Refreshing covers and re-finding tracks that went missing.';
					body.appendChild(note);
				},
				onClose() {
					runToken++; // dismissing the sheet cancels the in-flight pass
				},
			});
		}

		function onProgress(done, total, phase) {
			if (isCancelled()) return;
			const pct = total ? Math.round((done / total) * 100) : 0;
			if (fillEl) fillEl.style.width = pct + '%';
			if (labelEl) labelEl.textContent = phase + ' · ' + done + ' / ' + total;
		}

		const result = await runRepair(rawTracks, onProgress, isCancelled);
		if (isCancelled()) return;

		api.replaceTracks(playlistId, result.tracks);
		try {
			window.dispatchEvent(new CustomEvent('starl-playlists-updated'));
		} catch (e) {}

		if (bs) bs.close();
		const parts = [];
		parts.push(
			result.repaired
				? 'fixed ' + result.repaired + ' track' + (result.repaired === 1 ? '' : 's')
				: 'no dead tracks',
		);
		if (result.reloaded) parts.push('reloaded ' + result.reloaded + ' cover' + (result.reloaded === 1 ? '' : 's'));
		toast('Repair done - ' + parts.join(', ') + '.', 'success');
	}

	/* ☆======= Public API =======☆ */

	window.starlPlaylistRepair = {repair};
})();

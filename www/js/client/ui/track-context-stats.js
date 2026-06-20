/**
 * ☆=========================================☆
 * Track context stats - statistics panel for a track
 * A bottom sheet showing cache status, file size, format, video ID,
 * and a "reset track cache" button. Opened by track-context-menu.js.
 *
 * --- What this file does? ---
 * - open(track): opens the statistics bottom sheet for a given track
 * - Polls cache state every 2s while the sheet is open
 * - Reset button clears client-side IndexedDB record + server-side cached file,
 *   then kicks off a fresh prewarm so the next play is fast
 *
 * --- Dictionary / Terms / Extra details ---
 * - Registered as window.starlTrackContextStats so track-context-menu.js can call it
 * ☆=========================================☆
 */

(function () {
	function fmtDuration(s) {
		const n = Number(s) || 0;
		if (!n) return '-';
		const h = Math.floor(n / 3600);
		const m = Math.floor((n % 3600) / 60);
		const sec = Math.floor(n % 60);
		if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
		return m + ':' + String(sec).padStart(2, '0');
	}

	function fmtBytes(b) {
		if (!b) return null;
		if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
		if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
		return b + ' B';
	}

	function extractVideoId(url) {
		if (!url) return '';
		const m = String(url).match(/[?&]v=([A-Za-z0-9_-]{11})/);
		if (m) return m[1];
		const m2 = String(url).match(/\/([A-Za-z0-9_-]{11})(?:[?&#]|$)/);
		return m2 ? m2[1] : '';
	}

	async function getCacheRecord(t) {
		const cache = window.starlMediaCache;
		if (!cache || typeof cache.getTrackRecord !== 'function') return null;
		const keys = [t.trackKey, t.sourceUrl, t.streamUrl].filter(Boolean);
		for (const key of keys) {
			try {
				const rec = await cache.getTrackRecord(key);
				if (rec && rec.blob) return rec;
			} catch (_) {}
		}
		return null;
	}

	async function open(t) {
		const bs = window.starlBottomSheet;
		if (!bs) return;

		const rec = await getCacheRecord(t);
		const videoId = extractVideoId(t.sourceUrl || t.trackKey);
		const isCached = Boolean(rec && rec.blob);
		const fileSize = isCached ? fmtBytes(rec.blob.size) : null;
		const format = isCached ? rec.blob.type || 'audio/mpeg' : null;

		let statsInterval = null;

		bs.open({
			onClose() {
				if (statsInterval) {
					clearInterval(statsInterval);
					statsInterval = null;
				}
			},
			render(statsBody) {
				const heading = document.createElement('div');
				heading.className = 'bsc-settings-header';
				heading.textContent = 'Statistics';
				statsBody.appendChild(heading);

				function statRow(label, value) {
					const row = document.createElement('div');
					row.className = 'bsc-stat-row';
					const lbl = document.createElement('span');
					lbl.className = 'bsc-stat-label';
					lbl.textContent = label;
					const val = document.createElement('span');
					val.className = 'bsc-stat-value';
					val.textContent = value != null ? String(value) : '';
					row.appendChild(lbl);
					row.appendChild(val);
					statsBody.appendChild(row);
					return {row, val};
				}

				statRow('Duration', fmtDuration(t.duration));
				const {val: cachedValEl} = statRow('Cached', isCached ? '100% - ' + fileSize : '0% (not cached)');
				const {row: fileSizeRow, val: fileSizeValEl} = statRow('File size', fileSize || '');
				if (fileSizeRow) fileSizeRow.style.display = isCached && fileSize ? '' : 'none';
				const {row: formatRow, val: formatValEl} = statRow('Format', format || '');
				if (formatRow) formatRow.style.display = isCached && format ? '' : 'none';
				if (videoId) statRow('Video ID', videoId);
				statRow('Track key', t.trackKey.length > 60 ? t.trackKey.slice(0, 60) + '…' : t.trackKey);

				const sep = document.createElement('div');
				sep.className = 'bsc-separator';
				sep.style.margin = '8px 20px';
				statsBody.appendChild(sep);

				/* ☆======= Reset button =======☆ */

				const resetBtn = document.createElement('button');
				resetBtn.type = 'button';
				resetBtn.className = 'bsc-btn danger';
				resetBtn.style.cssText = 'margin: 0 20px 16px 20px; width: calc(100% - 40px); flex: none;';
				resetBtn.textContent = 'Reset track cache';
				resetBtn.addEventListener('click', async () => {
					resetBtn.disabled = true;
					resetBtn.textContent = 'Resetting…';
					try {
						const cache = window.starlMediaCache;
						if (cache && typeof cache.removeTrack === 'function') {
							const keys = [t.trackKey, t.sourceUrl, t.streamUrl].filter(Boolean);
							for (const key of keys) {
								await cache.removeTrack(key).catch(() => {});
							}
						}

						const sourceUrl = t.sourceUrl || t.trackKey || '';
						if (sourceUrl) {
							const base = typeof getApiBase === 'function' ? getApiBase() : '';
							const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
							if (base && token) {
								await fetch(base + '/cache/track?source_url=' + encodeURIComponent(sourceUrl), {
									method: 'DELETE',
									headers: {Authorization: 'Bearer ' + token},
								}).catch(() => {});

								// prewarm: kick off a fresh server-side resolve so next play is fast
								fetch(base + '/prewarm', {
									method: 'POST',
									headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
									body: JSON.stringify({url: sourceUrl, quality: 'high'}),
								}).catch(() => {});
							}
						}

						if (cachedValEl) cachedValEl.textContent = '0% (not cached)';
						if (fileSizeRow) fileSizeRow.style.display = 'none';
						if (formatRow) formatRow.style.display = 'none';
						resetBtn.textContent = 'Reset done';
						resetBtn.style.opacity = '0.5';

						// if this is the track currently playing, the local cache/blob it was
						// playing from is now gone (or was the source of the playback issue) -
						// re-request the stream from the server and restart from 0 instead of
						// leaving playback running off the stale source.
						const pb = window.starlPlaybackState;
						const playingKey = pb && pb.currentTrackKey;
						const trackKeys = [t.trackKey, t.sourceUrl, t.streamUrl].filter(Boolean);
						if (playingKey && trackKeys.includes(playingKey) && window.starlPlayer) {
							window.starlPlayer.playFromSearch(t, {keepPlayerState: true, queueAlreadySet: true});
						}
					} catch (err) {
						resetBtn.disabled = false;
						resetBtn.textContent = 'Reset failed - tap to retry';
					}
				});
				statsBody.appendChild(resetBtn);

				// poll cache state every 2s while sheet is open
				statsInterval = setInterval(async () => {
					const newRec = await getCacheRecord(t);
					const nowCached = Boolean(newRec && newRec.blob);
					const nowSize = nowCached ? fmtBytes(newRec.blob.size) : null;
					const nowFormat = nowCached ? newRec.blob.type || 'audio/mpeg' : null;
					if (cachedValEl) cachedValEl.textContent = nowCached ? '100% - ' + nowSize : '0% (not cached)';
					if (fileSizeRow) {
						if (nowCached && nowSize) {
							if (fileSizeValEl) fileSizeValEl.textContent = nowSize;
							fileSizeRow.style.display = '';
						} else {
							fileSizeRow.style.display = 'none';
						}
					}
					if (formatRow) {
						if (nowCached && nowFormat) {
							if (formatValEl) formatValEl.textContent = nowFormat;
							formatRow.style.display = '';
						} else {
							formatRow.style.display = 'none';
						}
					}
				}, 2000);
			},
		});
	}

	window.starlTrackContextStats = {open};
})();

/**
 * ☆=========================================☆
 * Import playlist - chooser, import-by-link/search, and preview
 * Powers the library "+" button chooser (create vs import) and the whole
 * import flow for YouTube / YouTube Music public ("community") playlists.
 *
 * --- What this file does? ---
 * - openChooser(): bottom sheet asking "Create playlist" or "Import playlist"
 * - openImportModal(): paste a playlist URL, or search community playlists live
 * - openPreviewFromItem(item): resolve a search result, then show the preview
 * - openPreview(resolved): choose "Add as playlist" (editable) or "Add as
 *   locked" (immutable, yellow outline) before saving into the library
 *
 * --- Dictionary / Terms / Extra details ---
 * - "community playlist" = a real public YT/YTMusic playlist (search kind 'community')
 * - "locked" import = an immutable copy; see playlists.js / playlists-ui.js
 * - Resolution goes through the server: GET /playlist?id=<id|url> -> {title, tracks}
 * ☆=========================================☆
 */

(function () {
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

	function looksLikePlaylistLink(value) {
		const v = String(value || '').trim();
		if (!v) return false;
		if (/list=/.test(v)) return true;
		// a bare playlist id pasted directly (PL.., VL.., OLAK.., RD..)
		if (/^(VL|PL|OLAK|RD|UU|FL)[A-Za-z0-9_-]{6,}$/.test(v)) return true;
		return false;
	}

	function setThumb(el, url) {
		if (!el || !url) return;
		const cache = window.starlMediaCache;
		if (cache && typeof cache.resolveImageUrl === 'function') {
			cache
				.resolveImageUrl(url, 'low')
				.then((resolved) => {
					if (resolved) el.style.backgroundImage = 'url("' + resolved.replace(/"/g, '%22') + '")';
				})
				.catch(() => {});
		} else {
			el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
		}
	}

	// playlist tracks use {url, thumbnail, ...}; map to the shape starlPlaylists expects
	function toPlaylistTracks(tracks) {
		return (Array.isArray(tracks) ? tracks : []).map((t) => ({
			title: t.title || '',
			artist: t.artist || t.author || '',
			album: t.album || '',
			imageUrl: t.thumbnail || t.imageUrl || '',
			sourceUrl: t.url || t.sourceUrl || '',
			streamUrl: t.streamUrl || '',
			duration: t.duration || 0,
			trackKey: t.url || t.sourceUrl || t.id || '',
		}));
	}

	/* ☆======= Server calls =======☆ */

	async function resolvePlaylist(ref) {
		const token = getToken();
		if (!token) throw new Error('Login required');
		const res = await fetch(getApiBase() + '/playlist?id=' + encodeURIComponent(ref), {
			headers: {Authorization: 'Bearer ' + token},
		});
		if (!res.ok) {
			let msg = 'Could not import that playlist';
			try {
				const body = await res.json();
				if (body && body.detail) msg = body.detail;
				else if (body && body.error) msg = body.error;
			} catch (e) {}
			throw new Error(msg);
		}
		return res.json();
	}

	async function searchCommunity(query) {
		const token = getToken();
		if (!token) return [];
		const res = await fetch(getApiBase() + '/search', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
			body: JSON.stringify({query, limit: 32, kind: 'community', offset: 0}),
		});
		if (!res.ok) return [];
		const data = await res.json();
		return Array.isArray(data.items) ? data.items : [];
	}

	/* ☆======= Chooser =======☆ */

	function openChooser() {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		bs.open({
			render(body) {
				const heading = document.createElement('div');
				heading.className = 'bsc-settings-header';
				heading.textContent = 'Add a playlist';
				body.appendChild(heading);

				body.appendChild(
					actionRow('Create playlist', 'ipl-icon-create', () => {
						bs.close();
						setTimeout(() => {
							if (window.starlPlaylists && typeof window.starlPlaylists.openCreateModal === 'function') {
								window.starlPlaylists.openCreateModal(null, {openAfterCreate: true});
							}
						}, 50);
					}),
				);
				body.appendChild(
					actionRow('Import from YouTube', 'ipl-icon-import', () => {
						bs.close();
						setTimeout(openImportModal, 50);
					}),
				);
				if (window.starlSpotifyImport && typeof window.starlSpotifyImport.openModal === 'function') {
					body.appendChild(
						actionRow('Import from Spotify', 'ipl-icon-import', () => {
							bs.close();
							setTimeout(() => window.starlSpotifyImport.openModal(), 50);
						}),
					);
				}
				if (window.starlJsonImport && typeof window.starlJsonImport.openFilePicker === 'function') {
					body.appendChild(
						actionRow('Import from JSON file', 'ipl-icon-file', () => {
							bs.close();
							setTimeout(() => window.starlJsonImport.openFilePicker(), 50);
						}),
					);
				}
				if (window.starlPlaylistExport && typeof window.starlPlaylistExport.exportAllPlaylists === 'function') {
					body.appendChild(
						actionRow('Export all playlists', 'ipl-icon-file', () => {
							bs.close();
							setTimeout(() => window.starlPlaylistExport.exportAllPlaylists(), 50);
						}),
					);
				}
			},
		});
	}

	function actionRow(label, iconClass, handler) {
		const row = document.createElement('div');
		row.className = 'bsc-action ipl-action';
		const icon = document.createElement('div');
		icon.className = 'bsc-action-icon ' + iconClass;
		const text = document.createElement('span');
		text.textContent = label;
		row.appendChild(icon);
		row.appendChild(text);
		row.addEventListener('click', handler);
		return row;
	}

	/* ☆======= Import modal (link or search) =======☆ */

	function openImportModal() {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		let inputEl = null;
		let resultsEl = null;
		let statusEl = null;
		let importBtn = null;
		let debounceId = null;
		let searchSeq = 0;

		bs.open({
			render(body) {
				body.classList.add('ipl-import-body');

				const heading = document.createElement('div');
				heading.className = 'bsc-settings-header';
				heading.textContent = 'Import playlist';
				body.appendChild(heading);

				const hint = document.createElement('div');
				hint.className = 'ipl-hint';
				hint.textContent = 'Paste a YouTube playlist link, or search public playlists.';
				body.appendChild(hint);

				inputEl = document.createElement('input');
				inputEl.type = 'text';
				inputEl.className = 'bsc-settings-input';
				inputEl.placeholder = 'Playlist link or search…';
				inputEl.autocomplete = 'off';
				body.appendChild(inputEl);

				importBtn = document.createElement('button');
				importBtn.type = 'button';
				importBtn.className = 'bsc-btn primary ipl-link-btn hidden';
				importBtn.textContent = 'Import from link';
				importBtn.addEventListener('click', importFromLink);
				body.appendChild(importBtn);

				statusEl = document.createElement('div');
				statusEl.className = 'ipl-status';
				body.appendChild(statusEl);

				resultsEl = document.createElement('div');
				resultsEl.className = 'ipl-results';
				body.appendChild(resultsEl);

				inputEl.addEventListener('input', onInput);
				inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && looksLikePlaylistLink(inputEl.value)) {
						e.preventDefault();
						importFromLink();
					}
				});
				setTimeout(() => inputEl && inputEl.focus(), 100);
			},
		});

		function onInput() {
			const q = inputEl.value.trim();
			clearTimeout(debounceId);
			const isLink = looksLikePlaylistLink(q);
			importBtn.classList.toggle('hidden', !isLink);
			if (!q || isLink) {
				resultsEl.innerHTML = '';
				statusEl.textContent = '';
				return;
			}
			statusEl.textContent = 'Searching…';
			const seq = ++searchSeq;
			debounceId = setTimeout(async () => {
				const items = await searchCommunity(q).catch(() => []);
				if (seq !== searchSeq) return;
				renderResults(items);
			}, 300);
		}

		function renderResults(items) {
			resultsEl.innerHTML = '';
			statusEl.textContent = items.length ? '' : 'No playlists found.';
			items.forEach((item) => {
				const row = document.createElement('div');
				row.className = 'ipl-result';
				const cover = document.createElement('div');
				cover.className = 'ipl-result-cover';
				setThumb(cover, item.thumbnail || item.imageUrl || '');
				const info = document.createElement('div');
				info.className = 'ipl-result-info';
				const name = document.createElement('div');
				name.className = 'ipl-result-title';
				name.textContent = item.title || 'Untitled';
				const sub = document.createElement('div');
				sub.className = 'ipl-result-sub';
				const parts = [];
				if (item.artist || item.author) parts.push(item.artist || item.author);
				if (item.views) parts.push(item.views + ' plays');
				sub.textContent = parts.join(' • ') || 'Playlist';
				info.appendChild(name);
				info.appendChild(sub);
				row.appendChild(cover);
				row.appendChild(info);
				row.addEventListener('click', () => openPreviewFromItem(item));
				resultsEl.appendChild(row);
			});
		}

		async function importFromLink() {
			const ref = inputEl.value.trim();
			if (!ref) return;
			statusEl.textContent = 'Resolving…';
			importBtn.disabled = true;
			try {
				const resolved = await resolvePlaylist(ref);
				openPreview(resolved);
			} catch (err) {
				statusEl.textContent = (err && err.message) || 'Could not import that playlist';
			} finally {
				importBtn.disabled = false;
			}
		}
	}

	/* ☆======= Preview + add =======☆ */

	async function openPreviewFromItem(item) {
		const ref = (item && (item.id || item.url)) || '';
		if (!ref) return;
		const bs = window.starlBottomSheet;
		if (bs) {
			bs.open({
				render(body) {
					const msg = document.createElement('div');
					msg.className = 'ipl-status';
					msg.textContent = 'Loading playlist…';
					body.appendChild(msg);
				},
			});
		}
		try {
			const resolved = await resolvePlaylist(ref);
			if (!resolved.title && item) resolved.title = item.title;
			openPreview(resolved);
		} catch (err) {
			if (bs) {
				bs.open({
					render(body) {
						const msg = document.createElement('div');
						msg.className = 'ipl-status';
						msg.textContent = (err && err.message) || 'Could not load that playlist';
						body.appendChild(msg);
					},
				});
			}
		}
	}

	function openPreview(resolved) {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		const tracks = toPlaylistTracks(resolved && resolved.tracks);
		const title = (resolved && resolved.title) || 'Imported playlist';
		const source = (resolved && (resolved.id || resolved.url)) || '';

		bs.open({
			render(body) {
				const header = document.createElement('div');
				header.className = 'ipl-preview-header';
				const cover = document.createElement('div');
				cover.className = 'ipl-preview-cover';
				const firstImg = tracks.find((t) => t.imageUrl);
				if (firstImg) setThumb(cover, firstImg.imageUrl);
				const info = document.createElement('div');
				info.className = 'ipl-preview-info';
				const titleEl = document.createElement('div');
				titleEl.className = 'ipl-preview-title';
				titleEl.textContent = title;
				const subEl = document.createElement('div');
				subEl.className = 'ipl-preview-sub';
				subEl.textContent = tracks.length + ' songs';
				if (resolved && resolved.author) subEl.textContent += ' • ' + resolved.author;
				info.appendChild(titleEl);
				info.appendChild(subEl);
				header.appendChild(cover);
				header.appendChild(info);
				body.appendChild(header);

				if (!tracks.length) {
					const empty = document.createElement('div');
					empty.className = 'ipl-status';
					empty.textContent = 'This playlist has no playable tracks.';
					body.appendChild(empty);
					return;
				}

				const choose = document.createElement('div');
				choose.className = 'ipl-choose-hint';
				choose.textContent = 'How do you want to add it?';
				body.appendChild(choose);

				const editableBtn = document.createElement('button');
				editableBtn.type = 'button';
				editableBtn.className = 'bsc-btn primary ipl-add-btn';
				editableBtn.textContent = 'Add as playlist (editable)';
				editableBtn.addEventListener('click', () => add(false));
				body.appendChild(editableBtn);

				const lockedBtn = document.createElement('button');
				lockedBtn.type = 'button';
				lockedBtn.className = 'bsc-btn ipl-add-btn ipl-add-locked';
				lockedBtn.textContent = 'Add as locked (read-only)';
				lockedBtn.addEventListener('click', () => add(true));
				body.appendChild(lockedBtn);

				const note = document.createElement('div');
				note.className = 'ipl-hint';
				note.textContent = 'Locked playlists get a yellow outline and can’t be edited.';
				body.appendChild(note);
			},
		});

		function add(locked) {
			if (window.starlPlaylists && typeof window.starlPlaylists.importPlaylist === 'function') {
				window.starlPlaylists.importPlaylist({title, tracks, locked, source, openAfterCreate: true});
			}
			bs.close();
		}
	}

	/* ☆======= Resolve (used by share-intent for queue/play-now) =======☆ */

	// resolve a playlist ref (id or URL) to {title, author, source, tracks[]} in the
	// shape starlPlaybackQueue expects. Lets the share chooser play/queue a shared
	// playlist without going through the import preview
	async function resolve(ref) {
		const resolved = await resolvePlaylist(ref);
		return {
			title: (resolved && resolved.title) || 'Imported playlist',
			author: (resolved && resolved.author) || '',
			source: (resolved && (resolved.id || resolved.url)) || ref,
			tracks: toPlaylistTracks(resolved && resolved.tracks),
		};
	}

	/* ☆======= Public API =======☆ */

	window.starlImportPlaylist = {openChooser, openImportModal, openPreviewFromItem, openPreview, resolve};
})();

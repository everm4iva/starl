/**
 * ☆=========================================☆
 * Track context menu - slide-up bottom sheet for track actions
 * A rich bottom sheet that lets the user act on any track. Can be triggered by
 * a long hover, right-click, or a direct call to openForTrack().
 *
 * --- What this file does? ---
 * - openForTrack(track, opts): opens the sheet for a specific track
 * - bindTarget(element, trackGetter): wires long-hover + right-click to an element
 * - Header shows track cover, title, and artist
 * - Action buttons: favorite, view artist/album, add to queue, play next,
 *   add to playlist, remove from context, download
 * - Statistics panel lives in track-context-stats.js (loaded after this)
 *
 * --- Dictionary / Terms / Extra details ---
 * - Long hover = 2 seconds of sustained hover over a bound element
 * - "source" in opts tells the sheet where it was triggered from (ex: 'player')
 * ☆=========================================☆
 */

(function () {
	const LONG_HOVER_DELAY_MS = 2000;
	const TARGETS = new WeakMap();

	let openTimerId = null;
	let activePlayerListener = null;

	function clearPlayerListener() {
		if (activePlayerListener) {
			window.removeEventListener('starl-playback-changed', activePlayerListener);
			activePlayerListener = null;
		}
	}

	/* ☆======= Normalization =======☆ */

	function normalizeTrack(track) {
		if (!track || typeof track !== 'object') return null;
		const title = String(track.title || '').trim() || 'Untitled';
		const artist = String(track.artist || '').trim() || 'Unknown artist';
		const album = String(track.album || '').trim();
		const imageUrl = String(track.imageUrl || track.thumbnail || '').trim();
		const sourceUrl = String(track.sourceUrl || track.url || '').trim();
		const streamUrl = String(track.streamUrl || '').trim();
		const trackKey = String(track.trackKey || sourceUrl || streamUrl || title + '|' + artist).trim();
		if (!trackKey) return null;
		return {
			title,
			artist,
			album,
			imageUrl,
			sourceUrl,
			streamUrl,
			trackKey,
			duration: Number(track.duration || 0) || 0,
			artistChannelId: String(track.artistChannelId || '').trim(),
			albumId: String(track.albumId || '').trim(),
		};
	}

	/* ☆======= Row resolution (for explode-on-remove) =======☆ */

	const ROW_SELECTOR = '.ap-track-row, .lsr-row, .slt-item, .item';

	function resolveRowEl(target) {
		if (!target) return null;
		return target.closest ? target.closest(ROW_SELECTOR) || target : target;
	}

	/* ☆======= Cover image helper =======☆ */

	function setImage(el, imageUrl) {
		if (!el || !imageUrl) return;
		const cache = window.starlMediaCache;
		if (cache && typeof cache.setImageEl === 'function') {
			cache.setImageEl(el, imageUrl, {variant: 'low'});
		} else if (cache && typeof cache.resolveImageUrl === 'function') {
			cache
				.resolveImageUrl(imageUrl, 'low')
				.then((url) => {
					if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
				})
				.catch(() => {});
		} else {
			el.style.backgroundImage = 'url("' + imageUrl.replace(/"/g, '%22') + '")';
		}
	}

	/* ☆======= Removal action =======☆ */

	function getRemovalAction(options, track) {
		const source = String((options && options.source) || '').trim();
		if (source === 'history') {
			return {
				label: 'Remove from history',
				handler() {
					if (window.starlHistory) window.starlHistory.remove(track.trackKey);
				},
			};
		}
		if (source === 'playlist' && options.playlistId) {
			return {
				label: 'Remove from playlist',
				handler() {
					if (window.starlPlaylists)
						window.starlPlaylists.removeTrackFromPlaylist(options.playlistId, track.trackKey);
				},
			};
		}
		if (source === 'favorites') {
			return {
				label: 'Remove from starred',
				handler() {
					if (window.starlFavorites) window.starlFavorites.removeFavorite(track.trackKey);
				},
			};
		}
		if (source === 'music' || source === 'all') {
			return {
				label: 'Remove from library',
				handler() {
					if (window.starlHistory) window.starlHistory.remove(track.trackKey);
					if (window.starlFavorites) window.starlFavorites.removeFavorite(track.trackKey);
				},
			};
		}
		return null;
	}

	/* ☆======= Toast helper =======☆ */

	function toast(message) {
		if (typeof showToast === 'function') {
			showToast(message);
			return;
		}
		if (window.starlLayout && typeof window.starlLayout.showToast === 'function') {
			window.starlLayout.showToast(message);
			return;
		}
		const el = document.createElement('div');
		el.textContent = message;
		el.style.cssText =
			'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 18px;border-radius:20px;font-size:0.9rem;z-index:9999;pointer-events:none;transition:opacity 0.3s';
		document.body.appendChild(el);
		setTimeout(() => {
			el.style.opacity = '0';
			setTimeout(() => el.remove(), 350);
		}, 1800);
	}

	/* ☆======= Library tab helper =======☆ */

	function goToLibrary() {
		const btn = document.querySelector('.tabs-btn[data-tab="library"]');
		if (btn) btn.click();
	}

	/* ☆======= "Save MIX as a playlist" (only while a mix is playing) ===☆ */

	function isInMix() {
		const ctx = window.starlPlaybackContext;
		return Boolean(ctx && ctx.type === 'mix');
	}

	// snapshot the current queue (the mix) into a brand-new playlist the user names.
	function saveMixAsPlaylist() {
		const bs = window.starlBottomSheet;
		const queueApi = window.starlPlaybackQueue;
		if (!bs || !queueApi || typeof queueApi.getQueue !== 'function') return;
		const tracks = queueApi.getQueue();
		if (!tracks || !tracks.length) {
			toast('The mix is empty');
			return;
		}
		const ctx = window.starlPlaybackContext;
		const defaultName = (ctx && ctx.title ? ctx.title : 'MIX') + ' playlist';
		let inputEl = null;

		bs.open({
			render(innerBody) {
				const heading = document.createElement('div');
				heading.className = 'bsc-settings-header';
				heading.textContent = 'Save MIX as a playlist';
				innerBody.appendChild(heading);
				inputEl = document.createElement('input');
				inputEl.type = 'text';
				inputEl.className = 'bsc-settings-input';
				inputEl.placeholder = 'Playlist name';
				inputEl.autocomplete = 'off';
				inputEl.value = defaultName;
				inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						create();
					}
				});
				innerBody.appendChild(inputEl);
				const row = document.createElement('div');
				row.className = 'bsc-settings-row';
				const cancelBtn = document.createElement('button');
				cancelBtn.type = 'button';
				cancelBtn.className = 'bsc-btn';
				cancelBtn.textContent = 'Cancel';
				cancelBtn.addEventListener('click', () => bs.close());
				const saveBtn = document.createElement('button');
				saveBtn.type = 'button';
				saveBtn.className = 'bsc-btn primary';
				saveBtn.textContent = 'Save';
				saveBtn.addEventListener('click', create);
				row.appendChild(cancelBtn);
				row.appendChild(saveBtn);
				innerBody.appendChild(row);
				setTimeout(() => inputEl && inputEl.focus(), 100);
			},
		});

		function create() {
			const name = inputEl && inputEl.value.trim();
			if (!name) return;
			if (window.starlPlaylists && typeof window.starlPlaylists.importPlaylist === 'function') {
				window.starlPlaylists.importPlaylist({title: name, tracks, openAfterCreate: true, source: 'mix'});
			}
			bs.close();
		}
	}

	/* ☆=== Queue section (rendered by track-context-queue.js) ===☆ */

	function buildQueueSection(body, bs) {
		// delegate to track-context-queue.js
		if (window.starlTrackContextQueue && typeof window.starlTrackContextQueue.buildQueueSection === 'function') {
			window.starlTrackContextQueue.buildQueueSection(body, bs);
		}
	}

	/* ☆======= Artist navigation =======☆ */

	// does this credit look like more than one artist ("A & B", "A feat. B", "A, B")?
	// so real single names like "Above & Beyond" still come back as one artist)
	function looksCombined(name) {
		const s = String(name || '');
		return /[,/;、·&+]/.test(s) || /\s(?:x|vs\.?|feat\.?|ft\.?|featuring|with)\s/i.test(s);
	}

	// ask the server to split a plain-text credit into the real artists it names.
	// returns [{name, channel_id, photo_url}] (possibly one, or empty if none verified)
	async function resolveArtistCredit(name) {
		try {
			const base = typeof getApiBase === 'function' ? getApiBase() : '';
			const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
			if (!base || !token) return [];
			const res = await fetch(base + '/artist/resolve', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
				body: JSON.stringify({name}),
			});
			if (!res.ok) return [];
			const data = await res.json();
			return data && Array.isArray(data.artists) ? data.artists : [];
		} catch (_) {
			return [];
		}
	}

	function openResolvedArtist(a, fallbackImage) {
		window.starlArtistPage.openArtist({
			name: a.name,
			channelId: a.channel_id,
			imageUrl: a.photo_url || fallbackImage || '',
			// tracks must be an array - renderArtistDetail reads artist.tracks.length before the server fetch; the real songs/albums arrive via the channelId lookup
			tracks: [],
		});
	}

	// a combined credit resolved to several artists: show a small chooser so the user picks which one to open (one "View artist" row per resolved artist)
	function openArtistChooser(list, t) {
		const bs = window.starlBottomSheet;
		if (!bs) {
			openResolvedArtist(list[0], t.imageUrl);
			return;
		}
		bs.open({
			render(body) {
				const header = document.createElement('div');
				header.className = 'bsc-track-header';
				const info = document.createElement('div');
				info.className = 'bsc-track-info';
				const titleEl = document.createElement('div');
				titleEl.className = 'bsc-track-title';
				titleEl.textContent = 'Multiple artists';
				const subEl = document.createElement('div');
				subEl.className = 'bsc-track-sub';
				subEl.textContent = t.artist;
				info.appendChild(titleEl);
				info.appendChild(subEl);
				header.appendChild(info);
				body.appendChild(header);

				const d = document.createElement('div');
				d.className = 'bsc-separator';
				body.appendChild(d);

				list.forEach((a) => {
					const row = document.createElement('div');
					row.className = 'bsc-action';
					const icon = document.createElement('div');
					icon.className = 'bsc-action-icon bsc-icon-artist';
					const text = document.createElement('span');
					text.textContent = 'View artist: ' + a.name;
					row.appendChild(icon);
					row.appendChild(text);
					row.addEventListener('click', () => {
						bs.close();
						setTimeout(() => openResolvedArtist(a, t.imageUrl), 50);
					});
					body.appendChild(row);
				});
			},
		});
	}

	async function resolveAndOpenArtist(t) {
		if (!window.starlArtistPage || !t || !t.artist) return;
		const native = window.starlLibraryNative;
		const artists = native ? native.getArtistList() : [];
		const exact = artists.find((a) => a.name.toLowerCase() === t.artist.toLowerCase());
		let channelId = (exact && exact.channelId) || t.artistChannelId || '';

		// a combined credit ("Vertigoaway & rainsdeaf") we don't already know locally: ask the server to split it into the real artists it names. Several -> let the user pick;
		// exactly one -> open it directly; none -> fall through to the plain fallback below
		if (!channelId && looksCombined(t.artist)) {
			const resolved = await resolveArtistCredit(t.artist);
			if (resolved.length >= 2) {
				openArtistChooser(resolved, t);
				return;
			}
			if (resolved.length === 1 && resolved[0].channel_id) {
				openResolvedArtist(resolved[0], t.imageUrl);
				return;
			}
		}

		if (!channelId) {
			try {
				const base = typeof getApiBase === 'function' ? getApiBase() : '';
				const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
				if (base && token) {
					const res = await fetch(base + '/search', {
						method: 'POST',
						headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
						body: JSON.stringify({query: t.artist, kind: 'channels', limit: 1}),
					});
					if (res.ok) {
						const data = await res.json();
						const first = data && data.items && data.items[0];
						// only trust the search hit if its name actually matches the track's
						// artist - YouTube channel search can return a different, similarly
						// named channel as the top result
						if (
							first &&
							first.id &&
							String(first.title || '')
								.trim()
								.toLowerCase() === t.artist.trim().toLowerCase()
						) {
							channelId = first.id;
						}
					}
				}
			} catch (_) {}
		}

		const artistObj = exact
			? {...exact, channelId}
			: {name: t.artist, imageUrl: t.imageUrl, tracks: [t], channelId};
		window.starlArtistPage.openArtist(artistObj);
	}

	/* ☆======= Build and open sheet =======☆ */

	function openForTrack(track, options) {
		const t = normalizeTrack(track);
		if (!t) return;
		const opts = options && typeof options === 'object' ? options : {};
		const bs = window.starlBottomSheet;
		if (!bs) return;

		clearPlayerListener();

		const favApi = window.starlFavorites;
		const isFav = Boolean(favApi && typeof favApi.isFavorited === 'function' && favApi.isFavorited(t.trackKey));

		bs.open({
			onClose: clearPlayerListener,
			render(body) {
				if (opts.source === 'player') buildQueueSection(body, bs);

				// header
				const header = document.createElement('div');
				header.className = 'bsc-track-header';
				const cover = document.createElement('div');
				cover.className = 'bsc-track-cover';
				if (t.imageUrl) setImage(cover, t.imageUrl);
				const info = document.createElement('div');
				info.className = 'bsc-track-info';
				const titleEl = document.createElement('div');
				titleEl.className = 'bsc-track-title';
				titleEl.textContent = t.title;
				const subEl = document.createElement('div');
				subEl.className = 'bsc-track-sub';
				subEl.textContent = t.artist + (t.album ? ' · ' + t.album : '');
				info.appendChild(titleEl);
				info.appendChild(subEl);
				header.appendChild(cover);
				header.appendChild(info);
				body.appendChild(header);

				function action(label, iconClass, handler, danger) {
					const row = document.createElement('div');
					row.className = 'bsc-action' + (danger ? ' danger' : '');
					const icon = document.createElement('div');
					icon.className = 'bsc-action-icon ' + (iconClass || '');
					const text = document.createElement('span');
					text.textContent = label;
					row.appendChild(icon);
					row.appendChild(text);
					row.addEventListener('click', () => {
						bs.close();
						setTimeout(handler, 50);
					});
					body.appendChild(row);
				}

				function sep() {
					const d = document.createElement('div');
					d.className = 'bsc-separator';
					body.appendChild(d);
				}

				const favIcon = isFav ? 'bsc-icon-star-fill' : 'bsc-icon-star';
				const favLabel = isFav ? 'Remove from favorites' : 'Add to favorites';
				action(favLabel, favIcon, () => {
					if (favApi && typeof favApi.toggleFavorite === 'function') favApi.toggleFavorite(t.trackKey, t);
				});

				// lyrics sits directly under favorites (no separator). The label flips to
				// "unavailable" only when the background probe has confirmed there are none
				const lyricsApi = window.starlLyrics;
				const lyricsAvailable =
					lyricsApi && typeof lyricsApi.isAvailable === 'function'
						? lyricsApi.isAvailable(t.trackKey)
						: undefined;
				const lyricsLabel = lyricsAvailable === false ? 'Lyrics - unavailable' : 'Lyrics';
				action(lyricsLabel, 'bsc-icon-lyrics', () => {
					if (lyricsApi && typeof lyricsApi.open === 'function') lyricsApi.open(t);
				});

				sep();

				action('Add to queue', 'bsc-icon-queue', () => {
					const q = window.starlPlaybackQueue;
					if (q && typeof q.addToEnd === 'function') {
						q.addToEnd(t);
						toast('Added to queue');
					}
				});

				action('Play next', 'bsc-icon-next', () => {
					const q = window.starlPlaybackQueue;
					if (q && typeof q.insertAfterCurrent === 'function') {
						q.insertAfterCurrent(t);
						toast('Plays next');
					}
				});

				sep();

				// create MIX - opens the little chooser (mix-menu.js) that seeds a smart mix
				action('Create MIX', 'bsc-icon-mix', () => {
					if (window.starlMixMenu && typeof window.starlMixMenu.open === 'function') {
						window.starlMixMenu.open(t);
					}
				});

				// only offered while a mix is the thing playing - snapshots it into a playlist.
				if (isInMix()) {
					action('Save Mix as a playlist', 'bsc-icon-playlist-add', saveMixAsPlaylist);
				}

				sep();

				action('Add to playlist', 'bsc-icon-playlist', () => {
					if (window.starlPlaylists && typeof window.starlPlaylists.openAddToPlaylistModal === 'function') {
						window.starlPlaylists.openAddToPlaylistModal(t);
					}
				});

				action('Create playlist with this', 'bsc-icon-playlist-add', () => {
					const bsInner = window.starlBottomSheet;
					if (!bsInner) return;
					let inputEl = null;
					bsInner.open({
						render(innerBody) {
							const heading = document.createElement('div');
							heading.className = 'bsc-settings-header';
							heading.textContent = 'New playlist';
							innerBody.appendChild(heading);
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
							innerBody.appendChild(inputEl);
							const row = document.createElement('div');
							row.className = 'bsc-settings-row';
							const cancelBtn = document.createElement('button');
							cancelBtn.type = 'button';
							cancelBtn.className = 'bsc-btn';
							cancelBtn.textContent = 'Cancel';
							cancelBtn.addEventListener('click', () => bsInner.close());
							const createBtn = document.createElement('button');
							createBtn.type = 'button';
							createBtn.className = 'bsc-btn primary';
							createBtn.textContent = 'Create';
							createBtn.addEventListener('click', create);
							row.appendChild(cancelBtn);
							row.appendChild(createBtn);
							innerBody.appendChild(row);
							setTimeout(() => inputEl && inputEl.focus(), 100);
						},
					});
					function create() {
						const name = inputEl && inputEl.value.trim();
						if (!name) return;
						if (window.starlPlaylists)
							window.starlPlaylists.createPlaylist(name, t, {openAfterCreate: true});
						bsInner.close();
					}
				});

				sep();

				if (t.artist) {
					action('View artist: ' + t.artist, 'bsc-icon-artist', () => resolveAndOpenArtist(t));
				}

				if (
					t.album &&
					opts.source !== 'artist-album' &&
					opts.source !== 'search' &&
					opts.source !== 'playlist'
				) {
					const hasServerAlbum = !!t.albumId;
					const native = window.starlLibraryNative;
					const localAlbum =
						!hasServerAlbum && native
							? (native.getAlbumList() || []).find((a) => a.name === t.album) || null
							: null;

					if (hasServerAlbum || localAlbum) {
						action('View album: ' + t.album, 'bsc-icon-album', () => {
							if (!window.starlArtistPage) return;
							if (hasServerAlbum && typeof window.starlArtistPage.openServerAlbum === 'function') {
								window.starlArtistPage.openServerAlbum({
									id: t.albumId,
									title: t.album,
									thumbnail: t.imageUrl,
									artist: t.artist,
								});
								return;
							}
							window.starlArtistPage.openLocalAlbum(localAlbum);
						});
					}
				}

				sep();

				// quick "yes please, more like this" straight from the track that's playing -
				// hands the boost to recommend-prefs.js, same as the home Recommend menu does
				action('Recommend more of this', 'bsc-icon-recommend-more', () => {
					if (window.starlRecommend && typeof window.starlRecommend.more === 'function') {
						window.starlRecommend.more('track', t);
						toast('Recommending more like this');
					}
				});

				// statistics - delegate to track-context-stats.js if loaded
				action('Statistics', 'bsc-icon-stats', () => {
					if (window.starlTrackContextStats && typeof window.starlTrackContextStats.open === 'function') {
						window.starlTrackContextStats.open(t);
					}
				});

				const removal = getRemovalAction(opts, t);
				if (removal) {
					sep();
					action(
						removal.label,
						'bsc-icon-remove',
						() => {
							const rowEl = opts._rowEl;
							if (rowEl && rowEl.isConnected && window.starlExplodeViolently) {
								window.starlExplodeViolently(rowEl, {onDone: removal.handler});
							} else {
								removal.handler();
							}
						},
						true,
					);
				}

				sep();
				const dlRow = document.createElement('div');
				dlRow.className = 'bsc-action';
				dlRow.style.opacity = '0.35';
				dlRow.style.pointerEvents = 'none';
				const dlIcon = document.createElement('div');
				dlIcon.className = 'bsc-action-icon bsc-icon-download';
				const dlText = document.createElement('span');
				dlText.textContent = 'Download (coming soon)';
				dlRow.appendChild(dlIcon);
				dlRow.appendChild(dlText);
				body.appendChild(dlRow);
			},
		});

		if (opts.source === 'player') {
			activePlayerListener = (e) => {
				const newKey = e && e.detail && e.detail.trackKey;
				if (!newKey || newKey === t.trackKey) return;
				const queueApi = window.starlPlaybackQueue;
				const newTrack =
					queueApi && typeof queueApi.getCurrentTrack === 'function' ? queueApi.getCurrentTrack() : null;
				if (!newTrack) return;
				clearPlayerListener();
				openForTrack(newTrack, opts);
			};
			window.addEventListener('starl-playback-changed', activePlayerListener);
		}
	}

	/* ☆======= Bind target =======☆ */

	function clearTimers() {
		if (openTimerId) {
			clearTimeout(openTimerId);
			openTimerId = null;
		}
	}

	function scheduleOpen(state) {
		clearTimers();
		openTimerId = setTimeout(() => {
			openTimerId = null;
			const track = typeof state.getTrack === 'function' ? state.getTrack() : null;
			openForTrack(track, state.options);
		}, LONG_HOVER_DELAY_MS);
	}

	function bindTarget(target, getTrack, options) {
		if (!target || typeof getTrack !== 'function' || TARGETS.has(target)) return;
		const opts = options && typeof options === 'object' ? options : {};
		opts._rowEl = resolveRowEl(target);
		const state = {target, getTrack, options: opts};
		TARGETS.set(target, state);

		if (opts.directClick) {
			target.addEventListener('click', (e) => {
				e.stopPropagation();
				clearTimers();
				openForTrack(getTrack(), opts);
			});
		} else {
			target.addEventListener('pointerenter', () => scheduleOpen(state));
			target.addEventListener('pointerleave', clearTimers);
			target.addEventListener('pointercancel', clearTimers);
		}

		target.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			clearTimers();
			openForTrack(getTrack(), opts);
		});
	}

	/* ☆======= Public API =======☆ */

	window.starlTrackContextMenu = {
		bindTarget,
		openForTrack,
		resolveAndOpenArtist,
		close() {
			if (window.starlBottomSheet) window.starlBottomSheet.close();
		},
	};
})();

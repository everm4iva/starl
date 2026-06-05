/*
Track context menu
-> slide-up bottom sheet for track actions.
-> triggered by: long-hover (2s) on any bound element, right-click, or direct openForTrack() call.
-> header shows track cover + title + artist.
-> actions: favorite, view artist, view album, add to queue, play next, add to playlist, remove, download.
*/

(function () {
	const LONG_HOVER_DELAY_MS = 2000;
	const TARGETS = new WeakMap();

	let openTimerId = null;

	// ----- Normalization -----

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
		};
	}

	// ----- Cover image helper -----

	function setImage(el, imageUrl) {
		if (!el || !imageUrl) return;
		const cache = window.starlMediaCache;
		if (cache && typeof cache.setImageEl === 'function') {
			cache.setImageEl(el, imageUrl);
		} else if (cache && typeof cache.resolveImageUrl === 'function') {
			cache.resolveImageUrl(imageUrl).then((url) => {
				if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
			}).catch(() => {});
		} else {
			el.style.backgroundImage = 'url("' + imageUrl.replace(/"/g, '%22') + '")';
		}
	}

	// ----- Removal action -----

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
		return null;
	}

	// ----- Build and open sheet -----

	// ----- Toast helper -----

	function toast(message) {
		if (typeof showToast === 'function') {
			showToast(message);
			return;
		}
		if (window.starlLayout && typeof window.starlLayout.showToast === 'function') {
			window.starlLayout.showToast(message);
			return;
		}
		// Fallback: create a simple toast
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

	// ----- Switch to library tab -----

	function goToLibrary() {
		const btn = document.querySelector('.tabs-btn[data-tab="library"]');
		if (btn) btn.click();
	}

	// ----- Queue section (shown when source === 'player') -----

	function buildQueueSection(body, bs) {
		const queueApi = window.starlPlaybackQueue;
		if (!queueApi || typeof queueApi.getQueue !== 'function') return;
		const queue = queueApi.getQueue();
		if (!queue || !queue.length) return;
		const currentIdx = typeof queueApi.getCurrentIndex === 'function' ? queueApi.getCurrentIndex() : -1;

		const section = document.createElement('div');
		section.className = 'bsc-queue-section';

		const label = document.createElement('div');
		label.className = 'bsc-queue-label';
		label.textContent = 'Queue · ' + queue.length + ' tracks';
		section.appendChild(label);

		const list = document.createElement('div');
		list.className = 'bsc-queue-list';

		queue.forEach((item, idx) => {
			const row = document.createElement('div');
			row.className = 'bsc-queue-row' + (idx === currentIdx ? ' current' : '');

			const cover = document.createElement('div');
			cover.className = 'bsc-queue-cover';
			const imgUrl = item.imageUrl || item.thumbnail || '';
			if (imgUrl) {
				const cache = window.starlMediaCache;
				if (cache && typeof cache.setImageEl === 'function') {
					cache.setImageEl(cover, imgUrl);
				} else {
					cover.style.backgroundImage = 'url("' + imgUrl.replace(/"/g, '%22') + '")';
				}
			}

			const info = document.createElement('div');
			info.className = 'bsc-queue-info';

			const title = document.createElement('div');
			title.className = 'bsc-queue-title';
			title.textContent = item.title || 'Untitled';

			const sub = document.createElement('div');
			sub.className = 'bsc-queue-sub';
			sub.textContent = item.artist || '';

			info.appendChild(title);
			info.appendChild(sub);
			row.appendChild(cover);
			row.appendChild(info);

			if (idx === currentIdx) {
				const indicator = document.createElement('div');
				indicator.className = 'bsc-queue-playing';
				row.appendChild(indicator);
			}

			row.addEventListener('click', () => {
				bs.close();
				setTimeout(() => {
					if (queueApi && typeof queueApi.goToTrack === 'function') {
						const target = queueApi.goToTrack(idx);
						if (target && window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
							window.starlPlayer.playFromSearch({
								trackKey: target.trackKey || '',
								url: target.sourceUrl || target.streamUrl || target.trackKey || '',
								sourceUrl: target.sourceUrl || '',
								streamUrl: target.streamUrl || '',
								title: target.title || '',
								artist: target.artist || '',
								album: target.album || '',
								thumbnail: target.imageUrl || target.thumbnail || '',
								imageUrl: target.imageUrl || target.thumbnail || '',
								duration: target.duration || 0,
							});
						}
					}
				}, 50);
			});

			list.appendChild(row);
		});

		// Scroll current track into view after render
		setTimeout(() => {
			const cur = list.querySelector('.bsc-queue-row.current');
			if (cur) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}, 80);

		section.appendChild(list);

		const divider = document.createElement('div');
		divider.className = 'bsc-separator';
		section.appendChild(divider);

		body.appendChild(section);
	}

	function openForTrack(track, options) {
		const t = normalizeTrack(track);
		if (!t) return;
		const opts = options && typeof options === 'object' ? options : {};
		const bs = window.starlBottomSheet;
		if (!bs) return;

		const favApi = window.starlFavorites;
		const isFav = Boolean(favApi && typeof favApi.isFavorited === 'function' && favApi.isFavorited(t.trackKey));

		bs.open({
			render(body) {
				// ----- Queue (player source only) -----
				if (opts.source === 'player') buildQueueSection(body, bs);

				// ----- Header -----
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

				// ----- Actions helper -----
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

				// Favorite — correct icon per state
				const favIcon = isFav ? 'bsc-icon-star-fill' : 'bsc-icon-star';
				const favLabel = isFav ? 'Remove from favorites' : 'Add to favorites';
				action(favLabel, favIcon, () => {
					if (favApi && typeof favApi.toggleFavorite === 'function') favApi.toggleFavorite(t.trackKey, t);
				});

				sep();

				// Add to queue
				action('Add to queue', 'bsc-icon-queue', () => {
					const q = window.starlPlaybackQueue;
					if (q && typeof q.addToEnd === 'function') {
						q.addToEnd(t);
						toast('Added to queue');
					}
				});

				// Play next
				action('Play next', 'bsc-icon-next', () => {
					const q = window.starlPlaybackQueue;
					if (q && typeof q.insertAfterCurrent === 'function') {
						q.insertAfterCurrent(t);
						toast('Plays next');
					}
				});

				sep();

				// Add to playlist
				action('Add to playlist', 'bsc-icon-playlist', () => {
					if (window.starlPlaylists && typeof window.starlPlaylists.openAddToPlaylistModal === 'function') {
						window.starlPlaylists.openAddToPlaylistModal(t);
					}
				});

				// Create playlist with this — use bottom sheet directly
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

				// View artist
				if (t.artist) {
					action('View artist: ' + t.artist, 'bsc-icon-artist', () => {
						if (!window.starlArtistPage) return;
						const native = window.starlLibraryNative;
						const artists = native ? native.getArtistList() : [];
						const exact = artists.find((a) => a.name.toLowerCase() === t.artist.toLowerCase());
						const fallback = {name: t.artist, imageUrl: t.imageUrl, tracks: [t]};
						window.starlArtistPage.openArtist(exact || fallback);
					});
				}

				// View album (suppressed when inside an album view or search tab)
				if (t.album && opts.source !== 'artist-album' && opts.source !== 'search') {
					action('View album: ' + t.album, 'bsc-icon-album', () => {
						const native = window.starlLibraryNative;
						const albums = native ? native.getAlbumList() : [];
						const found = albums.find((a) => a.name === t.album);
						if (window.starlArtistPage) {
							window.starlArtistPage.openLocalAlbum(
								found || {name: t.album, artist: t.artist, imageUrl: t.imageUrl, tracks: [t]}
							);
						}
					});
				}

				sep();

				// Stats
				action('Statistics', 'bsc-icon-stats', () => {
					const mins = Math.floor((t.duration || 0) / 60);
					const secs = String(Math.floor((t.duration || 0) % 60)).padStart(2, '0');
					alert('Duration: ' + mins + ':' + secs + '\nKey: ' + t.trackKey.slice(0, 80));
				});

				// Removal
				const removal = getRemovalAction(opts, t);
				if (removal) {
					sep();
					action(removal.label, 'bsc-icon-remove', removal.handler, true);
				}

				// Download placeholder
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
	}

	// ----- Timers -----

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

	// ----- Bind target -----

	function bindTarget(target, getTrack, options) {
		if (!target || typeof getTrack !== 'function' || TARGETS.has(target)) return;
		const opts = options && typeof options === 'object' ? options : {};
		const state = {target, getTrack, options: opts};
		TARGETS.set(target, state);

		// directClick: open immediately on click (for dedicated icon buttons)
		// Without it, only long-hover / right-click opens the menu (for whole rows)
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

	// ----- Public API -----

	window.starlTrackContextMenu = {
		bindTarget,
		openForTrack,
		close() {
			if (window.starlBottomSheet) window.starlBottomSheet.close();
		},
	};
})();

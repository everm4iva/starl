/*
Artist / Album page overlay
-> shows an artist or album list from the local library, or a specific artist's page.
-> artists list: grid of artist cards, tap to open artist detail.
-> artist detail: cover, name, stats, Songs and Albums sections.
-> albums list: grid of album cards, tap to open inside-playlist for that album.
-> swipe right on header to go back.
*/

(function () {
	let overlayEl = null;
	let headerEl = null;
	let headerBgEl = null;
	let headerCoverEl = null;
	let headerNameEl = null;
	let headerDetailsEl = null;
	let bodyEl = null;

	let navigationStack = [];

	// ----- Init -----

	function init() {
		overlayEl = document.querySelector('.artist-page');
		if (!overlayEl) return;
		headerEl = overlayEl.querySelector('.header');
		headerBgEl = overlayEl.querySelector('.header-bg');
		headerCoverEl = overlayEl.querySelector('.artist-cover');
		headerNameEl = overlayEl.querySelector('.artist-name');
		headerDetailsEl = overlayEl.querySelector('.artist-details');
		bodyEl = overlayEl.querySelector('.body');

		if (headerEl && window.starlGestures) {
			window.starlGestures.setupPlaylistHeaderSwipe(headerEl, goBack);
		}
	}

	// ----- Helpers -----

	function setImageAsync(el, imageUrl) {
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

	function formatDuration(totalSeconds) {
		const s = Number(totalSeconds);
		if (!Number.isFinite(s) || s <= 0) return '';
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ' min';
	}

	function totalDuration(tracks) {
		return tracks.reduce((t, r) => t + (Number(r && r.duration) || 0), 0);
	}

	// ----- Artist card -----

	function openArtistContextMenu(artist) {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		bs.open({
			render(body) {
				const header = document.createElement('div');
				header.className = 'bsc-track-header';
				const cover = document.createElement('div');
				cover.className = 'bsc-track-cover';
				cover.style.borderRadius = '50%';
				if (artist.imageUrl) setImageAsync(cover, artist.imageUrl);
				const info = document.createElement('div');
				info.className = 'bsc-track-info';
				const titleEl = document.createElement('div');
				titleEl.className = 'bsc-track-title';
				titleEl.textContent = artist.name;
				const subEl = document.createElement('div');
				subEl.className = 'bsc-track-sub';
				subEl.textContent = artist.tracks.length + ' songs in library';
				info.appendChild(titleEl);
				info.appendChild(subEl);
				header.appendChild(cover);
				header.appendChild(info);
				body.appendChild(header);

				function action(label, iconClass, handler, danger) {
					const row = document.createElement('div');
					row.className = 'bsc-action' + (danger ? ' danger' : '');
					const icon = document.createElement('div');
					icon.className = 'bsc-action-icon ' + iconClass;
					const text = document.createElement('span');
					text.textContent = label;
					row.appendChild(icon);
					row.appendChild(text);
					row.addEventListener('click', () => { bs.close(); setTimeout(handler, 50); });
					body.appendChild(row);
				}

				function sep() {
					const d = document.createElement('div');
					d.className = 'bsc-separator';
					body.appendChild(d);
				}

				// Follow / Unfollow
				const follows = window.starlFollows;
				const artistId = artist.name;
				const isFollowing = follows && typeof follows.isFollowingArtist === 'function' && follows.isFollowingArtist(artistId);
				action(
					isFollowing ? 'Unfollow artist' : 'Follow artist',
					isFollowing ? 'bsc-icon-remove' : 'bsc-icon-star',
					() => {
						if (follows && typeof follows.toggleFollowArtist === 'function') {
							follows.toggleFollowArtist(artistId, {name: artist.name, imageUrl: artist.imageUrl});
						}
						renderArtistsList();
					}
				);

				// If artist has tracks in history, offer remove from history
				if (artist.tracks && artist.tracks.length > 0) {
					sep();
					action('Remove all songs from history', 'bsc-icon-remove', () => {
						const hist = window.starlHistory;
						if (!hist || typeof hist.remove !== 'function') return;
						if (!window.confirm('Remove all songs by ' + artist.name + ' from history?')) return;
						artist.tracks.forEach((t) => hist.remove(t.trackKey || t.sourceUrl || ''));
						renderArtistsList();
					}, true);
				}
			},
		});
	}

	function createArtistCard(artist) {
		const card = document.createElement('div');
		card.className = 'ap-card artist-card';
		const cover = document.createElement('div');
		cover.className = 'ap-card-cover';
		if (artist.imageUrl) setImageAsync(cover, artist.imageUrl);
		const name = document.createElement('div');
		name.className = 'ap-card-name';
		name.textContent = artist.name;
		const meta = document.createElement('div');
		meta.className = 'ap-card-meta';
		meta.textContent = artist.tracks.length + ' songs';
		card.appendChild(cover);
		card.appendChild(name);
		card.appendChild(meta);
		card.addEventListener('click', () => openArtist(artist));
		card.addEventListener('contextmenu', (e) => { e.preventDefault(); openArtistContextMenu(artist); });
		// Long press
		let longPressTimer = null;
		card.addEventListener('pointerdown', () => {
			longPressTimer = setTimeout(() => { longPressTimer = null; openArtistContextMenu(artist); }, 600);
		});
		card.addEventListener('pointerup', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });
		card.addEventListener('pointercancel', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });
		card.addEventListener('pointermove', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });
		return card;
	}

	// ----- Album card -----

	function createAlbumCard(album) {
		const card = document.createElement('div');
		card.className = 'ap-card album-card';
		const cover = document.createElement('div');
		cover.className = 'ap-card-cover';
		if (album.imageUrl) setImageAsync(cover, album.imageUrl);
		const name = document.createElement('div');
		name.className = 'ap-card-name';
		name.textContent = album.name;
		const meta = document.createElement('div');
		meta.className = 'ap-card-meta';
		const tracks = album.tracks || [];
		const followed = album.followed;
		meta.textContent = (album.artist ? album.artist + ' • ' : '') + (tracks.length ? tracks.length + ' songs' : followed ? 'Saved' : '');
		card.appendChild(cover);
		card.appendChild(name);
		card.appendChild(meta);
		card.addEventListener('click', () => {
			if (tracks.length) {
				navigationStack.push({view: 'album-detail', album});
				renderAlbumDetail(album);
				if (overlayEl) overlayEl.scrollTop = 0;
			} else {
				// Followed album with no local tracks — open as server album using browseId
				const fetchId = album.browseId || album.id || null;
				openServerAlbum({title: album.name, id: fetchId, thumbnail: album.imageUrl, artist: album.artist});
			}
		});
		return card;
	}

	// ----- Track row (inside artist detail) -----

	function normalizeTrackForPlay(t) {
		return {
			trackKey: t.trackKey || t.id || '',
			url: t.sourceUrl || t.url || t.streamUrl || t.trackKey || t.id || '',
			sourceUrl: t.sourceUrl || t.url || '',
			streamUrl: t.streamUrl || '',
			title: t.title || 'Untitled',
			artist: t.artist || '',
			album: t.album || '',
			thumbnail: t.imageUrl || t.thumbnail || '',
			imageUrl: t.imageUrl || t.thumbnail || '',
			duration: t.duration || 0,
		};
	}

	function createTrackRow(track, index, allTracks, contextSource) {
		const row = document.createElement('div');
		row.className = 'ap-track-row';
		const cover = document.createElement('div');
		cover.className = 'ap-track-cover';
		if (track.imageUrl || track.thumbnail) setImageAsync(cover, track.imageUrl || track.thumbnail);
		const info = document.createElement('div');
		info.className = 'ap-track-info';
		const title = document.createElement('div');
		title.className = 'ap-track-title';
		title.textContent = track.title || 'Untitled';
		const sub = document.createElement('div');
		sub.className = 'ap-track-sub';
		sub.textContent = track.album || track.artist || '';
		info.appendChild(title);
		info.appendChild(sub);

		const moreBtn = document.createElement('div');
		moreBtn.className = 'ap-track-more';
		if (window.starlTrackContextMenu && typeof window.starlTrackContextMenu.bindTarget === 'function') {
			window.starlTrackContextMenu.bindTarget(moreBtn, () => normalizeTrackForPlay(track), {
				source: contextSource || 'artist',
				directClick: true,
			});
		}

		row.appendChild(cover);
		row.appendChild(info);
		row.appendChild(moreBtn);
		row.addEventListener('click', () => {
			const player = window.starlPlayer;
			if (player && typeof player.playWithQueue === 'function') {
				const items = allTracks.map(normalizeTrackForPlay);
				player.playWithQueue(items, index);
			}
		});
		return row;
	}

	// ----- Views -----

	function renderHeader(imageUrl, name, details, iconUrl) {
		if (headerBgEl) {
			headerBgEl.style.backgroundImage = '';
			if (imageUrl) setImageAsync(headerBgEl, imageUrl);
		}
		if (headerCoverEl) {
			headerCoverEl.style.backgroundImage = '';
			headerCoverEl.style.borderRadius = '';
			headerCoverEl.style.backgroundSize = '';
			headerCoverEl.style.backgroundRepeat = '';
			headerCoverEl.style.backgroundColor = '';
			if (imageUrl) {
				setImageAsync(headerCoverEl, imageUrl);
			} else if (iconUrl) {
				headerCoverEl.style.backgroundImage = 'url("' + iconUrl + '")';
				headerCoverEl.style.backgroundSize = '60%';
				headerCoverEl.style.backgroundRepeat = 'no-repeat';
				headerCoverEl.style.borderRadius = '10px';
				headerCoverEl.style.backgroundColor = 'rgba(255,255,255,0.1)';
			}
		}
		if (headerNameEl) headerNameEl.textContent = name || '';
		if (headerDetailsEl) headerDetailsEl.textContent = details || '';
	}

	function renderArtistsList() {
		if (!overlayEl) init();
		if (!overlayEl) return;
		const artists = window.starlLibraryNative ? window.starlLibraryNative.getArtistList() : [];
		renderHeader('', 'Artists', artists.length + ' artists in your library', '../../media/common-icons/light/artist.svg');
		if (bodyEl) {
			bodyEl.innerHTML = '';
			if (!artists.length) {
				const empty = document.createElement('div');
				empty.className = 'ap-empty';
				empty.textContent = 'No artists in your library yet.';
				bodyEl.appendChild(empty);
			} else {
				const grid = document.createElement('div');
				grid.className = 'ap-grid';
				artists.forEach((a) => grid.appendChild(createArtistCard(a)));
				bodyEl.appendChild(grid);
			}
		}
	}

	function renderAlbumsList() {
		if (!overlayEl) init();
		if (!overlayEl) return;
		const albums = window.starlLibraryNative ? window.starlLibraryNative.getAlbumList() : [];
		renderHeader('', 'Albums', albums.length + ' albums in your library', '../../media/common-icons/light/album.svg');
		if (bodyEl) {
			bodyEl.innerHTML = '';
			if (!albums.length) {
				const empty = document.createElement('div');
				empty.className = 'ap-empty';
				empty.textContent = 'No albums in your library yet.';
				bodyEl.appendChild(empty);
			} else {
				const grid = document.createElement('div');
				grid.className = 'ap-grid';
				albums.forEach((a) => grid.appendChild(createAlbumCard(a)));
				bodyEl.appendChild(grid);
			}
		}
	}

	async function fetchArtistFromServer(name) {
		try {
			const base = typeof getApiBase === 'function' ? getApiBase() : window.STARL_API_BASE || '';
			const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
			if (!base || !token) return null;
			const url = base + '/artist?name=' + encodeURIComponent(name) + '&page=0';
			const res = await fetch(url, {headers: {Authorization: 'Bearer ' + token}});
			if (!res.ok) return null;
			return await res.json();
		} catch (error) {
			return null;
		}
	}

	async function fetchAllArtistSongs(channelId, params) {
		try {
			const base = typeof getApiBase === 'function' ? getApiBase() : window.STARL_API_BASE || '';
			const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
			if (!base || !token || !channelId || !params) return null;
			const url = base + '/artist/songs?channel_id=' + encodeURIComponent(channelId) + '&params=' + encodeURIComponent(params);
			const res = await fetch(url, {headers: {Authorization: 'Bearer ' + token}});
			if (!res.ok) return null;
			const data = await res.json();
			return (data && data.tracks) ? data.tracks : null;
		} catch (e) {
			return null;
		}
	}

	// ----- Album detail (within artist-page to avoid z-index issues) -----

	function renderAlbumDetail(album) {
		const tracks = album.tracks || [];
		const dur = totalDuration(tracks);
		renderHeader(album.imageUrl, album.name, (album.artist ? album.artist + ' • ' : '') + tracks.length + ' songs • ' + formatDuration(dur));
		if (!bodyEl) return;
		bodyEl.innerHTML = '';

		// Save album follow button in body header area
		const followRow = document.createElement('div');
		followRow.className = 'ap-follow-row';
		const saveBtn = document.createElement('div');
		// Use browseId as key when available — it's stable and unique.
		// Fall back to name only for local-only albums that have no server id.
		const albumBrowseId = album.id || '';
		const albumSaveKey = albumBrowseId || album.name || '';
		const updateSaveBtn = () => {
			const saved = window.starlFollows && window.starlFollows.isFollowingAlbum(albumSaveKey);
			saveBtn.className = 'ap-follow-btn' + (saved ? ' following' : '');
			saveBtn.textContent = saved ? 'Saved' : 'Save album';
		};
		updateSaveBtn();
		saveBtn.addEventListener('click', () => {
			if (!albumSaveKey) return;
			if (window.starlFollows) {
				window.starlFollows.toggleFollowAlbum(albumSaveKey, {
					name: album.name,
					artist: album.artist,
					imageUrl: album.imageUrl,
					browseId: albumBrowseId,
					id: albumSaveKey,
				});
				updateSaveBtn();
			}
		});
		window.addEventListener('starl-follows-updated', updateSaveBtn);
		followRow.appendChild(saveBtn);
		bodyEl.appendChild(followRow);

		if (!tracks.length) {
			const empty = document.createElement('div');
			empty.className = 'ap-empty';
			empty.textContent = 'No tracks found.';
			bodyEl.appendChild(empty);
			return;
		}
		const section = document.createElement('div');
		section.className = 'ap-section';
		tracks.forEach((t, i) => section.appendChild(createTrackRow(t, i, tracks, 'artist-album')));
		bodyEl.appendChild(section);
	}

	// ----- Expandable album/singles grid -----

	function sortItems(items, mode) {
		const copy = items.slice();
		if (mode === 'date-desc') {
			return copy.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
		}
		if (mode === 'date-asc') {
			return copy.sort((a, b) => (Number(a.year) || 0) - (Number(b.year) || 0));
		}
		// default: original (popularity / server order)
		return copy;
	}

	function buildExpandableGrid(sectionTitle, items) {
		const INITIAL = 4;
		let expanded = false;
		let sortMode = 'default';

		const section = document.createElement('div');
		section.className = 'ap-section';

		// Header row with title + sort controls
		const headerRow = document.createElement('div');
		headerRow.className = 'ap-section-header';

		const titleEl = document.createElement('div');
		titleEl.className = 'ap-section-title';
		titleEl.textContent = sectionTitle;

		const sortBar = document.createElement('div');
		sortBar.className = 'ap-sort-bar';

		const sorts = [
			{ label: 'Popular', mode: 'default' },
			{ label: 'Newest', mode: 'date-desc' },
			{ label: 'Oldest', mode: 'date-asc' },
		];

		sorts.forEach(({ label, mode }) => {
			const btn = document.createElement('div');
			btn.className = 'ap-sort-btn' + (mode === sortMode ? ' active' : '');
			btn.textContent = label;
			btn.addEventListener('click', () => {
				if (sortMode === mode) return;
				sortMode = mode;
				sortBar.querySelectorAll('.ap-sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
				renderGrid();
			});
			sortBar.appendChild(btn);
		});

		headerRow.appendChild(titleEl);
		headerRow.appendChild(sortBar);
		section.appendChild(headerRow);

		const grid = document.createElement('div');
		grid.className = 'ap-grid';
		section.appendChild(grid);

		const seeAllBtn = document.createElement('div');
		seeAllBtn.className = 'ap-load-more';
		section.appendChild(seeAllBtn);

		function renderGrid() {
			grid.innerHTML = '';
			const sorted = sortItems(items, sortMode);
			const visible = expanded ? sorted : sorted.slice(0, INITIAL);
			visible.forEach((a) => grid.appendChild(createServerAlbumCard(a)));

			if (items.length > INITIAL) {
				seeAllBtn.textContent = expanded
					? 'Show less'
					: 'See all ' + sectionTitle.toLowerCase() + ' (' + items.length + ')';
				seeAllBtn.style.display = '';
			} else {
				seeAllBtn.style.display = 'none';
			}
		}

		seeAllBtn.addEventListener('click', () => {
			expanded = !expanded;
			renderGrid();
			if (!expanded && overlayEl) overlayEl.scrollTop = overlayEl.scrollTop;
		});

		renderGrid();
		return section;
	}

	// ----- Artist detail -----

	function addSection(title, contentEl) {
		const section = document.createElement('div');
		section.className = 'ap-section';
		const h = document.createElement('div');
		h.className = 'ap-section-title';
		h.textContent = title;
		section.appendChild(h);
		section.appendChild(contentEl);
		return section;
	}

	async function fetchAlbumFromServer(browseId) {
		try {
			const base = typeof getApiBase === 'function' ? getApiBase() : window.STARL_API_BASE || '';
			const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
			if (!base || !token || !browseId) return null;
			const res = await fetch(base + '/album?id=' + encodeURIComponent(browseId), {
				headers: {Authorization: 'Bearer ' + token},
			});
			if (!res.ok) return null;
			return await res.json();
		} catch (e) {
			return null;
		}
	}

	function createServerAlbumCard(item) {
		const card = document.createElement('div');
		card.className = 'ap-card album-card';
		const cover = document.createElement('div');
		cover.className = 'ap-card-cover';
		if (item.thumbnail) setImageAsync(cover, item.thumbnail);
		const name = document.createElement('div');
		name.className = 'ap-card-name';
		name.textContent = item.title || '';
		const meta = document.createElement('div');
		meta.className = 'ap-card-meta';
		meta.textContent = (item.year || '') + (item.type ? ' · ' + item.type : '');

		card.appendChild(cover);
		card.appendChild(name);
		card.appendChild(meta);
		card.addEventListener('click', async () => {
			// Try local library first
			if (window.starlLibraryNative) {
				const albums = window.starlLibraryNative.getAlbumList();
				const found = albums.find((a) => a.name === item.title);
				if (found && found.tracks && found.tracks.length) {
					navigationStack.push({view: 'album-detail', album: found});
					renderAlbumDetail(found);
					if (overlayEl) overlayEl.scrollTop = 0;
					return;
				}
			}
			// Fetch from server using browseId
			meta.textContent = 'Loading…';
			const remote = item.id ? await fetchAlbumFromServer(item.id) : null;
			if (remote && remote.tracks && remote.tracks.length) {
				const albumObj = {
					id: item.id || '',
					name: remote.title || item.title,
					artist: remote.artist || '',
					imageUrl: remote.thumbnail || item.thumbnail || '',
					tracks: remote.tracks.map((t) => ({
						title: t.title || 'Untitled',
						artist: t.artist || '',
						album: remote.title || '',
						imageUrl: t.imageUrl || t.thumbnail || remote.thumbnail || item.thumbnail || '',
						sourceUrl: t.url || t.sourceUrl || '',
						streamUrl: '',
						trackKey: t.id || t.url || t.sourceUrl || '',
						duration: t.duration || 0,
					})),
				};
				navigationStack.push({view: 'album-detail', album: albumObj});
				renderAlbumDetail(albumObj);
				if (overlayEl) overlayEl.scrollTop = 0;
			} else {
				meta.textContent = (item.year || '') + (item.type ? ' · ' + item.type : '');
				const albumObj = {id: item.id || '', name: item.title, artist: '', imageUrl: item.thumbnail || '', tracks: []};
				navigationStack.push({view: 'album-detail', album: albumObj});
				renderAlbumDetail(albumObj);
				if (overlayEl) overlayEl.scrollTop = 0;
			}
		});
		return card;
	}

	function renderArtistDetail(artist) {
		const dur = totalDuration(artist.tracks);
		const details = artist.tracks.length + ' songs • ' + formatDuration(dur);
		renderHeader(artist.imageUrl, artist.name, details);
		if (!bodyEl) return;
		bodyEl.innerHTML = '';

		// Follow button — pinned at the top of the body, below the header
		const followSection = document.createElement('div');
		followSection.className = 'ap-follow-row';
		const followBtn = document.createElement('div');
		const artistId = artist.name;
		const updateFollowBtn = () => {
			const following = window.starlFollows && window.starlFollows.isFollowingArtist(artistId);
			followBtn.className = 'ap-follow-btn' + (following ? ' following' : '');
			followBtn.textContent = following ? 'Following' : 'Follow';
		};
		updateFollowBtn();
		followBtn.addEventListener('click', () => {
			if (window.starlFollows) {
				window.starlFollows.toggleFollowArtist(artistId, {name: artist.name, imageUrl: artist.imageUrl});
				updateFollowBtn();
			}
		});
		window.addEventListener('starl-follows-updated', updateFollowBtn);
		followSection.appendChild(followBtn);
		bodyEl.appendChild(followSection);

		// Songs section — local data shown immediately, replaced by server data when loaded
		const songsSection = document.createElement('div');
		songsSection.className = 'ap-section';
		const songsSectionHeader = document.createElement('div');
		songsSectionHeader.className = 'ap-section-header';
		const songsSectionTitle = document.createElement('div');
		songsSectionTitle.className = 'ap-section-title';
		songsSectionTitle.textContent = 'Songs';
		const songsSortBar = document.createElement('div');
		songsSortBar.className = 'ap-sort-bar';
		songsSectionHeader.appendChild(songsSectionTitle);
		songsSectionHeader.appendChild(songsSortBar);
		songsSection.appendChild(songsSectionHeader);
		const songsList = document.createElement('div');
		if (artist.tracks.length) {
			artist.tracks.forEach((t, i) => songsList.appendChild(createTrackRow(t, i, artist.tracks)));
		} else {
			const placeholder = document.createElement('div');
			placeholder.className = 'ap-loading';
			placeholder.textContent = 'Loading songs…';
			songsList.appendChild(placeholder);
		}
		// Show a "See all songs" stub while the server fetch is in flight
		const seeAllStub = document.createElement('div');
		seeAllStub.className = 'ap-load-more';
		seeAllStub.textContent = 'See all songs';
		seeAllStub.style.opacity = '0.4';
		seeAllStub.style.pointerEvents = 'none';
		songsList.appendChild(seeAllStub);
		songsSection.appendChild(songsList);
		bodyEl.appendChild(songsSection);

		// Local albums
		const localAlbums = [];
		const seen = new Set();
		artist.tracks.forEach((t) => {
			if (t.album && !seen.has(t.album)) {
				seen.add(t.album);
				localAlbums.push({
					name: t.album, artist: artist.name, imageUrl: t.imageUrl,
					tracks: artist.tracks.filter((x) => x.album === t.album),
				});
			}
		});
		if (localAlbums.length) {
			const albumGrid = document.createElement('div');
			albumGrid.className = 'ap-grid';
			localAlbums.forEach((a) => albumGrid.appendChild(createAlbumCard(a)));
			bodyEl.appendChild(addSection('Albums (library)', albumGrid));
		}

		// Server enrichment — single fetch, updates header + adds real sections
		fetchArtistFromServer(artist.name).then((remote) => {
			if (!remote) return;

			// Update header and follow button with real channel_id
			const subParts = [];
			if (remote.subscribers) subParts.push(remote.subscribers + ' followers');
			if (remote.tracks_total) subParts.push(remote.tracks_total + ' songs');
			renderHeader(remote.photo_url || artist.imageUrl, remote.name || artist.name, subParts.join(' • '));

			// Description
			if (remote.description) {
				const desc = document.createElement('div');
				desc.className = 'ap-description collapsed';
				desc.textContent = remote.description;
				desc.title = 'Tap to expand';
				desc.addEventListener('click', () => desc.classList.toggle('collapsed'));
				if (bodyEl.firstChild) bodyEl.insertBefore(desc, bodyEl.firstChild);
				else bodyEl.appendChild(desc);
			}

			// Replace songs with server tracks + sort bar
			// Remove the loading stub
			seeAllStub.remove();

			if (remote.tracks && remote.tracks.length) {
				let allRemoteTracks = remote.tracks.slice();
				const channelId = remote.channel_id || '';
				const songsParams = remote.songs_params || '';
				let allLoaded = !remote.tracks_has_more;
				const INITIAL_LIMIT = 5;
				let songsSortMode = 'default';
				let songsExpanded = false;

				// Build sort bar
				songsSortBar.innerHTML = '';
				[
					{ label: 'Popular', mode: 'default' },
					{ label: 'Newest', mode: 'date-desc' },
					{ label: 'Oldest', mode: 'date-asc' },
				].forEach(({ label, mode }) => {
					const btn = document.createElement('div');
					btn.className = 'ap-sort-btn' + (mode === songsSortMode ? ' active' : '');
					btn.textContent = label;
					btn.addEventListener('click', () => {
						if (songsSortMode === mode) return;
						songsSortMode = mode;
						songsSortBar.querySelectorAll('.ap-sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
						renderSongsList();
					});
					songsSortBar.appendChild(btn);
				});

				const seeAll = document.createElement('div');
				seeAll.className = 'ap-load-more';

				function renderSongsList() {
					songsList.innerHTML = '';
					const sorted = sortItems(allRemoteTracks, songsSortMode);
					const visible = songsExpanded ? sorted : sorted.slice(0, INITIAL_LIMIT);
					visible.forEach((t, i) => songsList.appendChild(createTrackRow(t, i, sorted)));
					// Show button whenever: not expanded and there are more (loaded or not), or expanded to collapse
					if (songsExpanded) {
						seeAll.textContent = 'Show less';
						seeAll.style.opacity = '';
						seeAll.style.pointerEvents = '';
						songsList.appendChild(seeAll);
					} else if (!allLoaded || allRemoteTracks.length > INITIAL_LIMIT) {
						seeAll.textContent = 'See all songs' + (allLoaded ? ' (' + allRemoteTracks.length + ')' : '');
						seeAll.style.opacity = '';
						seeAll.style.pointerEvents = '';
						songsList.appendChild(seeAll);
					}
				}

				seeAll.addEventListener('click', () => {
					if (songsExpanded) {
						songsExpanded = false;
						renderSongsList();
						return;
					}
					if (!allLoaded) {
						seeAll.textContent = 'Loading…';
						seeAll.style.pointerEvents = 'none';
						fetchAllArtistSongs(channelId, songsParams).then((tracks) => {
							if (tracks && tracks.length) allRemoteTracks = tracks;
							allLoaded = true;
							songsExpanded = true;
							renderSongsList();
						}).catch(() => {
							allLoaded = true;
							songsExpanded = true;
							renderSongsList();
						});
					} else {
						songsExpanded = true;
						renderSongsList();
					}
				});

				renderSongsList();
			} else {
				// Server returned no tracks — clear the placeholder
				songsList.innerHTML = '';
				const empty = document.createElement('div');
				empty.className = 'ap-empty';
				empty.textContent = 'No songs found.';
				songsList.appendChild(empty);
			}

			// Albums/Singles from server
			if (remote.albums && remote.albums.length) {
				bodyEl.appendChild(buildExpandableGrid('Albums', remote.albums));
			}
			if (remote.singles && remote.singles.length) {
				bodyEl.appendChild(buildExpandableGrid('Singles', remote.singles));
			}
		}).catch(() => {});
	}

	// ----- Navigation -----

	function openArtistsList() {
		if (!overlayEl) init();
		if (!overlayEl) return;
		navigationStack = [{view: 'artists-list'}];
		overlayEl.classList.remove('hidden');
		renderArtistsList();
		overlayEl.scrollTop = 0;
	}

	function openAlbumsList() {
		if (!overlayEl) init();
		if (!overlayEl) return;
		navigationStack = [{view: 'albums-list'}];
		overlayEl.classList.remove('hidden');
		renderAlbumsList();
		overlayEl.scrollTop = 0;
	}

	function openArtist(artist) {
		if (!overlayEl) init();
		if (!overlayEl) return;
		navigationStack = [{view: 'artist-detail', artist}];
		overlayEl.classList.remove('hidden');
		renderArtistDetail(artist);
		overlayEl.scrollTop = 0;
	}

	function goBack() {
		navigationStack.pop();
		if (!navigationStack.length) {
			close();
			return;
		}
		const current = navigationStack[navigationStack.length - 1];
		if (current.view === 'artists-list') renderArtistsList();
		else if (current.view === 'albums-list') renderAlbumsList();
		else if (current.view === 'artist-detail') renderArtistDetail(current.artist);
		else if (current.view === 'album-detail') renderAlbumDetail(current.album);
		if (overlayEl) overlayEl.scrollTop = 0;
	}

	function openLocalAlbum(album) {
		if (!overlayEl) init();
		if (!overlayEl) return;
		navigationStack = [{view: 'album-detail', album}];
		overlayEl.classList.remove('hidden');
		renderAlbumDetail(album);
		overlayEl.scrollTop = 0;
	}

	function openServerAlbum(item) {
		if (!overlayEl) init();
		if (!overlayEl) return;
		navigationStack = [{view: 'server-album-loading', item}];
		overlayEl.classList.remove('hidden');
		overlayEl.scrollTop = 0;
		// Show loading state immediately
		renderHeader(item.thumbnail || '', item.title || '', 'Loading…');
		if (bodyEl) bodyEl.innerHTML = '';
		// Fetch and render
		(item.id ? fetchAlbumFromServer(item.id) : Promise.resolve(null)).then((remote) => {
			if (remote && remote.tracks && remote.tracks.length) {
				const albumObj = {
					id: item.id || '',
					name: remote.title || item.title,
					artist: remote.artist || '',
					imageUrl: remote.thumbnail || item.thumbnail || '',
					tracks: remote.tracks.map((t) => ({
						title: t.title || 'Untitled',
						artist: t.artist || remote.artist || '',
						album: remote.title || '',
						imageUrl: t.imageUrl || t.thumbnail || remote.thumbnail || item.thumbnail || '',
						sourceUrl: t.url || t.sourceUrl || '',
						streamUrl: '',
						trackKey: t.id || t.url || t.sourceUrl || '',
						duration: t.duration || 0,
					})),
				};
				navigationStack[0] = {view: 'album-detail', album: albumObj};
				renderAlbumDetail(albumObj);
			} else {
				// No tracks fetched — show empty state
				renderHeader(item.thumbnail || '', item.title || '', item.artist || '');
				if (bodyEl) {
					const empty = document.createElement('div');
					empty.className = 'ap-empty';
					empty.textContent = 'No tracks found.';
					bodyEl.appendChild(empty);
				}
			}
		}).catch(() => {});
	}

	function close() {
		if (overlayEl) overlayEl.classList.add('hidden');
		navigationStack = [];
	}

	// ----- Public API -----

	window.starlArtistPage = {openArtistsList, openAlbumsList, openArtist, openLocalAlbum, openServerAlbum, close};

	if (document.readyState !== 'loading') {
		init();
	} else {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	}
})();

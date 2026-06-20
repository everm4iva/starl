/**
 * ☆=========================================☆
 * Artist page - artist and album overlay (navigation + views)
 * A full-screen overlay that shows an artist list, artist detail, or album detail.
 * Navigates like a mini stack: list -> artist -> album.
 * Card/row builders live in artist-cards.js (loaded before this file).
 *
 * --- What this file does? ---
 * - openArtist(): shows an artist's detail page (songs, albums, bio)
 * - openLocalAlbum() / openServerAlbum(): shows an album's track list
 * - goBack(): pops the nav stack (back arrow / swipe-right on header)
 * - close(): closes the overlay entirely
 * - Fetches server-side artist/album data when a channel ID is available
 *
 * --- Dictionary / Terms / Extra details ---
 * - "channelId" = YouTube channel/artist ID used to fetch server-side data
 * - "local" album/artist = built from the user's history + favorites data
 * - "server" album = fetched from the server via the album API
 * - Swipe right on the header = go back (wired via starlGestures)
 * ☆=========================================☆
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

	/* ☆======= Artist data cache =======☆ */

	// mirrors the server's 30-min artist TTL - repeat opens within a session
	const _ARTIST_CACHE_TTL = 30 * 60 * 1000;
	const _artistCache = new Map();

	function _artistCacheGet(key) {
		const entry = _artistCache.get(key);
		if (!entry) return null;
		if (Date.now() > entry.expiresAt) {
			_artistCache.delete(key);
			return null;
		}
		return entry.data;
	}

	function _artistCacheSet(key, data) {
		_artistCache.set(key, {data, expiresAt: Date.now() + _ARTIST_CACHE_TTL});
	}

	/* ☆======= Init =======☆ */

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

	/* ☆======= Card / row accessors (from artist-cards.js) =======☆ */

	function cards() {
		return window.starlArtistCards || {};
	}

	/* ☆======= Header =======☆ */

	function renderHeader(imageUrl, name, details, iconUrl) {
		const {setImageAsync} = cards();
		if (headerBgEl) {
			headerBgEl.style.backgroundImage = '';
			if (imageUrl && setImageAsync) setImageAsync(headerBgEl, imageUrl);
		}
		if (headerCoverEl) {
			headerCoverEl.style.backgroundImage = '';
			headerCoverEl.style.borderRadius = '';
			headerCoverEl.style.backgroundSize = '';
			headerCoverEl.style.backgroundRepeat = '';
			headerCoverEl.style.backgroundColor = '';
			if (imageUrl && setImageAsync) {
				setImageAsync(headerCoverEl, imageUrl);
			} else if (iconUrl) {
				headerCoverEl.style.backgroundImage = 'url("' + iconUrl + '")';
				headerCoverEl.style.backgroundSize = '60%';
				headerCoverEl.style.backgroundRepeat = 'no-repeat';
				headerCoverEl.style.borderRadius = '10px';
				headerCoverEl.style.backgroundColor = 'rgba(255,255,255,0.2)';
			}
		}
		if (headerNameEl) headerNameEl.textContent = name || '';
		if (headerDetailsEl) headerDetailsEl.textContent = details || '';
	}

	/* ☆======= Server fetch =======☆ */

	function normalizeName(s) {
		return String(s)
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	async function fetchArtistFromServer(name, channelId) {
		const cacheKey = channelId ? 'cid:' + channelId : 'name:' + normalizeName(name || '');
		const hit = _artistCacheGet(cacheKey);
		if (hit) return hit;

		const _auth = window.starlAuth;
		if (_auth && typeof _auth.isCacheMode === 'function' && _auth.isCacheMode()) return null;

		try {
			const base = typeof getApiBase === 'function' ? getApiBase() : window.STARL_API_BASE || '';
			const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
			if (!base || !token) return null;
			const param = channelId
				? 'channel_id=' + encodeURIComponent(channelId)
				: 'name=' + encodeURIComponent(name);
			const res = await fetch(base + '/artist?' + param, {headers: {Authorization: 'Bearer ' + token}});
			const _authA = window.starlAuth;
			if (_authA && typeof _authA.handleAuthFailure === 'function' && _authA.handleAuthFailure(res)) return null;
			if (!res.ok) return null;
			const remote = await res.json();
			// when queried by name (no channelId), reject if the server returned a different artist.
			// normalize comparison handles punctuation/accent/symbol variants of the same name.
			if (!channelId && remote && remote.name) {
				if (normalizeName(remote.name) !== normalizeName(name)) return null;
			}
			if (remote) {
				if (channelId) _artistCacheSet('cid:' + channelId, remote);
				if (remote.channel_id) _artistCacheSet('cid:' + remote.channel_id, remote);
				if (remote.name) _artistCacheSet('name:' + normalizeName(remote.name), remote);
			}
			return remote;
		} catch (error) {
			return null;
		}
	}

	// fetch and cache an artist page in the background without opening the overlay
	// safe to call fire-and-forget; errors are silently swallowed. system is now happy because it didn't crash.
	// code fight code. :P
	async function prewarmArtist(name, channelId) {
		if (!name && !channelId) return;
		if (!navigator.onLine) return;
		const cacheKey = channelId ? 'cid:' + channelId : 'name:' + normalizeName(name || '');
		if (_artistCacheGet(cacheKey)) return;
		await fetchArtistFromServer(name || '', channelId || null);
	}

	async function fetchAlbumFromServer(browseId) {
		const _auth = window.starlAuth;
		if (_auth && typeof _auth.isCacheMode === 'function' && _auth.isCacheMode()) return null;

		try {
			const base = typeof getApiBase === 'function' ? getApiBase() : window.STARL_API_BASE || '';
			const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
			if (!base || !token || !browseId) return null;
			const res = await fetch(base + '/album?id=' + encodeURIComponent(browseId), {
				headers: {Authorization: 'Bearer ' + token},
			});
			const _authB = window.starlAuth;
			if (_authB && typeof _authB.handleAuthFailure === 'function' && _authB.handleAuthFailure(res)) return null;
			if (!res.ok) return null;
			return await res.json();
		} catch (e) {
			return null;
		}
	}

	/* ☆======= Sort helper =======☆ */

	function sortItems(items, mode) {
		const copy = items.slice();
		if (mode === 'date-desc') {
			return copy.sort((a, b) => {
				const ay = Number(a.year) || 0;
				const by = Number(b.year) || 0;
				if (!ay && by) return 1;
				if (ay && !by) return -1;
				const diff = by - ay;
				// tiebreak alphabetically so items with equal/missing year get a stable visible order
				return diff !== 0 ? diff : (a.title || '').localeCompare(b.title || '');
			});
		}
		if (mode === 'date-asc') {
			return copy.sort((a, b) => {
				const ay = Number(a.year) || 0;
				const by = Number(b.year) || 0;
				if (!ay && !by) return (a.title || '').localeCompare(b.title || '');
				if (!ay) return 1;
				if (!by) return -1;
				const diff = ay - by;
				return diff !== 0 ? diff : (a.title || '').localeCompare(b.title || '');
			});
		}
		if (mode === 'alpha-asc') {
			return copy.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
		}
		return copy;
	}

	/* ☆======= Expandable grid =======☆ */

	function buildExpandableGrid(sectionTitle, items) {
		const INITIAL = 4;
		let expanded = false;
		let sortMode = 'default';

		const section = document.createElement('div');
		section.className = 'ap-section';

		const headerRow = document.createElement('div');
		headerRow.className = 'ap-section-header';

		const titleEl = document.createElement('div');
		titleEl.className = 'ap-section-title';
		titleEl.textContent = sectionTitle;

		const sortBar = document.createElement('div');
		sortBar.className = 'ap-sort-bar';

		[
			{label: 'Popular', mode: 'default'},
			{label: 'A-Z', mode: 'alpha-asc'},
			{label: 'Newest', mode: 'date-desc'},
		].forEach(({label, mode}) => {
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
			visible.forEach((a) => grid.appendChild(cards().createServerAlbumCard(a)));

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
		});

		renderGrid();
		return section;
	}

	/* ☆======= Views =======☆ */

	function renderArtistsList() {
		if (!overlayEl) init();
		if (!overlayEl) return;
		const artists = window.starlLibraryNative ? window.starlLibraryNative.getArtistList() : [];
		renderHeader(
			'',
			'Artists',
			artists.length + ' artists in your library',
			'../../media/common-icons/light/artist.svg',
		);
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
				artists.forEach((a) => grid.appendChild(cards().createArtistCard(a)));
				bodyEl.appendChild(grid);
			}
		}
	}

	function renderAlbumsList() {
		if (!overlayEl) init();
		if (!overlayEl) return;
		const albums = window.starlLibraryNative ? window.starlLibraryNative.getAlbumList() : [];
		renderHeader(
			'',
			'Albums',
			albums.length + ' albums in your library',
			'../../media/common-icons/light/album.svg',
		);
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
				albums.forEach((a) => grid.appendChild(cards().createAlbumCard(a)));
				bodyEl.appendChild(grid);
			}
		}
	}

	function renderAlbumDetail(album) {
		const {createTrackRow, formatDuration} = cards();
		const tracks = album.tracks || [];
		const dur = tracks.reduce((t, r) => t + (Number(r && r.duration) || 0), 0);
		renderHeader(
			album.imageUrl,
			album.name,
			(album.artist ? album.artist + ' • ' : '') + tracks.length + ' songs • ' + formatDuration(dur),
		);
		if (!bodyEl) return;
		bodyEl.innerHTML = '';
		const followRow = document.createElement('div');
		followRow.className = 'ap-follow-row';
		const saveBtn = document.createElement('div');
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

	function renderArtistDetail(artist) {
		const {createTrackRow, createAlbumCard, setImageAsync, formatDuration} = cards();
		const dur = artist.tracks.reduce((t, r) => t + (Number(r && r.duration) || 0), 0);
		renderHeader(artist.imageUrl, artist.name, artist.tracks.length + ' songs • ' + formatDuration(dur));
		if (!bodyEl) return;
		bodyEl.innerHTML = '';

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
		const seeAllStub = document.createElement('div');
		seeAllStub.className = 'ap-load-more';
		seeAllStub.textContent = 'See all songs';
		seeAllStub.style.opacity = '0.4';
		seeAllStub.style.pointerEvents = 'none';
		songsList.appendChild(seeAllStub);
		songsSection.appendChild(songsList);
		bodyEl.appendChild(songsSection);

		fetchArtistFromServer(artist.name, artist.channelId || null)
			.then((remote) => {
				if (!remote) return;
				// guard: user may have navigated into an album while the fetch was in flight.
				// applying server data to the wrong view would corrupt the header and body.
				const currentTop = navigationStack[navigationStack.length - 1];
				if (!currentTop || currentTop.view !== 'artist-detail' || currentTop.artist !== artist) return;

				// guard against same-name disambiguation: when we queried by name (no channelId),
				// reject the server result if none of its tracks appear in the user's local library
				// for this artist - two artists can share a name (ex: "BEX" punk rock artist vs "BEX" Bollywood).
				if (!artist.channelId && artist.tracks.length && remote.tracks && remote.tracks.length) {
					const localTitles = new Set(artist.tracks.map((t) => normalizeName(t.title || '')));
					const hasOverlap = remote.tracks.some((t) => localTitles.has(normalizeName(t.title || '')));
					if (!hasOverlap) return;
				}

				const subParts = [];
				if (remote.subscribers) subParts.push(remote.subscribers + ' followers');
				if (remote.tracks_total) subParts.push(remote.tracks_total + ' songs');
				renderHeader(remote.photo_url || artist.imageUrl, remote.name || artist.name, subParts.join(' • '));

				if (remote.description) {
					const desc = document.createElement('div');
					desc.className = 'ap-description collapsed';
					desc.textContent = remote.description;
					desc.title = 'Tap to expand';
					desc.addEventListener('click', () => desc.classList.toggle('collapsed'));
					if (bodyEl.firstChild) bodyEl.insertBefore(desc, bodyEl.firstChild);
					else bodyEl.appendChild(desc);
				}

				seeAllStub.remove();

				if (remote.tracks && remote.tracks.length) {
					const allRemoteTracks = remote.tracks.slice();
					const INITIAL_LIMIT = 5;
					let songsExpanded = false;

					songsSortBar.innerHTML = '';
					let songsSortMode = 'default';
					[
						{label: 'Popular', mode: 'default'},
						{label: 'A-Z', mode: 'alpha-asc'},
						{label: 'Newest', mode: 'date-desc'},
					].forEach(({label, mode}) => {
						const btn = document.createElement('div');
						btn.className = 'ap-sort-btn' + (mode === songsSortMode ? ' active' : '');
						btn.textContent = label;
						btn.addEventListener('click', () => {
							if (songsSortMode === mode) return;
							songsSortMode = mode;
							songsSortBar
								.querySelectorAll('.ap-sort-btn')
								.forEach((b) => b.classList.toggle('active', b === btn));
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
						seeAll.textContent = songsExpanded ? 'Show less' : 'See all songs (' + sorted.length + ')';
						songsList.appendChild(seeAll);
					}

					seeAll.addEventListener('click', () => {
						songsExpanded = !songsExpanded;
						renderSongsList();
					});

					renderSongsList();
				} else {
					songsList.innerHTML = '';
					const empty = document.createElement('div');
					empty.className = 'ap-empty';
					empty.textContent = 'No songs found.';
					songsList.appendChild(empty);
				}

				if (remote.albums && remote.albums.length) {
					bodyEl.appendChild(buildExpandableGrid('Albums', remote.albums));
				}
				if (remote.singles && remote.singles.length) {
					bodyEl.appendChild(buildExpandableGrid('Singles', remote.singles));
				}
			})
			.catch(() => {});
	}

	/* ☆======= Navigation =======☆ */

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

	function openArtist(artist, push) {
		if (!overlayEl) init();
		if (!overlayEl) return;
		if (push) {
			navigationStack.push({view: 'artist-detail', artist});
		} else {
			navigationStack = [{view: 'artist-detail', artist}];
		}
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

	function openServerAlbum(item, push) {
		if (!overlayEl) init();
		if (!overlayEl) return;
		if (push) {
			navigationStack.push({view: 'server-album-loading', item});
		} else {
			navigationStack = [{view: 'server-album-loading', item}];
		}
		const frameIndex = navigationStack.length - 1;
		overlayEl.classList.remove('hidden');
		overlayEl.scrollTop = 0;
		renderHeader(item.thumbnail || '', item.title || '', 'Loading…');
		if (bodyEl) bodyEl.innerHTML = '';
		(item.id ? fetchAlbumFromServer(item.id) : Promise.resolve(null))
			.then((remote) => {
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
					navigationStack[frameIndex] = {view: 'album-detail', album: albumObj};
					renderAlbumDetail(albumObj);
				} else {
					renderHeader(item.thumbnail || '', item.title || '', item.artist || '');
					if (bodyEl) {
						const empty = document.createElement('div');
						empty.className = 'ap-empty';
						empty.textContent = 'No tracks found.';
						bodyEl.appendChild(empty);
					}
				}
			})
			.catch(() => {});
	}

	// helper used by artist-cards.js to push an album onto the nav stack
	function _pushAlbumDetail(album) {
		if (!overlayEl) init();
		if (!overlayEl) return;
		navigationStack.push({view: 'album-detail', album});
		renderAlbumDetail(album);
		if (overlayEl) overlayEl.scrollTop = 0;
	}

	function close() {
		if (overlayEl) overlayEl.classList.add('hidden');
		navigationStack = [];
	}

	/* ☆======= Public API =======☆ */

	window.starlArtistPage = {
		openArtistsList,
		openAlbumsList,
		openArtist,
		openLocalAlbum,
		openServerAlbum,
		goBack,
		close,
		prewarmArtist,
		// semi-private helpers used by artist-cards.js
		_pushAlbumDetail,
		_renderArtistsList: renderArtistsList,
	};

	if (document.readyState !== 'loading') {
		init();
	} else {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	}
})();

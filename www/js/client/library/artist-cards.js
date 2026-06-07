/**
 * ☆=========================================☆
 * Artist cards - card and row builders for the artist/album overlay
 * DOM factory functions used by artist-page.js to build the grids and track lists.
 * Loaded before artist-page.js; exposes window.starlArtistCards.
 *
 * --- What this file does? ---
 * - createArtistCard(artist): square card for the artists grid
 * - createAlbumCard(album): square card for the local albums grid
 * - createTrackRow(track, index, allTracks): row for the track lists
 * - createServerAlbumCard(item): card for server-fetched album grids
 * - openArtistContextMenu(artist): follow/unfollow bottom sheet for an artist
 *
 * --- Dictionary / Terms / Extra details ---
 * - Cards are DOM elements; artist-page.js inserts them into the overlay body
 * - "server album card" = a card whose tracks are fetched on click from the API
 * ☆=========================================☆
 */

(function () {
	/* ☆======= Image helper =======☆ */

	function setImageAsync(el, imageUrl, opts) {
		if (!el || !imageUrl) return;
		const cache = window.starlMediaCache;
		const variant = opts && opts.variant === 'low' ? 'low' : undefined;
		if (cache && typeof cache.setImageEl === 'function') {
			cache.setImageEl(el, imageUrl, opts);
		} else if (cache && typeof cache.resolveImageUrl === 'function') {
			cache
				.resolveImageUrl(imageUrl, variant)
				.then((url) => {
					if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
				})
				.catch(() => {});
		} else {
			el.style.backgroundImage = 'url("' + imageUrl.replace(/"/g, '%22') + '")';
		}
	}

	/* ☆======= Format helpers =======☆ */

	function formatDuration(totalSeconds) {
		const s = Number(totalSeconds);
		if (!Number.isFinite(s) || s <= 0) return '';
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ' min';
	}

	/* ☆======= Artist context menu =======☆ */

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
				if (artist.imageUrl) setImageAsync(cover, artist.imageUrl, {variant: 'low'});
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

				const follows = window.starlFollows;
				const artistId = artist.name;
				const isFollowing =
					follows && typeof follows.isFollowingArtist === 'function' && follows.isFollowingArtist(artistId);
				action(
					isFollowing ? 'Unfollow artist' : 'Follow artist',
					isFollowing ? 'bsc-icon-remove' : 'bsc-icon-star',
					() => {
						if (follows && typeof follows.toggleFollowArtist === 'function') {
							follows.toggleFollowArtist(artistId, {name: artist.name, imageUrl: artist.imageUrl});
						}
						// re-render artists list via artist-page if available
						if (window.starlArtistPage && typeof window.starlArtistPage._renderArtistsList === 'function') {
							window.starlArtistPage._renderArtistsList();
						}
					},
				);

				if (artist.tracks && artist.tracks.length > 0) {
					sep();
					action(
						'Remove all songs from history',
						'bsc-icon-remove',
						() => {
							const hist = window.starlHistory;
							if (!hist || typeof hist.remove !== 'function') return;
							if (!window.confirm('Remove all songs by ' + artist.name + ' from history?')) return;
							artist.tracks.forEach((t) => hist.remove(t.trackKey || t.sourceUrl || ''));
							if (window.starlArtistPage && typeof window.starlArtistPage._renderArtistsList === 'function') {
								window.starlArtistPage._renderArtistsList();
							}
						},
						true,
					);
				}
			},
		});
	}

	/* ☆======= Artist card =======☆ */

	function createArtistCard(artist) {
		const card = document.createElement('div');
		card.className = 'ap-card artist-card';
		const cover = document.createElement('div');
		cover.className = 'ap-card-cover';
		if (artist.imageUrl) setImageAsync(cover, artist.imageUrl, {variant: 'low'});
		const name = document.createElement('div');
		name.className = 'ap-card-name';
		name.textContent = artist.name;
		const meta = document.createElement('div');
		meta.className = 'ap-card-meta';
		meta.textContent = artist.tracks.length + ' songs';
		card.appendChild(cover);
		card.appendChild(name);
		card.appendChild(meta);
		card.addEventListener('click', () => {
			if (window.starlArtistPage) window.starlArtistPage.openArtist(artist, true);
		});
		card.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			openArtistContextMenu(artist);
		});
		let longPressTimer = null;
		card.addEventListener('pointerdown', () => {
			longPressTimer = setTimeout(() => {
				longPressTimer = null;
				openArtistContextMenu(artist);
			}, 600);
		});
		['pointerup', 'pointercancel', 'pointermove'].forEach((ev) =>
			card.addEventListener(ev, () => {
				if (longPressTimer) {
					clearTimeout(longPressTimer);
					longPressTimer = null;
				}
			}),
		);
		return card;
	}

	/* ☆======= Album card =======☆ */

	function createAlbumCard(album) {
		const card = document.createElement('div');
		card.className = 'ap-card album-card';
		const cover = document.createElement('div');
		cover.className = 'ap-card-cover';
		if (album.imageUrl) setImageAsync(cover, album.imageUrl, {variant: 'low'});
		const name = document.createElement('div');
		name.className = 'ap-card-name';
		name.textContent = album.name;
		const meta = document.createElement('div');
		meta.className = 'ap-card-meta';
		const tracks = album.tracks || [];
		meta.textContent =
			(album.artist ? album.artist + ' • ' : '') +
			(tracks.length ? tracks.length + ' songs' : album.followed ? 'Saved' : '');
		card.appendChild(cover);
		card.appendChild(name);
		card.appendChild(meta);
		card.addEventListener('click', () => {
			if (!window.starlArtistPage) return;
			const fetchId = album.browseId || album.id || null;
			if (fetchId) {
				window.starlArtistPage.openServerAlbum(
					{title: album.name, id: fetchId, thumbnail: album.imageUrl, artist: album.artist},
					true,
				);
			} else if (tracks.length) {
				window.starlArtistPage._pushAlbumDetail(album);
			} else {
				window.starlArtistPage.openServerAlbum(
					{title: album.name, id: null, thumbnail: album.imageUrl, artist: album.artist},
					true,
				);
			}
		});
		return card;
	}

	/* ☆======= Track row =======☆ */

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
		if (track.imageUrl || track.thumbnail)
			setImageAsync(cover, track.imageUrl || track.thumbnail, {variant: 'low'});
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

	/* ☆======= Server album card =======☆ */

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
		if (item.thumbnail) setImageAsync(cover, item.thumbnail, {variant: 'low'});
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
			if (!window.starlArtistPage) return;
			// try local library first
			if (window.starlLibraryNative) {
				const albums = window.starlLibraryNative.getAlbumList();
				const found = albums.find((a) => a.name === item.title);
				if (found && found.tracks && found.tracks.length) {
					window.starlArtistPage._pushAlbumDetail(found);
					return;
				}
			}
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
				window.starlArtistPage._pushAlbumDetail(albumObj);
			} else {
				meta.textContent = (item.year || '') + (item.type ? ' · ' + item.type : '');
				window.starlArtistPage._pushAlbumDetail({
					id: item.id || '',
					name: item.title,
					artist: '',
					imageUrl: item.thumbnail || '',
					tracks: [],
				});
			}
		});
		return card;
	}

	/* ☆======= Public API =======☆ */

	window.starlArtistCards = {
		setImageAsync,
		formatDuration,
		openArtistContextMenu,
		createArtistCard,
		createAlbumCard,
		createTrackRow,
		createServerAlbumCard,
	};
})();

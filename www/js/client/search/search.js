/**
 * ☆=========================================☆
 * Search - global YouTube search tab (core)
 * Handles query dispatch, result rendering, infinite scroll, and prewarm.
 * Recents display lives in search-recents.js (loaded after this).
 *
 * --- What this file does? ---
 * - Debounced search on the search input (fires after 300ms of typing)
 * - Kind filter pills: Music, Artists, Albums
 * - Renders result items: square covers for music/albums, circles for artists
 * - Infinite scroll: loads more results as the user scrolls down
 * - Prewarms the server connection on focus so first results feel fast
 *
 * --- Dictionary / Terms / Extra details ---
 * - "kind" = the type of result the server returns (music, channels, playlists)
 * - "prewarm" = a lightweight ping to wake the server before the user finishes typing
 * - Recents (idle state) are rendered by search-recents.js via window.starlSearchRecents
 * ☆=========================================☆
 */
(function () {
	const searchInput = document.getElementById('search');
	const resultsRoot = document.querySelector('.search-results');
	if (!searchInput || !resultsRoot) return;

	const auth = window.starlAuth;
	if (auth && typeof auth.ensureAuth === 'function') auth.ensureAuth();

	const API_BASE = getApiBase();
	let currentRequest = 0;
	let debounceId = null;
	let prewarmTimerId = null;
	let prewarmRequestId = 0;
	let activeKind = 'music';

	const PAGE_SIZE = 12;
	let allResults = [];
	let shownCount = 0;
	let isLoadingMore = false;
	let currentQuery = '';

	/* ☆======= Helpers =======☆ */

	function getToken() {
		if (window.starlShared && typeof window.starlShared.getAccessToken === 'function')
			return window.starlShared.getAccessToken();
		if (typeof window.getAccessToken === 'function') return window.getAccessToken();
		return localStorage.getItem('starl_access_token');
	}

	function notifyServerFailure() {
		if (window.starlAccountState && typeof window.starlAccountState.notifyServerFailure === 'function') {
			window.starlAccountState.notifyServerFailure();
		}
	}

	function formatDuration(s) {
		const n = Number(s);
		if (!Number.isFinite(n) || n <= 0) return '';
		const h = Math.floor(n / 3600),
			m = Math.floor((n % 3600) / 60),
			sec = Math.floor(n % 60);
		if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
		return m + ':' + String(sec).padStart(2, '0');
	}

	function setThumb(el, url) {
		if (!el || !url) return;
		const cache = window.starlMediaCache;
		// small thumbnails: request low variant to avoid pulling maxres per row (scroll jank)
		if (cache && typeof cache.setImageEl === 'function') {
			cache.setImageEl(el, url, {variant: 'low'});
		} else if (cache && typeof cache.resolveImageUrl === 'function') {
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

	/* ☆======= Click tracking =======☆ */

	let lastSearchQuery = '';

	function recordSearchClick(item) {
		const itemId = item.id || item.url || item.sourceUrl || item.trackKey || '';
		if (!itemId || !lastSearchQuery) return;
		const token = getToken();
		if (!token) return;
		fetch(API_BASE + '/search/click', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
			body: JSON.stringify({query: lastSearchQuery, item_id: itemId, kind: item.kind || null}),
		}).catch(() => {});
	}

	/* ☆======= Pills =======☆ */

	function buildPills(container) {
		const pills = [
			{label: 'Music', kind: 'music', color: '#df38af'},
			{label: 'Artists', kind: 'channels', color: '#01e071'},
			{label: 'Albums', kind: 'playlists', color: '#7c8ef0'},
		];
		const bar = document.createElement('div');
		bar.className = 'sr-pills';
		pills.forEach(({label, kind, color}) => {
			const p = document.createElement('div');
			p.className = 'sr-pill' + (kind === activeKind ? ' active' : '');
			p.textContent = label;
			p.style.setProperty('--pill-color', color);
			p.addEventListener('click', () => {
				activeKind = kind;
				bar.querySelectorAll('.sr-pill').forEach((x) => x.classList.toggle('active', x === p));
				const q = searchInput.value.trim();
				if (q) performSearch(q);
			});
			bar.appendChild(p);
		});
		container.appendChild(bar);
	}

	/* ☆======= Album context menu =======☆ */

	function openAlbumContextMenu(item, imgUrl) {
		const bs = window.starlBottomSheet;
		if (!bs) return;

		bs.open({
			render(body) {
				const header = document.createElement('div');
				header.className = 'bsc-track-header';
				const cover = document.createElement('div');
				cover.className = 'bsc-track-cover';
				cover.style.borderRadius = '8px';
				if (imgUrl) setThumb(cover, imgUrl);
				const info = document.createElement('div');
				info.className = 'bsc-track-info';
				const titleEl = document.createElement('div');
				titleEl.className = 'bsc-track-title';
				titleEl.textContent = item.title || 'Untitled';
				const subEl = document.createElement('div');
				subEl.className = 'bsc-track-sub';
				const parts = [];
				if (item.artist || item.author) parts.push(item.artist || item.author);
				if (item.year) parts.push(item.year);
				subEl.textContent = parts.join(' · ') || 'Album';
				info.appendChild(titleEl);
				info.appendChild(subEl);
				header.appendChild(cover);
				header.appendChild(info);
				body.appendChild(header);

				function action(label, iconClass, handler) {
					const row = document.createElement('div');
					row.className = 'bsc-action';
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

				const albumId = item.id || item.url || item.title || '';
				const follows = window.starlFollows;
				const isSaved =
					follows && typeof follows.isFollowingAlbum === 'function' && follows.isFollowingAlbum(albumId);
				action(
					isSaved ? 'Remove from library' : 'Save to library',
					isSaved ? 'bsc-icon-remove' : 'bsc-icon-star',
					() => {
						if (!follows || typeof follows.toggleFollowAlbum !== 'function') return;
						follows.toggleFollowAlbum(albumId, {
							name: item.title,
							artist: item.artist || item.author || '',
							imageUrl: imgUrl,
							id: albumId,
						});
					},
				);

				sep();

				const artistName = item.artist || item.author || '';
				if (artistName) {
					action('View artist: ' + artistName, 'bsc-icon-artist', () => {
						if (!window.starlArtistPage) return;
						const native = window.starlLibraryNative;
						const artists = native ? native.getArtistList() : [];
						const found = artists.find((a) => a.name.toLowerCase() === artistName.toLowerCase());
						const artistChannelId = item.artistChannelId || '';
						const artistObj = found
							? {...found, channelId: found.channelId || artistChannelId}
							: {name: artistName, imageUrl: '', tracks: [], channelId: artistChannelId};
						window.starlArtistPage.openArtist(artistObj);
					});
				}

				action('Open album', 'bsc-icon-album', () => {
					if (window.starlArtistPage && typeof window.starlArtistPage.openServerAlbum === 'function') {
						window.starlArtistPage.openServerAlbum(item);
					}
				});
			},
		});
	}

	/* ☆======= Result item =======☆ */

	function createResultItem(item, shape) {
		const row = document.createElement('div');
		row.className = 'sr-item';

		const cover = document.createElement('div');
		cover.className = 'sr-cover sr-cover-' + (shape || 'square');
		const imgUrl = item.thumbnail || item.imageUrl || '';
		if (imgUrl) setThumb(cover, imgUrl);

		const info = document.createElement('div');
		info.className = 'sr-info';
		const title = document.createElement('div');
		title.className = 'sr-title';
		title.textContent = item.title || 'Untitled';
		const sub = document.createElement('div');
		sub.className = 'sr-sub';
		sub.textContent = item.artist || item.author || '';
		info.appendChild(title);
		info.appendChild(sub);

		const actions = document.createElement('div');
		actions.className = 'sr-actions';

		if (shape !== 'circle' && item.duration) {
			const dur = document.createElement('div');
			dur.className = 'sr-duration';
			dur.textContent = formatDuration(item.duration);
			actions.appendChild(dur);
		}

		row.appendChild(cover);
		row.appendChild(info);
		row.appendChild(actions);

		row.addEventListener('click', () => {
			recordSearchClick(item);
			if (shape === 'circle') {
				if (window.starlArtistPage) {
					const artist = {name: item.title || '', imageUrl: imgUrl, tracks: [], channelId: item.id || ''};
					window.starlArtistPage.openArtist(artist);
				}
				return;
			}
			if (item.kind === 'playlist' || item.kind === 'album') {
				if (window.starlArtistPage && typeof window.starlArtistPage.openServerAlbum === 'function') {
					window.starlArtistPage.openServerAlbum(item);
				}
				return;
			}
			if (window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
				window.starlPlayer.playFromSearch({
					trackKey: item.trackKey || item.url || '',
					url: item.url || item.sourceUrl || '',
					sourceUrl: item.url || item.sourceUrl || '',
					streamUrl: item.streamUrl || '',
					title: item.title,
					artist: item.artist,
					album: item.album || '',
					thumbnail: imgUrl,
					imageUrl: imgUrl,
					duration: item.duration || 0,
				});
			}
		});

		if (shape === 'circle') {
			// artist: no context menu
		} else if (item.kind === 'playlist' || item.kind === 'album') {
			const more = document.createElement('div');
			more.className = 'sr-more-btn';
			more.addEventListener('click', (e) => {
				e.stopPropagation();
				openAlbumContextMenu(item, imgUrl);
			});
			actions.appendChild(more);
		} else if (window.starlTrackContextMenu) {
			const more = document.createElement('div');
			more.className = 'sr-more-btn';
			window.starlTrackContextMenu.bindTarget(
				more,
				() => ({
					trackKey: item.trackKey || item.url || '',
					url: item.url || item.sourceUrl || '',
					sourceUrl: item.url || item.sourceUrl || '',
					streamUrl: item.streamUrl || '',
					title: item.title,
					artist: item.artist,
					album: item.album || '',
					imageUrl: imgUrl,
					duration: item.duration || 0,
				}),
				{directClick: true, source: 'search'},
			);
			actions.appendChild(more);
		}

		return row;
	}

	/* ☆======= Search =======☆ */

	function appendResults(items) {
		if (!items.length) return;
		items.forEach((item, i) => {
			const shape = item.kind === 'channel' || item.kind === 'artist' ? 'circle' : 'square';
			const row = createResultItem(item, shape);
			row.style.animationDelay = i * 35 + 'ms';
			resultsRoot.appendChild(row);
		});
		schedulePrewarm(items);
	}

	async function performSearch(query) {
		lastSearchQuery = query;
		currentQuery = query;
		allResults = [];
		shownCount = 0;

		const requestId = ++currentRequest;
		resultsRoot.innerHTML = '';
		buildPills(resultsRoot);
		const msg = document.createElement('div');
		msg.className = 'sr-message';
		msg.textContent = 'Searching...';
		resultsRoot.appendChild(msg);

		const token = getToken();
		if (!token) {
			msg.textContent = 'Login required.';
			return;
		}
		try {
			const res = await fetch(API_BASE + '/search', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
				body: JSON.stringify({query, limit: 20, kind: activeKind}),
			});
			if (auth && typeof auth.handleAuthFailure === 'function' && auth.handleAuthFailure(res)) return;
			const data = await res.json();
			if (requestId !== currentRequest) return;
			if (!res.ok) {
				notifyServerFailure();
				msg.textContent = (data && data.detail) || 'Search failed.';
				return;
			}
			msg.remove();
			allResults = Array.isArray(data.items) ? data.items : [];
			if (!allResults.length) {
				const noMsg = document.createElement('div');
				noMsg.className = 'sr-message';
				noMsg.textContent = 'No results.';
				resultsRoot.appendChild(noMsg);
				return;
			}
			showNextPage();
		} catch (error) {
			notifyServerFailure();
			if (requestId === currentRequest) {
				resultsRoot.innerHTML = '';
				buildPills(resultsRoot);
				const errMsg = document.createElement('div');
				errMsg.className = 'sr-message';
				errMsg.textContent = 'Network error.';
				resultsRoot.appendChild(errMsg);
			}
		}
	}

	function showNextPage() {
		if (isLoadingMore) return;
		const page = allResults.slice(shownCount, shownCount + PAGE_SIZE);
		if (!page.length) return;
		isLoadingMore = true;
		appendResults(page);
		shownCount += page.length;
		isLoadingMore = false;
	}

	function loadMoreResults() {
		if (isLoadingMore || shownCount >= allResults.length || !currentQuery) return;
		showNextPage();
	}

	function schedulePrewarm(items) {
		if (prewarmTimerId) clearTimeout(prewarmTimerId);
		const token = getToken();
		if (!token || !navigator.onLine) return;
		const candidates = (Array.isArray(items) ? items : [])
			.filter((item) => item && (item.url || item.sourceUrl || item.streamUrl))
			.slice(0, 4);
		if (!candidates.length) return;
		const reqId = ++prewarmRequestId;
		prewarmTimerId = setTimeout(() => {
			const t = getToken();
			if (!t || reqId !== prewarmRequestId) return;
			candidates.forEach((item) => {
				const src = String(item.url || item.sourceUrl || item.streamUrl || '').trim();
				if (!src) return;
				fetch(API_BASE + '/prewarm', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t},
					body: JSON.stringify({url: src, quality: 'high'}),
				}).catch(() => {});
			});
		}, 2000);
	}

	/* ☆======= Event listeners =======☆ */

	function renderRecents() {
		// delegate to search-recents.js
		if (window.starlSearchRecents && typeof window.starlSearchRecents.render === 'function') {
			window.starlSearchRecents.render(resultsRoot, buildPills, createResultItem);
		}
	}

	searchInput.placeholder = 'What vibe are you looking for?';

	searchInput.addEventListener('input', () => {
		const q = searchInput.value.trim();
		clearTimeout(debounceId);
		if (!q) {
			currentQuery = '';
			allResults = [];
			shownCount = 0;
			renderRecents();
			return;
		}
		debounceId = setTimeout(() => performSearch(q), 300);
	});

	searchInput.addEventListener('focus', () => {
		if (!searchInput.value.trim()) renderRecents();
	});

	// infinite scroll: load more when near the bottom of the search results container
	resultsRoot.addEventListener('scroll', () => {
		if (!currentQuery) return;
		const {scrollTop, scrollHeight, clientHeight} = resultsRoot;
		if (scrollHeight - scrollTop - clientHeight < 200) {
			loadMoreResults();
		}
	});

	// initial state: show recents
	renderRecents();

	window.addEventListener('starl-history-updated', () => {
		if (!searchInput.value.trim()) renderRecents();
	});
})();

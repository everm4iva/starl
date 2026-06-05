/*
Search tab
-> global YouTube search with debounce, kind filter pills, and prewarm.
-> shows recents from history when idle (no query entered).
-> result items: square covers for music/albums, circular for artists.
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

	// ----- Helpers -----

	function getToken() {
		if (window.starlShared && typeof window.starlShared.getAccessToken === 'function') return window.starlShared.getAccessToken();
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
		const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = Math.floor(n % 60);
		if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
		return m + ':' + String(sec).padStart(2, '0');
	}

	function setThumb(el, url) {
		if (!el || !url) return;
		const cache = window.starlMediaCache;
		if (cache && typeof cache.setImageEl === 'function') {
			cache.setImageEl(el, url);
		} else if (cache && typeof cache.resolveImageUrl === 'function') {
			cache.resolveImageUrl(url).then((resolved) => {
				if (resolved) el.style.backgroundImage = 'url("' + resolved.replace(/"/g, '%22') + '")';
			}).catch(() => {});
		} else {
			el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
		}
	}

	// ----- Click tracking -----

	let lastSearchQuery = '';

	function recordSearchClick(item) {
		const itemId = item.id || item.url || item.sourceUrl || item.trackKey || '';
		if (!itemId || !lastSearchQuery) return;
		const token = getToken();
		if (!token) return;
		fetch(API_BASE + '/search/click', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
			body: JSON.stringify({ query: lastSearchQuery, item_id: itemId, kind: item.kind || null }),
		}).catch(() => {});
	}

	// ----- Pills -----

	function buildPills(container) {
		const pills = [
			{ label: 'Music', kind: 'music', color: '#df38af' },
			{ label: 'Artists', kind: 'channels', color: '#01e071' },
			{ label: 'Albums', kind: 'playlists', color: '#7c8ef0' },
		];
		const bar = document.createElement('div');
		bar.className = 'sr-pills';
		pills.forEach(({ label, kind, color }) => {
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

	// ----- Album context menu -----

	function openAlbumContextMenu(item, imgUrl) {
		const bs = window.starlBottomSheet;
		if (!bs) return;

		bs.open({
			render(body) {
				// Header
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
					row.addEventListener('click', () => { bs.close(); setTimeout(handler, 50); });
					body.appendChild(row);
				}

				function sep() {
					const d = document.createElement('div');
					d.className = 'bsc-separator';
					body.appendChild(d);
				}

				// Save / unsave album
				const albumId = item.id || item.url || item.title || '';
				const follows = window.starlFollows;
				const isSaved = follows && typeof follows.isFollowingAlbum === 'function' && follows.isFollowingAlbum(albumId);
				action(
					isSaved ? 'Remove from library' : 'Save to library',
					isSaved ? 'bsc-icon-remove' : 'bsc-icon-star',
					() => {
						if (!follows || typeof follows.toggleFollowAlbum !== 'function') return;
						follows.toggleFollowAlbum(albumId, {name: item.title, artist: item.artist || item.author || '', imageUrl: imgUrl, id: albumId});
					}
				);

				sep();

				// View artist
				const artistName = item.artist || item.author || '';
				if (artistName) {
					action('View artist: ' + artistName, 'bsc-icon-artist', () => {
						if (!window.starlArtistPage) return;
						const native = window.starlLibraryNative;
						const artists = native ? native.getArtistList() : [];
						const found = artists.find((a) => a.name.toLowerCase() === artistName.toLowerCase());
						window.starlArtistPage.openArtist(found || {name: artistName, imageUrl: '', tracks: []});
					});
				}

				// Open album
				action('Open album', 'bsc-icon-album', () => {
					if (window.starlArtistPage && typeof window.starlArtistPage.openServerAlbum === 'function') {
						window.starlArtistPage.openServerAlbum(item);
					}
				});
			},
		});
	}

	// ----- Result item -----

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

		if (shape !== 'circle') {
			// Star button for music/albums
			const trackKey = item.trackKey || item.url || item.sourceUrl || '';
			const isFav = Boolean(window.starlFavorites && typeof window.starlFavorites.isFavorited === 'function' && window.starlFavorites.isFavorited(trackKey));
			const star = document.createElement('div');
			star.className = 'sr-action-btn sr-star' + (isFav ? ' active' : '');
			star.addEventListener('click', (e) => {
				e.stopPropagation();
				if (!trackKey || !window.starlFavorites) return;
				window.starlFavorites.toggleFavorite(trackKey, { title: item.title, artist: item.artist, imageUrl: imgUrl });
				star.classList.toggle('active');
			});
			actions.appendChild(star);

			// Duration chip
			if (item.duration) {
				const dur = document.createElement('div');
				dur.className = 'sr-duration';
				dur.textContent = formatDuration(item.duration);
				actions.appendChild(dur);
			}
		}

		row.appendChild(cover);
		row.appendChild(info);
		row.appendChild(actions);

		// Play / open on click
		row.addEventListener('click', () => {
			recordSearchClick(item);
			if (shape === 'circle') {
				// Artist → open artist page overlay (no tab switch needed, overlay goes on top)
				if (window.starlArtistPage) {
					const artist = { name: item.title || '', imageUrl: imgUrl, tracks: [] };
					window.starlArtistPage.openArtist(artist);
				}
				return;
			}
			if (item.kind === 'playlist' || item.kind === 'album') {
				// Album → open album detail in artist-page overlay
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

		// 3-dots context menu
		if (shape === 'circle') {
			// Artist: no context menu
		} else if (item.kind === 'playlist' || item.kind === 'album') {
			// Album: open album-specific bottom sheet
			const more = document.createElement('div');
			more.className = 'sr-more-btn';
			more.addEventListener('click', (e) => {
				e.stopPropagation();
				openAlbumContextMenu(item, imgUrl);
			});
			actions.appendChild(more);
		} else if (window.starlTrackContextMenu) {
			// Music track
			const more = document.createElement('div');
			more.className = 'sr-more-btn';
			window.starlTrackContextMenu.bindTarget(more, () => ({
				trackKey: item.trackKey || item.url || '',
				url: item.url || item.sourceUrl || '',
				sourceUrl: item.url || item.sourceUrl || '',
				streamUrl: item.streamUrl || '',
				title: item.title,
				artist: item.artist,
				album: item.album || '',
				imageUrl: imgUrl,
				duration: item.duration || 0,
			}), { directClick: true, source: 'search' });
			actions.appendChild(more);
		}

		return row;
	}

	// ----- Recents -----

	function renderRecents() {
		resultsRoot.innerHTML = '';
		buildPills(resultsRoot);
		const history = window.starlHistory ? window.starlHistory.getAll().slice(0, 12) : [];
		if (!history.length) {
			const msg = document.createElement('div');
			msg.className = 'sr-message';
			msg.textContent = 'Start searching to discover music.';
			resultsRoot.appendChild(msg);
			return;
		}
		const heading = document.createElement('div');
		heading.className = 'sr-heading';
		heading.textContent = 'Recents';
		resultsRoot.appendChild(heading);
		history.forEach((track, i) => {
			const item = { ...track, thumbnail: track.imageUrl || '', url: track.sourceUrl || track.streamUrl || '' };
			const isArtist = track.kind === 'channel' || track.kind === 'artist';
			const row = createResultItem(item, isArtist ? 'circle' : 'square');
			row.style.animationDelay = (i * 25) + 'ms';
			// Add remove-from-recents button for history items
			const removeBtn = document.createElement('div');
			removeBtn.className = 'sr-remove-btn';
			removeBtn.title = 'Remove from recents';
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (window.starlHistory && typeof window.starlHistory.remove === 'function') {
					window.starlHistory.remove(track.trackKey || track.sourceUrl || track.streamUrl || '');
				}
				row.style.transition = 'opacity 200ms ease, transform 200ms ease';
				row.style.opacity = '0';
				row.style.transform = 'translateX(20px)';
				setTimeout(() => row.remove(), 200);
			});
			row.querySelector('.sr-actions').appendChild(removeBtn);
			resultsRoot.appendChild(row);
		});
	}

	// ----- Search -----

	function renderResults(items) {
		resultsRoot.innerHTML = '';
		buildPills(resultsRoot);
		if (!items.length) {
			const msg = document.createElement('div');
			msg.className = 'sr-message';
			msg.textContent = 'No results.';
			resultsRoot.appendChild(msg);
			return;
		}
		items.forEach((item, i) => {
			const shape = item.kind === 'channel' || item.kind === 'artist' ? 'circle' : 'square';
			const row = createResultItem(item, shape);
			row.style.animationDelay = (i * 35) + 'ms';
			resultsRoot.appendChild(row);
		});
		schedulePrewarm(items);
	}

	async function performSearch(query) {
		lastSearchQuery = query;
		const requestId = ++currentRequest;
		resultsRoot.innerHTML = '';
		buildPills(resultsRoot);
		const msg = document.createElement('div');
		msg.className = 'sr-message';
		msg.textContent = 'Searching...';
		resultsRoot.appendChild(msg);

		const token = getToken();
		if (!token) { msg.textContent = 'Login required.'; return; }
		try {
			const res = await fetch(API_BASE + '/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
				body: JSON.stringify({ query, limit: 12, kind: activeKind }),
			});
			if (auth && typeof auth.handleAuthFailure === 'function' && auth.handleAuthFailure(res)) return;
			const data = await res.json();
			if (requestId !== currentRequest) return;
			if (!res.ok) { notifyServerFailure(); msg.textContent = (data && data.detail) || 'Search failed.'; return; }
			renderResults(Array.isArray(data.items) ? data.items : []);
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
					headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
					body: JSON.stringify({ url: src, quality: 'high' }),
				}).catch(() => {});
			});
		}, 2000);
	}

	// ----- Event listeners -----

	searchInput.placeholder = 'What vibe are you looking for?';

	searchInput.addEventListener('input', () => {
		const q = searchInput.value.trim();
		clearTimeout(debounceId);
		if (!q) { renderRecents(); return; }
		debounceId = setTimeout(() => performSearch(q), 300);
	});

	searchInput.addEventListener('focus', () => {
		if (!searchInput.value.trim()) renderRecents();
	});

	// Initial state: show recents
	renderRecents();

	// Refresh recents when history changes
	window.addEventListener('starl-history-updated', () => {
		if (!searchInput.value.trim()) renderRecents();
	});
})();

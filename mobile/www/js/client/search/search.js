/**
 * ☆=========================================☆
 * Search - global YouTube search tab (core)
 * Handles query dispatch, result rendering, infinite scroll, and prewarm.
 * Recents display lives in search-recents.js (loaded after this)
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
	const FETCH_LIMIT = 32;
	let allResults = [];
	let shownCount = 0;
	let isLoadingMore = false;
	let currentQuery = '';
	let serverHasMore = false;

	let searchSeq = 0;
	let currentSeq = 0;
	let activeAbortController = null;

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
		// small thumbnails: request low variant to avoid pulling maxres per row (scroll jank shit)
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
	// set when first results appear; clicks within MISCLICK_THRESHOLD_MS are ignored as misclicks (obv)
	let resultsReadyAt = 0;
	let recentItemsThisSearch = 0;
	const MISCLICK_THRESHOLD_MS = 500;
	const MAX_ITEMS_PER_SEARCH = 5;

	function recordSearchClick(item, shape) {
		const itemId = item.id || item.url || item.sourceUrl || item.trackKey || '';
		if (!itemId || !lastSearchQuery) return;
		const token = getToken();
		if (token) {
			fetch(API_BASE + '/search/click', {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
				body: JSON.stringify({query: lastSearchQuery, item_id: itemId, kind: item.kind || null}),
			}).catch(() => {});
		}
		const recents = window.starlSearchRecents;
		if (
			recents &&
			typeof recents.addItem === 'function' &&
			recentItemsThisSearch < MAX_ITEMS_PER_SEARCH &&
			Date.now() - resultsReadyAt >= MISCLICK_THRESHOLD_MS
		) {
			recents.addItem(item, shape || 'square');
			recentItemsThisSearch++;
		}
	}

	/* ☆======= Pills (not actuall pills lol) =======☆ */

	function buildPills(container) {
		const pills = [
			{label: 'Music', kind: 'music', color: 'var(--user-accentcolor-music)'},
			{label: 'Artists', kind: 'channels', color: 'var(--user-accentcolor-artists)'},
			{label: 'Albums', kind: 'playlists', color: 'var(--user-accentcolor-albums)'},
			{label: 'Playlists', kind: 'community', color: 'var(--ipl-accent, #e8c34a)'},
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

	/* ☆======= Community playlist context menu =======☆ */

	// real public YT/YTMusic playlists (the "Playlists" pill). Lets the user either
	// listen to the whole thing as a queue (no import) or import it into the library
	function openCommunityPlaylistMenu(item, imgUrl) {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		const ref = (item && (item.id || item.url)) || '';

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
				titleEl.textContent = item.title || 'Playlist';
				const subEl = document.createElement('div');
				subEl.className = 'bsc-track-sub';
				subEl.textContent = item.artist || item.author || 'Playlist';
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

				action('Start queue', 'ipl-icon-play', () => startPlaylistQueue(ref, item.title));

				const d = document.createElement('div');
				d.className = 'bsc-separator';
				body.appendChild(d);

				action('Import as playlist', 'ipl-icon-import', () => {
					if (
						window.starlImportPlaylist &&
						typeof window.starlImportPlaylist.openPreviewFromItem === 'function'
					) {
						window.starlImportPlaylist.openPreviewFromItem(item);
					}
				});
			},
		});
	}

	// resolve a community playlist to its tracks and play it as a fresh queue, no import
	function startPlaylistQueue(ref, title) {
		const ip = window.starlImportPlaylist;
		if (!ip || typeof ip.resolve !== 'function' || !ref) return;
		const toast = (m) => window.starlLayout && window.starlLayout.showToast && window.starlLayout.showToast(m);
		toast('Loading playlist…');
		ip.resolve(ref)
			.then((data) => {
				const tracks = (data && data.tracks) || [];
				if (!tracks.length) {
					toast('Playlist is empty');
					return;
				}
				if (window.starlPlayer && typeof window.starlPlayer.playWithQueue === 'function') {
					window.starlPlayer.playWithQueue(tracks, 0, {type: 'search-playlist', title: title || data.title});
				}
			})
			.catch((err) => toast((err && err.message) || 'Could not start playlist'));
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

		// prewarm artist page data immediately when the row appears - so opening the
		// artist overlay is instant instead of waiting on a server fetch
		if (shape === 'circle' && item.id) {
			const ap = window.starlArtistPage;
			if (ap && typeof ap.prewarmArtist === 'function' && navigator.onLine) {
				ap.prewarmArtist(item.title || '', item.id).catch(() => {});
			}
		}

		row.addEventListener('click', () => {
			recordSearchClick(item, shape);
			if (shape === 'circle') {
				if (window.starlArtistPage) {
					const artist = {name: item.title || '', imageUrl: imgUrl, tracks: [], channelId: item.id || ''};
					window.starlArtistPage.openArtist(artist);
				}
				return;
			}
			if (item.kind === 'community_playlist') {
				openCommunityPlaylistMenu(item, imgUrl);
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
		} else if (item.kind === 'community_playlist') {
			const more = document.createElement('div');
			more.className = 'sr-more-btn ipl-import-btn';
			more.addEventListener('click', (e) => {
				e.stopPropagation();
				openCommunityPlaylistMenu(item, imgUrl);
			});
			actions.appendChild(more);
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
		if (!resultsReadyAt) resultsReadyAt = Date.now();
		items.forEach((item, i) => {
			const shape = item.kind === 'channel' || item.kind === 'artist' ? 'circle' : 'square';
			const row = createResultItem(item, shape);
			row.style.animationDelay = i * 35 + 'ms';
			resultsRoot.appendChild(row);
		});
		schedulePrewarm(items);
	}

	async function fetchSearchPage(query, offset, seq) {
		const token = getToken();
		if (!token) return null;
		const res = await fetch(API_BASE + '/search', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
			body: JSON.stringify({query, limit: FETCH_LIMIT, offset, kind: activeKind, seq}),
			signal: activeAbortController ? activeAbortController.signal : undefined,
		});
		if (auth && typeof auth.handleAuthFailure === 'function' && auth.handleAuthFailure(res)) return null;
		if (!res.ok) return null;
		return await res.json();
	}

	// a pasted YouTube watch / youtu.be / live link is a single track, not a search query -
	// ytmusic search can't return it (live streams never show up at all). detect it so client can
	// render it as one playable result instead of running a doomed text search.. because that obviously happened before lol
	function classifyTrackUrl(raw) {
		const s = String(raw || '').trim();
		if (!/^https?:\/\//i.test(s)) return null;
		if (!/(youtube\.com|youtu\.be|music\.youtube\.com)/i.test(s)) return null;
		// playlists, channels, artist/results pages aren't single tracks
		if (/[?&]list=/i.test(s)) return null;
		if (/\/(channel|c|user|playlist|browse|results|feed)\b|\/@/i.test(s)) return null;
		// must look like a watch / short / live link (covers normal videos AND live streams;
		// /live/<id> is YouTube's share form for a live broadcast)
		return /\/watch\?|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/|[?&]v=/i.test(s) ? s : null;
	}

	// best-effort title/artist/thumb via the public no-auth oEmbed endpoint (same source
	// share-intent.js uses), so the pasted-link card shows a real name, not a placeholder
	function fetchTrackOembed(url) {
		return fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url))
			.then((r) => (r.ok ? r.json() : null))
			.then((d) =>
				d ? {title: d.title || '', artist: d.author_name || '', imageUrl: d.thumbnail_url || ''} : null,
			)
			.catch(() => null);
	}

	// render a single pasted track/live URL as one result row. Tapping it goes through the
	// normal playFromSearch -> /download path, which detects is_live and routes to /live
	function renderUrlResult(url) {
		const buildItem = (meta) => ({
			kind: 'song',
			trackKey: url,
			url: url,
			sourceUrl: url,
			title: (meta && meta.title) || 'Play this link',
			artist: (meta && meta.artist) || 'Tap to play',
			thumbnail: (meta && meta.imageUrl) || '',
			imageUrl: (meta && meta.imageUrl) || '',
			duration: 0,
		});

		const render = (item) => {
			resultsRoot.innerHTML = '';
			buildPills(resultsRoot);
			allResults = [item];
			serverHasMore = false;
			appendResults([item]);
			shownCount = 1;
		};

		render(buildItem(null));
		fetchTrackOembed(url).then((meta) => {
			if (!meta || currentQuery !== url) return; // user moved on to another search
			render(buildItem(meta));
		});
	}

	async function performSearch(query) {
		lastSearchQuery = query;
		currentQuery = query;
		resultsReadyAt = 0;
		recentItemsThisSearch = 0;
		allResults = [];
		shownCount = 0;
		serverHasMore = false;

		// ccancel the previous in-flight search (if any) - its server-side work
		// keeps running and still populates the cache, just deprioritized
		if (activeAbortController) activeAbortController.abort();
		activeAbortController = new AbortController();
		currentSeq = ++searchSeq;

		const requestId = ++currentRequest;
		resultsRoot.innerHTML = '';
		buildPills(resultsRoot);
		const msg = document.createElement('div');
		msg.className = 'sr-message';
		msg.textContent = 'Searching...';
		resultsRoot.appendChild(msg);

		// a pasted track/live link isn't a search - render it as one playable result
		const directUrl = classifyTrackUrl(query);
		if (directUrl) {
			renderUrlResult(directUrl);
			return;
		}

		const token = getToken();
		if (!token) {
			msg.textContent = 'Login required.';
			return;
		}
		try {
			const data = await fetchSearchPage(query, 0, currentSeq);
			if (requestId !== currentRequest) return;
			if (!data) {
				notifyServerFailure();
				msg.textContent = 'Search failed.';
				return;
			}
			msg.remove();
			allResults = Array.isArray(data.items) ? data.items : [];
			serverHasMore = !!data.has_more;
			if (!allResults.length) {
				const noMsg = document.createElement('div');
				noMsg.className = 'sr-message';
				noMsg.textContent = 'No results.';
				resultsRoot.appendChild(noMsg);
				return;
			}
			showNextPage();
		} catch (error) {
			// abortError means a newer search superseded this one - not a failure
			if (error && error.name === 'AbortError') return;
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

	async function loadMoreResults() {
		if (isLoadingMore || !currentQuery) return;

		// if client still has to locally buffer results, show the next page immediately
		if (shownCount < allResults.length) {
			showNextPage();
			return;
		}

		// local buffer exhausted - ask the server for the next batch
		if (!serverHasMore) return;

		isLoadingMore = true;
		const requestId = currentRequest;
		try {
			const data = await fetchSearchPage(currentQuery, allResults.length, currentSeq);
			if (requestId !== currentRequest) {
				isLoadingMore = false;
				return;
			}
			if (data && Array.isArray(data.items) && data.items.length) {
				serverHasMore = !!data.has_more;
				allResults = allResults.concat(data.items);
				isLoadingMore = false;
				showNextPage();
			} else {
				serverHasMore = false;
				isLoadingMore = false;
			}
		} catch (_) {
			isLoadingMore = false;
		}
	}

	function schedulePrewarm(items) {
		if (prewarmTimerId) clearTimeout(prewarmTimerId);
		const token = getToken();
		if (!token || !navigator.onLine) return;
		// channel/artist/playlist/search pages aren't playable tracks - the resolver
		// returns "no direct URL" for them, so don't waste a prewarm (or spam the worker)
		const NON_TRACK_KINDS = {community_playlist: 1, channel: 1, artist: 1, playlist: 1, album: 1};
		const isNonTrackUrl = (u) =>
			/youtube\.com|music\.youtube\.com/i.test(u) &&
			/\/(channel|c|user|playlist|browse|results|feed)\b|\/@/i.test(u);
		const candidates = (Array.isArray(items) ? items : [])
			.filter((item) => {
				if (!item || NON_TRACK_KINDS[item.kind]) return false;
				const src = item.url || item.sourceUrl || item.streamUrl;
				return src && !isNonTrackUrl(src);
			})
			.slice(0, 6);
		if (!candidates.length) return;
		const reqId = ++prewarmRequestId;

		// top result: prewarm immediately - it's most likely to be played next
		const topSrc = String(candidates[0].url || candidates[0].sourceUrl || candidates[0].streamUrl || '').trim();
		if (topSrc) {
			const t = getToken();
			if (t) {
				fetch(API_BASE + '/prewarm', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t},
					body: JSON.stringify({url: topSrc, quality: 'high'}),
				}).catch(() => {});
			}
		}

		// remaining results: batch prewarm after a short delay so they're ready if user scrolls
		if (candidates.length > 1) {
			prewarmTimerId = setTimeout(() => {
				const t = getToken();
				if (!t || reqId !== prewarmRequestId) return;
				const urls = candidates
					.slice(1)
					.map((item) => String(item.url || item.sourceUrl || item.streamUrl || '').trim())
					.filter(Boolean);
				if (!urls.length) return;
				fetch(API_BASE + '/prewarm/batch', {
					method: 'POST',
					headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + t},
					body: JSON.stringify({urls, quality: 'high'}),
				}).catch(() => {});
			}, 500);
		}
	}

	/* ☆======= Event listeners =======☆ */

	function renderRecents() {
		// report to search-recents.js
		if (window.starlSearchRecents && typeof window.starlSearchRecents.render === 'function') {
			window.starlSearchRecents.render(
				resultsRoot,
				buildPills,
				createResultItem,
				(q) => {
					searchInput.value = q;
					performSearch(q);
				},
				(item, shape) => {
					// replay the same click action as in live search results
					if (shape === 'circle') {
						if (window.starlArtistPage) {
							window.starlArtistPage.openArtist({
								name: item.title || '',
								imageUrl: item.imageUrl || item.thumbnail || '',
								tracks: [],
								channelId: item.id || '',
							});
						}
						return;
					}
					if (item.kind === 'community_playlist') {
						openCommunityPlaylistMenu(item, item.imageUrl || item.thumbnail || '');
						return;
					}
					if (item.kind === 'playlist' || item.kind === 'album') {
						if (window.starlArtistPage && typeof window.starlArtistPage.openServerAlbum === 'function') {
							window.starlArtistPage.openServerAlbum(item);
						}
						return;
					}
					if (window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
						window.starlPlayer.playFromSearch(item);
					}
				},
			);
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
})();

/**
 * ☆=========================================☆
 * Media cache - offline audio and image storage (IndexedDB)
 * Stores downloaded songs and artwork in IndexedDB so the app keeps working
 * without a connection. Returns blob URLs for cached tracks/images.
 *
 * --- What this file does? ---
 * - cacheTrack(entry) / getTrackUrl(key): store and retrieve cached audio
 * - cacheImage(url) / getImageUrl(url) / resolveImageUrl(url): image cache
 * - setProgressiveImage(): loads a cached version immediately, upgrades to full later
 * - setUserProfile() / getUserProfile(): caches the logged-in user's avatar/name
 * - clearCache(): wipes all tracks and images from IndexedDB
 * - getCacheStats(): returns counts and byte sizes of cached items
 *
 * --- Dictionary / Terms / Extra details ---
 * - "blob URL" = a temporary browser URL pointing to in-memory binary data
 * - "trackKey" = the unique key used to look up a cached track (usually source URL)
 * - Images are stored at 'low' or 'full' resolution; resolveImageUrl picks the best
 * ☆=========================================☆
 */

(function () {
	const DB_NAME = 'starl-media-cache';
	const DB_VERSION = 2;
	const TRACK_STORE = 'tracks';
	const IMAGE_STORE = 'images';
	const KV_STORE = 'kv';

	const objectUrlByKey = new Map();
	const imageRecordByKey = new Map();
	const progressiveImageTokens = new Map();
	let dbPromise = null;

	// when a kind is paused, new items of that kind aren't written to the cache
	// (existing ones stay, and playback/rendering still streams live). the storage
	// manager flips these from the "Don't cache anymore" overflow action.
	const cachePaused = {audio: false, image: false};

	function setCachePaused(next) {
		if (!next || typeof next !== 'object') return;
		if ('audio' in next) cachePaused.audio = Boolean(next.audio);
		if ('image' in next) cachePaused.image = Boolean(next.image);
	}

	function openDatabase() {
		if (!('indexedDB' in window)) {
			return Promise.resolve(null);
		}
		if (dbPromise) {
			return dbPromise;
		}

		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(TRACK_STORE)) {
					db.createObjectStore(TRACK_STORE, {keyPath: 'trackKey'});
				}
				if (!db.objectStoreNames.contains(IMAGE_STORE)) {
					db.createObjectStore(IMAGE_STORE, {keyPath: 'imageKey'});
				}
				if (!db.objectStoreNames.contains(KV_STORE)) {
					db.createObjectStore(KV_STORE, {keyPath: 'key'});
				}
			};

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
		});

		return dbPromise;
	}

	async function withStore(storeName, mode, handler) {
		const db = await openDatabase();
		if (!db) {
			return null;
		}
		return new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, mode);
			const store = tx.objectStore(storeName);
			let result;
			try {
				result = handler(store, tx);
			} catch (error) {
				reject(error);
				return;
			}
			tx.oncomplete = () => resolve(result);
			tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
			tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
		});
	}

	function requestToPromise(request) {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
		});
	}

	function normalizeTrackKey(value) {
		return String(value || '').trim();
	}

	function normalizeUrl(value) {
		return String(value || '').trim();
	}

	function normalizeImageVariant(value) {
		return String(value || 'high').toLowerCase() === 'low' ? 'low' : 'high';
	}

	function normalizeImageKey(value) {
		if (value === 'user_profile_picture') {
			return value;
		}
		const raw = normalizeUrl(value);
		if (!raw) {
			return '';
		}
		if (/^(blob:|data:|file:)/i.test(raw)) {
			return raw;
		}
		// already a canonical store key (produced below) - keep it stable so callers
		// that pass a listImages() key back in (removeImage/getImageRecord) hit the
		// same record instead of re-parsing 'image-id:...' as a URL scheme.
		if (raw.startsWith('image-id:')) {
			return raw;
		}

		const apiBase = getApiBase();
		const absolute = raw.startsWith('/') ? apiBase + raw : raw;

		try {
			const parsed = new URL(absolute, apiBase + '/');
			const pathname = String(parsed.pathname || '');

			if (pathname === '/cache/image') {
				const nested = parsed.searchParams.get('url');
				if (nested) {
					return normalizeImageKey(nested);
				}
			}

			if (pathname.startsWith('/imgres/')) {
				const imageId = pathname.slice('/imgres/'.length).split('/')[0];
				if (imageId) {
					return 'image-id:' + decodeURIComponent(imageId);
				}
			}

			if (pathname.startsWith('/image/')) {
				const imageId = pathname.slice('/image/'.length).split('/')[0];
				if (imageId) {
					return 'image-id:' + decodeURIComponent(imageId);
				}
			}

			if (/ytimg\.com/i.test(parsed.hostname)) {
				const normalizedPath = pathname.replace(
					/(\/(?:maxres|sd|hq|mq|default)default(\.(?:jpg|webp)))/i,
					'/maxresdefault$2',
				);
				return parsed.origin + normalizedPath;
			}

			if (/googleusercontent\.com/i.test(parsed.hostname)) {
				const normalized = absolute
					.replace(/=w\d+-h\d+/i, '=w1000-h1000')
					.replace(/-w\d+-h\d+-/i, '-w1000-h1000-');
				return normalized;
			}

			return parsed.origin + pathname;
		} catch (error) {
			return raw;
		}
	}

	function getImageVariantUrl(imageUrl, variant = 'high') {
		const rawUrl = normalizeUrl(imageUrl);
		if (!rawUrl) {
			return '';
		}
		const normalizedVariant = normalizeImageVariant(variant);
		const apiBase = getApiBase();

		// unwrap already proxied URLs
		let unwrapped = rawUrl.startsWith('/image/') ? apiBase + rawUrl : rawUrl;
		for (let i = 0; i < 3; i++) {
			try {
				const p = new URL(unwrapped, apiBase + '/');
				if (p.pathname === '/cache/image' || p.pathname === '/imgres/') {
					const inner = p.searchParams.get('url');
					if (inner) {
						// strip any res/token params that got baked into the inner URL
						try {
							const innerParsed = new URL(decodeURIComponent(inner));
							innerParsed.searchParams.delete('res');
							innerParsed.searchParams.delete('token');
							unwrapped = innerParsed.toString();
						} catch (_) {
							unwrapped = decodeURIComponent(inner);
						}
						continue;
					}
				}
			} catch (_) {}
			break;
		}
		const normalizedUrl = unwrapped;
		const token = getAccessToken();

		if (normalizedUrl.startsWith(apiBase + '/imgres/')) {
			let variantUrl = normalizedUrl;
			if (!variantUrl.includes('res=')) {
				variantUrl += (variantUrl.includes('?') ? '&' : '?') + 'res=' + encodeURIComponent(normalizedVariant);
			}
			if (token && !variantUrl.includes('token=')) {
				variantUrl += '&token=' + encodeURIComponent(token);
			}
			return variantUrl;
		}

		if (normalizedUrl.startsWith(apiBase + '/image/')) {
			const imageId = normalizedUrl.slice((apiBase + '/image/').length).split(/[?#]/, 1)[0];
			let variantUrl =
				apiBase + '/imgres/' + encodeURIComponent(imageId) + '?res=' + encodeURIComponent(normalizedVariant);
			if (token) {
				variantUrl += '&token=' + encodeURIComponent(token);
			}
			return variantUrl;
		}

		if (/^https?:\/\//i.test(normalizedUrl)) {
			let variantUrl =
				apiBase +
				'/cache/image?url=' +
				encodeURIComponent(normalizedUrl) +
				'&res=' +
				encodeURIComponent(normalizedVariant);
			if (token) {
				variantUrl += '&token=' + encodeURIComponent(token);
			}
			return variantUrl;
		}

		return normalizedUrl;
	}

	function resolveApiImageUrl(imageUrl) {
		const rawUrl = normalizeUrl(imageUrl);
		if (!rawUrl) {
			return '';
		}
		const apiBase = getApiBase();
		const normalizedUrl = rawUrl.startsWith('/image/') ? apiBase + rawUrl : rawUrl;
		if (!normalizedUrl.startsWith(apiBase + '/image/')) {
			return normalizedUrl;
		}
		const token = getAccessToken();
		if (token && !normalizedUrl.includes('token=')) {
			return normalizedUrl + (normalizedUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
		}
		return normalizedUrl;
	}

	function getApiBase() {
		if (window.starlShared && typeof window.starlShared.getApiBase === 'function') {
			return window.starlShared.getApiBase();
		}
		if (window.starlAuth && typeof window.starlAuth.getApiBase === 'function') {
			return window.starlAuth.getApiBase();
		}
		if (typeof window.STARL_API_BASE === 'string' && window.STARL_API_BASE.trim()) {
			return window.STARL_API_BASE.trim().replace(/\/$/, '');
		}
		return window.STARL_API_BASE;
	}

	function getAccessToken() {
		if (window.starlShared && typeof window.starlShared.getAccessToken === 'function') {
			return window.starlShared.getAccessToken();
		}
		if (window.starlAuth && typeof window.starlAuth.getAccessToken === 'function') {
			return window.starlAuth.getAccessToken();
		}
		return localStorage.getItem('starl_access_token');
	}

	function getProxiedImageUrl(imageUrl, variant = 'high') {
		imageUrl = normalizeUrl(imageUrl);
		if (!imageUrl) {
			return '';
		}
		if (/^(blob:|data:|file:)/i.test(imageUrl)) {
			return imageUrl;
		}
		return getImageVariantUrl(imageUrl, variant);
	}

	function preloadImage(url) {
		if (!url) {
			return Promise.resolve('');
		}
		return new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(url);
			image.onerror = () => reject(new Error('Image preload failed'));
			image.src = url;
		});
	}

	function setProgressiveImage(targetKey, imageUrl, applyUrl, opts) {
		// opts.variant === 'low' (or opts.upgrade === false) keeps the low-res variant and skips the high-res upgrade.
		// small list-row thumbnails don't need the ~1280px maxres image - gpu doesn't like to eat that much data for a tiny thumbnail heheh
		// downloading and decoding it per row is a major source of scroll jank shit - so callers rendering small covers should pass {variant: 'low'}. Headers / full-screen art omit it and stay cute
		opts = opts || {};
		const lowOnly = opts.variant === 'low' || opts.upgrade === false;
		// try to use a locally cached blob first (works offline)
		return (async () => {
			try {
				const cached = await getImageUrl(imageUrl);
				if (cached) {
					applyUrl(cached);
					return cached;
				}
			} catch (e) {
				// ignore cache lookup errors and continue to remote flow
			}

			const lowUrl = getImageVariantUrl(imageUrl, 'low');
			const highUrl = getImageVariantUrl(imageUrl, 'high');
			const token = (progressiveImageTokens.get(targetKey) || 0) + 1;
			progressiveImageTokens.set(targetKey, token);

			const initialUrl = lowUrl || highUrl;
			if (initialUrl) {
				applyUrl(initialUrl);
			} else {
				applyUrl('');
			}

			if (lowOnly || !highUrl || highUrl === initialUrl) {
				return initialUrl || '';
			}

			try {
				await preloadImage(highUrl);
				if (progressiveImageTokens.get(targetKey) !== token) {
					return '';
				}
				applyUrl(highUrl);
				return highUrl;
			} catch (err) {
				return initialUrl || '';
			}
		})();
	}

	function attachToken(url, token) {
		if (!url) {
			return '';
		}
		if (!token || /^blob:|^data:|^file:/i.test(url)) {
			return url;
		}
		return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
	}

	function makeObjectUrl(key, blob) {
		if (!blob) {
			return '';
		}
		// reuse existing object URL for the same key - revoking and recreating it breaks any element that already has the URL set as its src/backgroundImage
		// clearCache() clears the map, so after a cache wipe a fresh URL is created
		if (objectUrlByKey.has(key)) {
			return objectUrlByKey.get(key);
		}
		const objectUrl = URL.createObjectURL(blob);
		objectUrlByKey.set(key, objectUrl);
		return objectUrl;
	}

	async function getTrackRecord(trackKey) {
		trackKey = normalizeTrackKey(trackKey);
		if (!trackKey) {
			return null;
		}

		return withStore(TRACK_STORE, 'readonly', (store) => requestToPromise(store.get(trackKey)));
	}

	// KV store helpers (top-level) - kv means key value
	async function getKVRecord(key) {
		key = normalizeUrl(key);
		if (!key) return null;
		return withStore(KV_STORE, 'readonly', (store) => requestToPromise(store.get(key)));
	}

	async function setKVRecord(key, value) {
		key = normalizeUrl(key);
		if (!key) return null;
		const record = {key, value, updatedAt: Date.now()};
		return withStore(KV_STORE, 'readwrite', (store) => store.put(record));
	}

	async function removeKVRecord(key) {
		key = normalizeUrl(key);
		if (!key) return false;
		return withStore(KV_STORE, 'readwrite', (store) => requestToPromise(store.delete(key)));
	}

	// helper for storing user profile (name + picture)
	async function getUserProfile() {
		try {
			const rec = await getKVRecord('user_profile');
			const name = rec && rec.value && rec.value.name ? rec.value.name : '';
			// try to return a locally stored blob URL for the profile picture if available
			try {
				const blobUrl = await getImageUrl('user_profile_picture');
				return {
					name: name || '',
					picture: blobUrl || (rec && rec.value && rec.value.picture ? rec.value.picture : ''),
				};
			} catch (e) {
				return {name: name || '', picture: rec && rec.value && rec.value.picture ? rec.value.picture : ''};
			}
		} catch (e) {
			return null;
		}
	}

	async function setUserProfile(profile) {
		try {
			if (!profile || typeof profile !== 'object') return null;
			const name = String(profile.name || '');
			const pictureRaw = normalizeUrl(profile.picture || '');
			// persist name and picture URL in KV as fallback; prefer blob storage for offline rendering.
			await setKVRecord('user_profile', {name, picture: pictureRaw});

			if (pictureRaw) {
				// attempt to fetch the picture and store as blob under IMAGE_STORE with key 'user_profile_picture'
				try {
					const fetchUrl = getProxiedImageUrl(pictureRaw, 'high') || pictureRaw;
					const resp = await fetch(fetchUrl);
					if (resp && resp.ok) {
						const blob = await resp.blob();
						const record = {
							imageKey: 'user_profile_picture',
							imageUrl: fetchUrl,
							blob,
							cachedAt: Date.now(),
						};
						await withStore(IMAGE_STORE, 'readwrite', (store) => store.put(record));
						imageRecordByKey.set('user_profile_picture', record);
					}
				} catch (e) {
					// ignore fetch/store failure - don't block storing name
				}
			}

			// return current profile with either blob URL (if stored) or the original pictureRaw
			const blobUrl = await getImageUrl('user_profile_picture').catch(() => '');
			const result = {name, picture: blobUrl || pictureRaw};
			return result;
		} catch (e) {
			return null;
		}
	}

	async function getImageRecord(imageKey) {
		imageKey = normalizeImageKey(imageKey);
		if (!imageKey) {
			return null;
		}
		if (imageRecordByKey.has(imageKey)) {
			return imageRecordByKey.get(imageKey);
		}
		const record = await withStore(IMAGE_STORE, 'readonly', (store) => requestToPromise(store.get(imageKey)));
		if (record && record.blob) {
			imageRecordByKey.set(imageKey, record);
		}
		return record;
	}

	async function cacheTrack(entry) {
		const trackKey = normalizeTrackKey(entry && entry.trackKey);
		const streamUrl = normalizeUrl(entry && entry.streamUrl);
		const token = entry && entry.token ? String(entry.token) : '';
		if (!trackKey || !streamUrl) {
			return null;
		}
		if (cachePaused.audio) {
			return null;
		}

		const existing = await getTrackRecord(trackKey);
		if (existing && existing.blob) {
			return existing;
		}

		// retry with backoff - the server-side /stream/ file may still be 404 while
		// the proxy is writing it. poll patiently (up to ~2.5 min) because a long
		// track isn't fully written server-side until it has finished streaming once
		let response;
		const delays = [0, 3000, 5000, 8000, 12000, 20000, 30000, 45000, 45000];
		for (let attempt = 0; attempt < delays.length; attempt++) {
			if (delays[attempt] > 0) {
				await new Promise((r) => setTimeout(r, delays[attempt]));
			}
			try {
				response = await fetch(attachToken(streamUrl, token));
			} catch (err) {
				// network blip (ex: went offline mid-cache) - give up quietly and behave
				console.warn('[media-cache] track fetch network error for', trackKey, err);
				return null;
			}
			if (response.ok) break;
			if (response.status === 404 && attempt < delays.length - 1) continue;
			throw new Error('Track cache fetch failed: ' + response.status);
		}
		if (!response || !response.ok) {
			throw new Error('Track cache fetch failed after retries (server file never became ready)');
		}
		const blob = await response.blob();
		const record = {
			trackKey,
			sourceUrl: normalizeUrl(entry && entry.sourceUrl),
			streamUrl,
			title: String(entry && entry.title ? entry.title : ''),
			artist: String(entry && entry.artist ? entry.artist : ''),
			album: String(entry && entry.album ? entry.album : ''),
			imageUrl: normalizeUrl(entry && entry.imageUrl),
			duration: Number(entry && entry.duration ? entry.duration : 0) || 0,
			cachedAt: Date.now(),
			blob,
		};
		await withStore(TRACK_STORE, 'readwrite', (store) => store.put(record));

		const aliases = [record.sourceUrl, streamUrl].filter((value) => value && value !== trackKey);
		for (const aliasKey of aliases) {
			await withStore(TRACK_STORE, 'readwrite', (store) =>
				store.put({...record, trackKey: aliasKey, aliasOf: trackKey}),
			);
		}
		console.info(
			'[media-cache] cached track',
			trackKey,
			'(' + (Number(blob.size) || 0) + ' bytes); aliases:',
			aliases,
		);
		// le offline-availability , and code else know this track is now playable offline
		try {
			window.dispatchEvent(new CustomEvent('starl-track-cached', {detail: {trackKey}}));
		} catch (e) {}
		return record;
	}

	async function cacheImage(imageUrl) {
		const sourceUrl = normalizeUrl(imageUrl);
		const imageKey = normalizeImageKey(sourceUrl);
		if (!sourceUrl || !imageKey) {
			return null;
		}
		if (cachePaused.image) {
			return null;
		}
		const fetchUrl = getProxiedImageUrl(sourceUrl, 'high');

		const existing = await getImageRecord(imageKey);
		if (existing && existing.blob) {
			return existing;
		}

		const response = await fetch(fetchUrl);
		if (!response.ok) {
			throw new Error('Image cache fetch failed: ' + response.status);
		}
		const blob = await response.blob();
		const record = {imageKey, imageUrl: fetchUrl, sourceUrl, blob, cachedAt: Date.now()};
		await withStore(IMAGE_STORE, 'readwrite', (store) => store.put(record));
		imageRecordByKey.set(imageKey, record);
		// let the storage manager know a new image landed, so it can enforce the image cap
		// (mirrors the 'starl-track-cached' event fired by cacheTrack).
		try {
			window.dispatchEvent(new CustomEvent('starl-image-cached', {detail: {imageKey}}));
		} catch (e) {}
		return record;
	}

	async function getTrackUrl(trackKey) {
		const record = await getTrackRecord(trackKey);
		if (!record || !record.blob) {
			return '';
		}
		return makeObjectUrl(normalizeTrackKey(trackKey), record.blob);
	}

	async function getImageUrl(imageUrl) {
		const record = await getImageRecord(imageUrl);
		if (!record || !record.blob) {
			return '';
		}
		return makeObjectUrl(normalizeImageKey(imageUrl), record.blob);
	}

	async function resolveTrackUrl(entry) {
		const trackKey = normalizeTrackKey(entry && entry.trackKey);
		const streamUrl = normalizeUrl(entry && entry.streamUrl);
		const token = entry && entry.token ? String(entry.token) : '';

		if (!trackKey) {
			return '';
		}

		const cachedUrl = await getTrackUrl(trackKey);
		if (cachedUrl) {
			return cachedUrl;
		}

		if (!navigator.onLine) {
			return '';
		}

		if (streamUrl) {
			cacheTrack(entry).catch(() => {});
			return attachToken(streamUrl, token);
		}

		return '';
	}

	async function resolveImageUrl(imageUrl, variant) {
		imageUrl = normalizeUrl(imageUrl);
		if (!imageUrl) {
			return '';
		}
		// small list-row callers can pass 'low' to avoid pulling the ~1280px
		// maxres image into a tiny thumbnail (cuts bandwidth + decode jank).
		const fetchUrl = getProxiedImageUrl(imageUrl, variant === 'low' ? 'low' : 'high');

		const cachedUrl = await getImageUrl(imageUrl);
		if (cachedUrl) {
			return cachedUrl;
		}

		if (!navigator.onLine) {
			return '';
		}

		cacheImage(imageUrl).catch(() => {});
		return fetchUrl;
	}

	async function getCacheStats() {
		const db = await openDatabase();
		if (!db) return {audio_count: 0, audio_bytes: 0, image_count: 0, image_bytes: 0};

		function statsForStore(storeName) {
			return new Promise((resolve, reject) => {
				const tx = db.transaction(storeName, 'readonly');
				const store = tx.objectStore(storeName);
				let count = 0;
				let bytes = 0;
				const req = store.openCursor();
				req.onsuccess = (e) => {
					const cursor = e.target.result;
					if (!cursor) return;
					const val = cursor.value;
					try {
						if (val && val.blob && typeof val.blob.size === 'number') {
							bytes += Number(val.blob.size) || 0;
						}
					} catch (err) {
						// ignore read errors for individual records
					}
					count += 1;
					cursor.continue();
				};
				tx.oncomplete = () => resolve({count, bytes});
				tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
				tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
			});
		}

		const audioStats = await statsForStore(TRACK_STORE).catch(() => ({count: 0, bytes: 0}));
		const imageStats = await statsForStore(IMAGE_STORE).catch(() => ({count: 0, bytes: 0}));
		return {
			audio_count: audioStats.count,
			audio_bytes: audioStats.bytes,
			image_count: imageStats.count,
			image_bytes: imageStats.bytes,
		};
	}

	async function clearCache() {
		// revoke object URLs
		for (const url of objectUrlByKey.values()) {
			try {
				URL.revokeObjectURL(url);
			} catch (e) {}
		}
		objectUrlByKey.clear();
		imageRecordByKey.clear();
		progressiveImageTokens.clear();

		if (!('indexedDB' in window)) return;
		// close any open db promise reference
		dbPromise = null;
		return new Promise((resolve) => {
			try {
				const req = indexedDB.deleteDatabase(DB_NAME);
				req.onsuccess = () => resolve(true);
				req.onerror = () => resolve(false);
				req.onblocked = () => resolve(false);
			} catch (e) {
				resolve(false);
			}
		});
	}

	// sets a DOM element's background-image progressively: low-res first, then high-res
	// logic: background/music tiles load first, high-res load later for big elements.
	function setImageEl(el, imageUrl, opts) {
		if (!el || !imageUrl) return;
		const key = imageUrl + '|' + (el.dataset.imgKey || (el.dataset.imgKey = Math.random().toString(36).slice(2)));
		setProgressiveImage(
			key,
			imageUrl,
			(url) => {
				if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
			},
			opts,
		);
	}

	// like setImageEl, but defers the actual load until the element nears the viewport.
	// list/grid row builders use this so opening a long list doesn't fire one image
	// resolution (IndexedDB read + possible network fetch) per row all at once - the
	// covers stream in as you scroll instead. one observer per scroll root is shared.
	const lazyObserversByRoot = new Map();
	const lazyPending = new WeakMap();

	function getLazyObserver(root, rootMargin) {
		const mapKey = root || 'viewport';
		let observer = lazyObserversByRoot.get(mapKey);
		if (observer) return observer;
		observer = new IntersectionObserver(
			(entries, obs) => {
				entries.forEach((entry) => {
					if (!entry.isIntersecting) return;
					const el = entry.target;
					obs.unobserve(el);
					const pending = lazyPending.get(el);
					lazyPending.delete(el);
					if (pending) setImageEl(el, pending.imageUrl, pending.opts);
				});
			},
			{root: root || null, rootMargin: rootMargin || '300px 0px'},
		);
		lazyObserversByRoot.set(mapKey, observer);
		return observer;
	}

	function lazyImageEl(el, imageUrl, opts) {
		if (!el || !imageUrl) return;
		// no IntersectionObserver (ancient old crap WebView): just load it now
		if (typeof IntersectionObserver === 'undefined') {
			setImageEl(el, imageUrl, opts);
			return;
		}
		const root = opts && opts.root ? opts.root : null;
		const rootMargin = opts && opts.rootMargin ? opts.rootMargin : '300px 0px';
		lazyPending.set(el, {imageUrl, opts});
		getLazyObserver(root, rootMargin).observe(el);
	}

	function revokeTrackUrl(trackKey) {
		const key = normalizeTrackKey(trackKey);
		if (!key) return;
		const existing = objectUrlByKey.get(key);
		if (existing) {
			try {
				URL.revokeObjectURL(existing);
			} catch (e) {}
			objectUrlByKey.delete(key);
		}
	}

	async function removeTrack(trackKey) {
		const key = normalizeTrackKey(trackKey);
		if (!key) return false;
		revokeTrackUrl(key);
		// also revoke any aliased object URLs that share the same blob, because blobs are funny like that.
		const rec = await getTrackRecord(key).catch(() => null);
		const aliases = [];
		if (rec) {
			if (rec.sourceUrl) aliases.push(normalizeTrackKey(rec.sourceUrl));
			if (rec.streamUrl) aliases.push(normalizeTrackKey(rec.streamUrl));
		}
		for (const alias of aliases) {
			if (alias && alias !== key) revokeTrackUrl(alias);
		}
		// delete main record and all aliases from IndexedDB
		const keysToDelete = [key, ...aliases].filter(Boolean);
		for (const k of keysToDelete) {
			try {
				await withStore(TRACK_STORE, 'readwrite', (store) => store.delete(k));
			} catch (_) {}
		}
		return true;
	}

	// walk a store and return one row per record: {key, bytes, cachedAt}. shared by
	// listTracks/listImages so the storage manager can pick the oldest items to evict.
	function listStore(storeName, keyField) {
		return withStore(storeName, 'readonly', (store, tx) => {
			const rows = [];
			const req = store.openCursor();
			req.onsuccess = (e) => {
				const cursor = e.target.result;
				if (!cursor) return;
				const val = cursor.value;
				// tracks store alias copies of the same blob (aliasOf set); count each track once.
				if (!(val && val.aliasOf)) {
					let bytes = 0;
					try {
						if (val && val.blob && typeof val.blob.size === 'number') {
							bytes = Number(val.blob.size) || 0;
						}
					} catch (err) {}
					rows.push({key: val ? val[keyField] : '', bytes, cachedAt: Number(val && val.cachedAt) || 0});
				}
				cursor.continue();
			};
			return rows;
		}).then((rows) => rows || []);
	}

	async function listTracks() {
		return listStore(TRACK_STORE, 'trackKey');
	}

	// full metadata for each real cached track (alias rows skipped), MINUS the heavy audio
	// blob - just a hasBlob flag so callers know what's actually playable offline. lets the
	// mix "library fallback" build a queue without pulling every song's bytes into memory.
	function listTrackRecords() {
		return withStore(TRACK_STORE, 'readonly', (store) => {
			const rows = [];
			const req = store.openCursor();
			req.onsuccess = (e) => {
				const cursor = e.target.result;
				if (!cursor) return;
				const val = cursor.value;
				if (val && !val.aliasOf) {
					const {blob, ...meta} = val;
					const hasBlob = !!(blob && (typeof blob.size !== 'number' || blob.size > 0));
					rows.push({...meta, hasBlob});
				}
				cursor.continue();
			};
			return rows;
		}).then((rows) => rows || []);
	}

	async function listImages() {
		return listStore(IMAGE_STORE, 'imageKey');
	}

	async function removeImage(imageKey) {
		const key = normalizeImageKey(imageKey);
		if (!key) return false;
		const existing = objectUrlByKey.get(key);
		if (existing) {
			try {
				URL.revokeObjectURL(existing);
			} catch (e) {}
			objectUrlByKey.delete(key);
		}
		imageRecordByKey.delete(key);
		try {
			await withStore(IMAGE_STORE, 'readwrite', (store) => store.delete(key));
		} catch (e) {
			return false;
		}
		return true;
	}

	// replace the blob of an already-cached image (keeps the same key/metadata).
	// used by the storage manager's "compress" overflow action to shrink images in place.
	async function putImageBlob(imageKey, blob) {
		const key = normalizeImageKey(imageKey);
		if (!key || !blob) return false;
		const record = await getImageRecord(key);
		if (!record) return false;
		const next = {...record, blob, cachedAt: record.cachedAt || Date.now()};
		try {
			await withStore(IMAGE_STORE, 'readwrite', (store) => store.put(next));
		} catch (e) {
			return false;
		}
		imageRecordByKey.set(key, next);
		// drop the stale object URL so the next read rebuilds one from the smaller blob.
		const existing = objectUrlByKey.get(key);
		if (existing) {
			try {
				URL.revokeObjectURL(existing);
			} catch (e) {}
			objectUrlByKey.delete(key);
		}
		return true;
	}

	window.starlMediaCache = {
		cacheTrack,
		cacheImage,
		listTracks,
		listTrackRecords,
		listImages,
		removeImage,
		putImageBlob,
		getImageRecord,
		setCachePaused,
		getTrackRecord,
		getTrackUrl,
		revokeTrackUrl,
		removeTrack,
		getImageUrl,
		getImageVariantUrl,
		setProgressiveImage,
		setImageEl,
		lazyImageEl,
		resolveTrackUrl,
		resolveImageUrl,
		attachToken,
		getCacheStats,
		clearCache,
		getKVRecord,
		setKVRecord,
		removeKVRecord,
		getUserProfile,
		setUserProfile,
	};
})();

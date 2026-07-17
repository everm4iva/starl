/**
 * ☆=========================================☆
 * Storage - cache limits, storage math, and overflow enforcement
 * Owns the per-device storage settings (how big the music/image caches may get
 * and what happens when they overflow), reads the live sizes of everything the
 * app keeps on disk, and actually enforces the caps against the media cache.
 * UI-free: the Manage storage page (storage-page.js) renders what this exposes.
 *
 * --- What this file does? ---
 * - Holds settings in localStorage (local-only, never synced - free space is
 *   per device): total budget mode, image/music caps (percent), overflow actions
 * - getDeviceStorage(): device total / free / app footprint via the native
 *   StarlStorage plugin, falling back to navigator.storage.estimate() in a browser
 * - collectSnapshot(): every number the bar needs, in bytes, in one object
 * - checkAndEnforce(kind): applies the overflow action when a cache is over its cap
 *     remove-older -> evict oldest by cachedAt   (default)
 *     delete-all   -> wipe that cache
 *     compress     -> re-encode images smaller (music can't compress -> remove-older)
 *     no-cache     -> pause caching for that kind until it drops back under
 *
 * --- Dictionary / Terms / Extra details ---
 * - "budget" = what 100% means for the caps: device free space, or a fixed GB total
 * - "user storage" = protected local metadata (tokens, playback state, lyrics
 *   cache, these settings, profile) - measured, never evicted
 * ☆=========================================☆
 */

(function () {
	const LOCAL_KEY = 'starl_storage_settings';
	const GB = 1024 * 1024 * 1024;
	const PROFILE_IMAGE_KEY = 'user_profile_picture'; // lives in the image store but belongs to "user storage"

	const OVERFLOW_ACTIONS = ['remove-older', 'delete-all', 'compress', 'no-cache'];
	// 'device' = 100% is live device free space, 'fixed' = a chosen GB total,
	// 'full' = no caps at all, cache grows until the device itself runs out.
	const TOTAL_MODES = ['device', 'fixed', 'full'];

	const DEFAULTS = {
		totalMode: 'device', // 'device' = 100% is live device free space, 'fixed' = totalGbBytes
		totalGbBytes: 0,
		imagePct: 20,
		musicPct: 40,
		imageOverflowAction: 'remove-older',
		musicOverflowAction: 'remove-older',
	};

	let settings = load();

	/* ☆======= store (local-only) =======☆ */

	function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	function reconcile(raw) {
		const next = Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
		if (!TOTAL_MODES.includes(next.totalMode)) next.totalMode = DEFAULTS.totalMode;
		next.totalGbBytes = Math.max(0, Number(next.totalGbBytes) || 0);
		next.imagePct = clamp(Number(next.imagePct) || 0, 0, 100);
		next.musicPct = clamp(Number(next.musicPct) || 0, 0, 100);
		if (!OVERFLOW_ACTIONS.includes(next.imageOverflowAction))
			next.imageOverflowAction = DEFAULTS.imageOverflowAction;
		if (!OVERFLOW_ACTIONS.includes(next.musicOverflowAction))
			next.musicOverflowAction = DEFAULTS.musicOverflowAction;
		return next;
	}

	function load() {
		try {
			const rawText = localStorage.getItem(LOCAL_KEY);
			if (rawText) return reconcile(JSON.parse(rawText));
		} catch (error) {}
		return reconcile(null);
	}

	function save() {
		try {
			localStorage.setItem(LOCAL_KEY, JSON.stringify(settings));
		} catch (error) {}
	}

	/* ☆======= media cache handle =======☆ */

	function mediaCache() {
		return window.starlMediaCache || null;
	}

	/* ☆======= device numbers =======☆ */

	async function estimateFallback() {
		try {
			if (navigator.storage && typeof navigator.storage.estimate === 'function') {
				const est = await navigator.storage.estimate();
				const quota = Number(est.quota) || 0;
				const usage = Number(est.usage) || 0;
				return {totalBytes: quota, freeBytes: Math.max(0, quota - usage), appBytes: usage, fallback: true};
			}
		} catch (error) {}
		return {totalBytes: 0, freeBytes: 0, appBytes: 0, fallback: true};
	}

	function fetchDeviceStorage() {
		return new Promise((resolve) => {
			if (window.StarlStorage && typeof window.StarlStorage.getDeviceStorage === 'function') {
				window.StarlStorage.getDeviceStorage(
					(res) => {
						resolve({
							totalBytes: Number(res && res.totalBytes) || 0,
							freeBytes: Number(res && res.freeBytes) || 0,
							appBytes: Number(res && res.appBytes) || 0,
							fallback: false,
						});
					},
					() => estimateFallback().then(resolve),
				);
				return;
			}
			estimateFallback().then(resolve);
		});
	}

	// the native call walks the whole app data dir (slow on a big cache), and it gets
	// asked for on every enforce pass + snapshot. cache the result briefly and dedupe
	// in-flight calls so a burst of cache writes doesn't re-walk the disk each time
	let deviceCache = null; // {value, at}
	let devicePending = null;
	const DEVICE_TTL_MS = 15000;

	function getDeviceStorage(force) {
		if (!force && deviceCache && Date.now() - deviceCache.at < DEVICE_TTL_MS) {
			return Promise.resolve(deviceCache.value);
		}
		if (devicePending) return devicePending;
		devicePending = fetchDeviceStorage().then((value) => {
			deviceCache = {value: value, at: Date.now()};
			devicePending = null;
			return value;
		});
		return devicePending;
	}

	/* ☆======= live sizes =======☆ */

	// rough byte size of everything in localStorage (UTF-16, 2 bytes per char)
	function localStorageBytes() {
		let total = 0;
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				const value = localStorage.getItem(key) || '';
				total += (String(key).length + value.length) * 2;
			}
		} catch (error) {}
		return total;
	}

	async function collectCacheSizes() {
		const cache = mediaCache();
		if (!cache || typeof cache.listTracks !== 'function') {
			return {musicBytes: 0, imageBytes: 0, profilePicBytes: 0};
		}
		const [tracks, images] = await Promise.all([cache.listTracks(), cache.listImages()]);
		let musicBytes = 0;
		tracks.forEach((t) => (musicBytes += t.bytes));
		let imageBytes = 0;
		let profilePicBytes = 0;
		images.forEach((im) => {
			if (im.key === PROFILE_IMAGE_KEY) profilePicBytes += im.bytes;
			else imageBytes += im.bytes;
		});
		return {musicBytes, imageBytes, profilePicBytes};
	}

	/* ☆======= budget + caps =======☆ */

	async function getBudgetBytes(device) {
		if (settings.totalMode === 'fixed') return settings.totalGbBytes;
		const dev = device || (await getDeviceStorage());
		return dev.freeBytes;
	}

	function capBytesFor(kind, budgetBytes) {
		const pct = kind === 'music' ? settings.musicPct : settings.imagePct;
		return Math.round((pct / 100) * budgetBytes);
	}

	/* ☆======= snapshot for the bar =======☆ */

	async function collectSnapshot() {
		const device = await getDeviceStorage();
		const sizes = await collectCacheSizes();
		const budgetBytes = await getBudgetBytes(device);
		const userBytes = localStorageBytes() + sizes.profilePicBytes;
		const unlimited = settings.totalMode === 'full';
		return {
			totalMode: settings.totalMode,
			unlimited,
			fallback: device.fallback,
			totalBytes: device.totalBytes,
			freeBytes: device.freeBytes,
			appBytes: device.appBytes,
			budgetBytes,
			musicBytes: sizes.musicBytes,
			imageBytes: sizes.imageBytes,
			userBytes,
			// full storage has no caps -> no reserved headroom segments
			musicCapBytes: unlimited ? 0 : capBytesFor('music', budgetBytes),
			imageCapBytes: unlimited ? 0 : capBytesFor('image', budgetBytes),
		};
	}

	/* ☆======= enforcement =======☆ */

	async function listForKind(kind) {
		const cache = mediaCache();
		if (!cache) return [];
		if (kind === 'music') return cache.listTracks();
		const images = await cache.listImages();
		return images.filter((im) => im.key !== PROFILE_IMAGE_KEY);
	}

	async function removeForKind(kind, key) {
		const cache = mediaCache();
		if (!cache) return false;
		return kind === 'music' ? cache.removeTrack(key) : cache.removeImage(key);
	}

	function sumBytes(list) {
		return list.reduce((total, item) => total + item.bytes, 0);
	}

	async function evictOldest(kind, capBytes) {
		const list = await listForKind(kind);
		list.sort((a, b) => a.cachedAt - b.cachedAt); // oldest first
		let spent = sumBytes(list);
		for (const item of list) {
			if (spent <= capBytes) break;
			const removed = await removeForKind(kind, item.key);
			if (removed) spent -= item.bytes;
		}
	}

	async function deleteAll(kind) {
		const list = await listForKind(kind);
		for (const item of list) {
			await removeForKind(kind, item.key);
		}
	}

	// re-encode one image blob to a smaller JPEG. resolves the new blob, or null if
	// it couldn't shrink it (kept the original in that case)
	function recompressBlob(blob) {
		return new Promise((resolve) => {
			try {
				const url = URL.createObjectURL(blob);
				const img = new Image();
				img.onload = () => {
					try {
						const canvas = document.createElement('canvas');
						canvas.width = img.naturalWidth;
						canvas.height = img.naturalHeight;
						canvas.getContext('2d').drawImage(img, 0, 0);
						canvas.toBlob(
							(out) => {
								URL.revokeObjectURL(url);
								resolve(out && out.size < blob.size ? out : null);
							},
							'image/jpeg',
							0.5,
						);
					} catch (error) {
						URL.revokeObjectURL(url);
						resolve(null);
					}
				};
				img.onerror = () => {
					URL.revokeObjectURL(url);
					resolve(null);
				};
				img.src = url;
			} catch (error) {
				resolve(null);
			}
		});
	}

	async function compressImages(capBytes) {
		const cache = mediaCache();
		if (!cache || typeof cache.getImageRecord !== 'function' || typeof cache.putImageBlob !== 'function') {
			// no low-level image access -> can't recompress in place, fall back to eviction
			await evictOldest('image', capBytes);
			return;
		}
		const list = await listForKind('image');
		list.sort((a, b) => b.bytes - a.bytes); // biggest first: most to reclaim
		let spent = sumBytes(list);
		for (const item of list) {
			if (spent <= capBytes) break;
			const record = await cache.getImageRecord(item.key);
			if (!record || !record.blob) continue;
			const smaller = await recompressBlob(record.blob);
			if (smaller) {
				await cache.putImageBlob(item.key, smaller);
				spent -= item.bytes - smaller.size;
			}
		}
		// compression alone may not be enough (already-tiny images) - top up with eviction
		if (spent > capBytes) await evictOldest('image', capBytes);
	}

	function actionFor(kind) {
		return kind === 'music' ? settings.musicOverflowAction : settings.imageOverflowAction;
	}

	function setPausedFor(kind, paused) {
		const cache = mediaCache();
		if (!cache || typeof cache.setCachePaused !== 'function') return;
		cache.setCachePaused(kind === 'music' ? {audio: paused} : {image: paused});
	}

	// bring one cache back under its cap using the user's chosen overflow action
	async function checkAndEnforce(kind) {
		const action = actionFor(kind);

		// full storage: no caps, no eviction, no pausing - just let the cache grow
		if (settings.totalMode === 'full') {
			setPausedFor(kind, false);
			return;
		}

		const budgetBytes = await getBudgetBytes();

		// SAFETY: a zero / unknown budget must never trigger eviction. it happens when
		// the device numbers aren't ready yet, or when "fixed" mode is picked before a
		// size is chosen (totalGbBytes still 0) - and it used to make every cap resolve
		// to 0 and wipe the whole cache. bail out and ditch everything untouched
		if (!(budgetBytes > 0)) return;

		const capBytes = capBytesFor(kind, budgetBytes);
		const spent = sumBytes(await listForKind(kind));

		// only "no-cache" pauses writes; every other action must leave writes enabled
		if (action === 'no-cache') {
			setPausedFor(kind, spent >= capBytes);
			return;
		}
		setPausedFor(kind, false);

		if (spent <= capBytes) return;
		if (action === 'delete-all') await deleteAll(kind);
		else if (action === 'compress') {
			if (kind === 'image') await compressImages(capBytes);
			else await evictOldest(kind, capBytes); // audio can't be recompressed client-side
		} else await evictOldest(kind, capBytes); // remove-older (default)
	}

	async function enforceAll() {
		await checkAndEnforce('music');
		await checkAndEnforce('image');
	}

	/* ☆======= public settings API =======☆ */

	function getSettings() {
		return Object.assign({}, settings);
	}

	function dispatchUpdated() {
		try {
			window.dispatchEvent(new CustomEvent('starl-storage-updated'));
		} catch (error) {}
	}

	// merge a patch, persist, re-apply the caps, and let the UI know
	function setSettings(patch) {
		settings = reconcile(Object.assign({}, settings, patch));
		save();
		// update the page right away (readouts / selections shouldn't wait on enforcement,
		// which can be slow), then refresh again once enforcement settles
		dispatchUpdated();
		enforceAll().finally(dispatchUpdated);
		return getSettings();
	}

	/* ☆======= boot =======☆ */

	// bursts of cache writes into one enforce pass per kind
	const enforceTimers = {};
	function scheduleEnforce(kind) {
		clearTimeout(enforceTimers[kind]);
		enforceTimers[kind] = setTimeout(() => checkAndEnforce(kind), 1500);
	}

	function init() {
		// re-apply pause state / evict anything that grew past the cap while the app was
		// closed - but only once the device numbers are actually available, so a not-ready
		// (zero) budget can't be mistaken for "over the limit"
		setTimeout(() => {
			getDeviceStorage(true).then(enforceAll);
		}, 3000);
		window.addEventListener('starl-track-cached', () => scheduleEnforce('music'));
		window.addEventListener('starl-image-cached', () => scheduleEnforce('image'));
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}

	window.starlStorageManager = {
		OVERFLOW_ACTIONS,
		getSettings,
		setSettings,
		getDeviceStorage,
		collectSnapshot,
		checkAndEnforce,
		enforceAll,
	};
})();

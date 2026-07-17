/**
 * ☆=========================================☆
 * Smart queue - what to do when a queued track fails to play
 * A track can fail because it isn't cached, the server doesn't answer, or the
 * stream request is invalid. This file owns the user's chosen recovery policy
 * ("When queue fails" in the account tab) and runs it when the engine reports
 * a failure.
 *
 * --- What this file does? ---
 * - Opens the "When queue fails" bottom sheet with the three recovery modes
 * - Persists the choice under the 'smartQueue' section of starlAccountState,
 *   so it lives in the user's server-side state file and syncs across devices
 * - Keeps working offline: the choice is cached in localStorage and re-sent once
 *   the server is reachable again (same pattern as appearance settings)
 * - handleFailure(): the engine calls this when a track fails; it runs the mode:
 *     'stop'     -> do nothing, playback just halts
 *     'retry'    -> re-request the same track a few times (online only), then
 *                   falls through to 'findNext' if it never recovers
 *     'findNext' -> skip to the next fully-cached track in the queue (default)
 *
 * --- Dictionary / Terms / Extra details ---
 * - "fully cached" = starlMediaCache.getTrackRecord returns a record with a .blob;
 *   the cache is all-or-nothing, so this is the only "is it playable offline" signal
 * - "direction" = +1 when the failure came from next/auto-advance, -1 from previous
 * ☆=========================================☆
 */

(function () {
	const SECTION_NAME = 'smartQueue';
	const LOCAL_KEY = 'starl_smart_queue_settings';

	const MODES = [
		{id: 'stop', label: 'Do nothing', note: 'Playback stops when a track fails.'},
		{
			id: 'retry',
			label: 'Request again',
			note: 'Re-request the failed track (online only), then skip to the next cached track if it never loads.',
		},
		{id: 'findNext', label: 'Find next cached track', note: 'Skip to the next fully-cached track in the queue.'},
	];

	const RETRY_DEFAULT_ATTEMPTS = 5;
	const RETRY_DEFAULT_INTERVAL_S = 15;
	const RETRY_MIN_ATTEMPTS = 1;
	const RETRY_MAX_ATTEMPTS = 15; // prevents the bad spam kind :(
	const RETRY_MIN_INTERVAL_S = 1;
	const RETRY_MAX_INTERVAL_S = 120;

	const DEFAULT_MODE = 'findNext';

	let liveSettings = null;
	// guards against two failures (audio 'error' + a thrown play()) firing one recovery twice
	let recovering = false;

	/* ☆======= store (mirrors appearence.js) =======☆ */

	function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	function buildDefaults() {
		return {mode: DEFAULT_MODE, retryAttempts: RETRY_DEFAULT_ATTEMPTS, retryIntervalS: RETRY_DEFAULT_INTERVAL_S};
	}

	// backfill anything missing/invalid so an old or partial cache never wedges the
	// recovery logic with a bad mode or a zero retry count
	function reconcileSettings(settings) {
		const defaults = buildDefaults();
		if (!settings || typeof settings !== 'object') {
			return defaults;
		}
		if (!MODES.some((m) => m.id === settings.mode)) {
			settings.mode = defaults.mode;
		}
		settings.retryAttempts = clamp(
			Math.round(Number(settings.retryAttempts)) || 0,
			RETRY_MIN_ATTEMPTS,
			RETRY_MAX_ATTEMPTS,
		);
		settings.retryIntervalS = clamp(
			Math.round(Number(settings.retryIntervalS)) || 0,
			RETRY_MIN_INTERVAL_S,
			RETRY_MAX_INTERVAL_S,
		);
		return settings;
	}

	function loadLocalCache() {
		try {
			const raw = localStorage.getItem(LOCAL_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			return parsed && parsed.settings ? parsed : null;
		} catch (error) {
			return null;
		}
	}

	function saveLocalCache(settings, pendingSync) {
		try {
			localStorage.setItem(LOCAL_KEY, JSON.stringify({settings, pendingSync: Boolean(pendingSync)}));
		} catch (error) {}
	}

	function getAccountStateApi() {
		return window.starlAccountState || null;
	}

	function persist(settings) {
		const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
		saveLocalCache(settings, !online);
		const api = getAccountStateApi();
		if (api && typeof api.setSection === 'function') {
			api.setSection(SECTION_NAME, settings, {skipRefresh: true});
		}
	}

	// reconnected with an edit made while offline: push the cached settings now
	window.addEventListener('starl-server-connection-state', (event) => {
		if (!(event && event.detail && event.detail.online)) return;
		const cached = loadLocalCache();
		if (!cached || !cached.pendingSync) return;
		const api = getAccountStateApi();
		if (api && typeof api.setSection === 'function') {
			api.setSection(SECTION_NAME, cached.settings, {skipRefresh: true});
		}
		saveLocalCache(cached.settings, false);
	});

	// server state changed (another device, or first sync): adopt it locally
	window.addEventListener('starl-account-state-updated', () => {
		const api = getAccountStateApi();
		const fromServer = api ? api.getSection(SECTION_NAME) : null;
		if (!fromServer || typeof fromServer !== 'object') return;
		if (JSON.stringify(fromServer) === JSON.stringify(liveSettings)) return;
		liveSettings = reconcileSettings(fromServer);
		saveLocalCache(liveSettings, false);
	});

	/* ☆======= UI helpers (mirrors appearence.js) =======☆ */

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function notify(message) {
		if (typeof window.showToast === 'function') {
			window.showToast(message, 'success');
		}
	}

	/* ☆======= settings sheet =======☆ */

	function openSettingsSheet() {
		const draft = JSON.parse(JSON.stringify(liveSettings));
		window.starlBottomSheet.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'When queue fails'));

				const list = el('div', 'sq-mode-list');
				body.appendChild(list);

				// retry-only controls; shown only while the 'retry' mode is picked
				const retryPanel = el('div', 'sq-retry-panel');

				function syncRetryPanel() {
					retryPanel.classList.toggle('hidden', draft.mode !== 'retry');
				}

				MODES.forEach((mode) => {
					const row = el('div', 'sq-mode-row' + (draft.mode === mode.id ? ' is-selected' : ''));
					row.appendChild(el('div', 'sq-mode-label', mode.label));
					row.appendChild(el('div', 'sq-mode-note', mode.note));
					row.addEventListener('click', () => {
						draft.mode = mode.id;
						list.querySelectorAll('.sq-mode-row').forEach((other) => other.classList.remove('is-selected'));
						row.classList.add('is-selected');
						syncRetryPanel();
					});
					list.appendChild(row);
				});

				body.appendChild(retryPanel);
				appendNumberRow(
					retryPanel,
					'Attempts',
					draft.retryAttempts,
					RETRY_MIN_ATTEMPTS,
					RETRY_MAX_ATTEMPTS,
					(value) => {
						draft.retryAttempts = value;
					},
				);
				appendNumberRow(
					retryPanel,
					'Seconds between',
					draft.retryIntervalS,
					RETRY_MIN_INTERVAL_S,
					RETRY_MAX_INTERVAL_S,
					(value) => {
						draft.retryIntervalS = value;
					},
				);
				syncRetryPanel();

				const row = el('div', 'bsc-settings-row');
				const applyBtn = el('button', 'bsc-btn primary', 'Apply');
				applyBtn.type = 'button';
				applyBtn.addEventListener('click', () => {
					liveSettings = reconcileSettings(JSON.parse(JSON.stringify(draft)));
					persist(liveSettings);
					window.starlBottomSheet.close();
					notify('Saved');
				});
				row.appendChild(applyBtn);
				body.appendChild(row);
			},
		});
	}

	function appendNumberRow(panel, label, value, min, max, onChange) {
		const row = el('div', 'sq-number-row');
		row.appendChild(el('div', 'sq-number-label', label));
		const input = document.createElement('input');
		input.type = 'number';
		input.className = 'sq-number-input';
		input.min = String(min);
		input.max = String(max);
		input.step = '1';
		input.value = String(value);
		input.addEventListener('change', () => {
			const next = clamp(Math.round(Number(input.value)) || min, min, max);
			input.value = String(next);
			onChange(next);
		});
		row.appendChild(input);
		panel.appendChild(row);
	}

	/* ☆======= recovery: helpers =======☆ */

	function getQueueApi() {
		return window.starlPlaybackQueue || null;
	}

	function getMediaCacheApi() {
		return window.starlMediaCache || null;
	}

	// "offline" the same way offline-availability.js means it: the device is offline,
	// or in cache mode (logged out, browsing cached content). in this state an
	// uncached track can never play, so skips must jump straight to a cached track
	function isOffline() {
		if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
		const auth = window.starlAuth;
		if (auth && typeof auth.isCacheMode === 'function' && auth.isCacheMode()) return true;
		return false;
	}

	// turn a stored queue track into the shape playFromSearch expects (same mapping
	// queue-player.js / engine-player.js use, kept local so this file owns no globals)
	function trackToPlayItem(track) {
		return {
			trackKey: track.trackKey || '',
			url: track.sourceUrl || track.streamUrl || track.trackKey || '',
			sourceUrl: track.sourceUrl || '',
			streamUrl: track.streamUrl || '',
			title: track.title || 'Untitled',
			artist: track.artist || 'Unknown artist',
			album: track.album || '',
			thumbnail: track.imageUrl || '',
			imageUrl: track.imageUrl || '',
			duration: track.duration || 0,
		};
	}

	function playTrack(track) {
		if (track && window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
			window.starlPlayer.playFromSearch(trackToPlayItem(track), {keepPlayerState: true});
			return true;
		}
		return false;
	}

	// a track is playable offline only if the cache holds a full blob for one of its
	// candidate keys - same all-or-nothing check offline-availability.js relies on
	async function isFullyCached(track) {
		const cache = getMediaCacheApi();
		if (!cache || typeof cache.getTrackRecord !== 'function' || !track) return false;
		const keys = [track.trackKey, track.sourceUrl, track.streamUrl]
			.map((value) => String(value || '').trim())
			.filter(Boolean);
		for (const key of keys) {
			try {
				const record = await cache.getTrackRecord(key);
				if (record && record.blob) return true;
			} catch (error) {}
		}
		return false;
	}

	/* ☆======= recovery: modes =======☆ */

	// walk the queue from the failed position in `direction` and play the first
	// fully-cached track. wraps once and stops if it comes back to the start
	async function findNextCachedTrack(direction) {
		const queueApi = getQueueApi();
		if (!queueApi) return false;
		const length = queueApi.getQueueLength();
		if (length <= 1) return false;
		const queue = queueApi.getQueue();
		const start = queueApi.getCurrentIndex();
		const step = direction < 0 ? -1 : 1;

		for (let i = 1; i <= length; i++) {
			const index = (((start + step * i) % length) + length) % length;
			if (index === start) break;
			if (await isFullyCached(queue[index])) {
				const track = typeof queueApi.goToTrack === 'function' ? queueApi.goToTrack(index) : queue[index];
				return playTrack(track || queue[index]);
			}
		}
		return false;
	}

	// re-request the current track up to retryAttempts times, retryIntervalS apart
	// online only - resolves true if a retry got playback going, false otherwise so
	// the caller can fall through to findNext
	function retryCurrentTrack() {
		return new Promise((resolve) => {
			const queueApi = getQueueApi();
			const track =
				queueApi && typeof queueApi.getCurrentTrack === 'function' ? queueApi.getCurrentTrack() : null;
			if (!track) {
				resolve(false);
				return;
			}
			const attempts = clamp(
				Number(liveSettings.retryAttempts) || RETRY_DEFAULT_ATTEMPTS,
				RETRY_MIN_ATTEMPTS,
				RETRY_MAX_ATTEMPTS,
			);
			const intervalMs =
				clamp(
					Number(liveSettings.retryIntervalS) || RETRY_DEFAULT_INTERVAL_S,
					RETRY_MIN_INTERVAL_S,
					RETRY_MAX_INTERVAL_S,
				) * 1000;
			let attempt = 0;

			function attemptOnce() {
				if (!navigator.onLine) {
					resolve(false);
					return;
				}
				attempt++;
				playTrack(track);
				// give the engine time to either start the track or fail again. a recent
				// failure re-enters handleFailure
				setTimeout(() => {
					const audioEl = window.starlPlaybackState && window.starlPlaybackState.audio;
					const playing = audioEl && !audioEl.paused && !audioEl.error;
					if (playing) {
						resolve(true);
						return;
					}
					if (attempt >= attempts) {
						resolve(false);
						return;
					}
					setTimeout(attemptOnce, intervalMs);
				}, 2500);
			}

			attemptOnce();
		});
	}

	/* ☆======= recovery: entry point =======☆ */

	// jump to the plain adjacent track in `direction`, cached or not - the normal
	// online behavior when a track fails for some other reason (bad URL, server
	// hiccup, 404...). mirrors the fallback skip() does when isOffline() is false
	function advanceToAdjacentTrack(direction) {
		const queueApi = getQueueApi();
		if (!queueApi) return false;
		const track = direction < 0 ? queueApi.previousTrack() : queueApi.nextTrack();
		return playTrack(track);
	}

	// called by the engine when a queued track fails. `context.direction` is +1 for
	// next/auto-advance (default) and -1 for previous, so findNext keeps moving the
	// way the user was already going
	async function handleFailure(context) {
		if (recovering) return;
		const mode = (liveSettings && liveSettings.mode) || DEFAULT_MODE;
		if (mode === 'stop') return;

		const direction = context && Number(context.direction) < 0 ? -1 : 1;
		const offline = isOffline();
		recovering = true;
		try {
			if (mode === 'retry') {
				const recovered = navigator.onLine ? await retryCurrentTrack() : false;
				if (recovered) return;
				// offline, or every retry attempt failed: only offline does an uncached
				// track become truly unplayable, so only then restrict to cache
				if (offline) {
					await findNextCachedTrack(direction);
				} else {
					advanceToAdjacentTrack(direction);
				}
				return;
			}
			// 'findNext': only restrict to cached tracks while offline - online, a
			// failure means something else (bad URL, server hiccup...) and skipping
			// straight to a cached track would needlessly bypass playable ones
			if (offline) {
				await findNextCachedTrack(direction);
			} else {
				advanceToAdjacentTrack(direction);
			}
		} finally {
			recovering = false;
		}
	}

	// called by the next/previous buttons. while offline an uncached track can never
	// play, so instead of landing on the adjacent (possibly uncached) track, client jumps
	// straight to the next/previous fully-cached track from the current position
	// returns true if smart-queue handled the skip; false tells the caller to do its
	// normal adjacent skip (the online path, where uncached tracks can still stream)
	async function skip(direction) {
		if (!isOffline()) return false;
		const dir = Number(direction) < 0 ? -1 : 1;
		if (window.starlPlaybackState) window.starlPlaybackState.lastNavDirection = dir;
		// even if no other cached track exists - still "handle" it - or just don't
		// move, rather than land the player on an unplayable track -boring
		await findNextCachedTrack(dir);
		return true;
	}

	/* ☆======= boot it up =======☆ */

	function wireButton() {
		const item = document.getElementById('playback-queuefail-item');
		if (item) item.addEventListener('click', openSettingsSheet);
	}

	function init() {
		const cached = loadLocalCache();
		if (cached) {
			liveSettings = reconcileSettings(cached.settings);
		} else {
			const api = getAccountStateApi();
			const fromServer = api ? api.getSection(SECTION_NAME) : null;
			if (fromServer && typeof fromServer === 'object') {
				liveSettings = reconcileSettings(fromServer);
				saveLocalCache(liveSettings, false);
			} else {
				liveSettings = buildDefaults();
				persist(liveSettings);
			}
		}
		wireButton();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}

	/* ☆======= Public API =======☆ */

	window.starlSmartQueue = {
		handleFailure,
		skip,
		getMode() {
			return (liveSettings && liveSettings.mode) || DEFAULT_MODE;
		},
	};
})();

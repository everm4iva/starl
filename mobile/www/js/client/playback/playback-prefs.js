/**
 * ☆=========================================☆
 * Playback prefs - shuffle action + loop action
 * Two user choices for how the shuffle and loop buttons behave, shown in the
 * account tab's Playback section. Mirrors smart-queue.js for persistence
 *
 * --- What this file does? ---
 * - Owns two settings: shuffleMode and loopMode
 * - shuffleMode: where the current song lands when you enable shuffle
 *     'middle' -> stays wherever it shuffles to (default, the old behavior)
 *     'start'  -> jumps to the top of the queue, the rest shuffled after it
 *   (read by queue.js enableShuffle)
 * - loopMode: what one tap of the loop button cycles through
 *     'track' -> off <-> loop the song (default)
 *     'queue' -> off <-> loop the queue (no song repeat)
 *     'multi' -> off -> loop song -> loop queue -> off (multi-action button)
 *   (read by runtime.js cycleLoopButton; the resulting behavior drives
 *    audio.loop + engine-player.js auto-advance)
 * - Persists both under the 'playbackPrefs' section of starlAccountState so they
 *   live in the user's server-side state and survive offline (same as smart-queue)
 *
 * --- Dictionary / Terms / Extra details ---
 * - "song loop" = HTMLAudioElement.loop (replays the same track on end)
 * - "queue loop" = auto-advance wraps past the last track instead of stopping
 * ☆=========================================☆
 */

(function () {
	const SECTION_NAME = 'playbackPrefs';
	const LOCAL_KEY = 'starl_playback_prefs';

	const SHUFFLE_MODES = [
		{
			id: 'middle',
			label: 'Keep current song in place',
			note: 'Shuffle everything; the song you are playing stays wherever it lands in the shuffle. (default)',
		},
		{
			id: 'start',
			label: 'Move current song to the top',
			note: 'The song you are playing jumps to the start of the queue, and the rest is shuffled after it.',
		},
	];

	const LOOP_MODES = [
		{
			id: 'track',
			label: 'Loop the song, not the queue',
			note: 'The current song repeats forever; the queue stays put. (default)',
		},
		{
			id: 'queue',
			label: 'Loop the queue, not the song',
			note: 'Songs play through and the queue restarts from the top at the end. No single song repeats.',
		},
		{
			id: 'multi',
			label: 'Multi-action button',
			note: 'Each tap of the loop button cycles: off, then loop the song, then loop the queue (cycle icon), then off again.',
		},
	];

	const DEFAULT_SHUFFLE = 'middle';
	const DEFAULT_LOOP = 'track';

	let liveSettings = null;

	/* ☆======= store (mirrors smart-queue.js) =======☆ */

	function buildDefaults() {
		return {shuffleMode: DEFAULT_SHUFFLE, loopMode: DEFAULT_LOOP};
	}

	function reconcileSettings(settings) {
		const defaults = buildDefaults();
		if (!settings || typeof settings !== 'object') {
			return defaults;
		}
		if (!SHUFFLE_MODES.some((m) => m.id === settings.shuffleMode)) {
			settings.shuffleMode = defaults.shuffleMode;
		}
		if (!LOOP_MODES.some((m) => m.id === settings.loopMode)) {
			settings.loopMode = defaults.loopMode;
		}
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

	/* ☆======= UI helpers (mirrors smart-queue.js) =======☆ */

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

	// generic single-choice sheet shared by both settings
	function openChoiceSheet(title, modes, currentId, onApply) {
		if (!window.starlBottomSheet) return;
		let draft = currentId;
		window.starlBottomSheet.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', title));
				const list = el('div', 'sq-mode-list');
				body.appendChild(list);

				modes.forEach((mode) => {
					const row = el('div', 'sq-mode-row' + (draft === mode.id ? ' is-selected' : ''));
					row.appendChild(el('div', 'sq-mode-label', mode.label));
					row.appendChild(el('div', 'sq-mode-note', mode.note));
					row.addEventListener('click', () => {
						draft = mode.id;
						list.querySelectorAll('.sq-mode-row').forEach((other) => other.classList.remove('is-selected'));
						row.classList.add('is-selected');
					});
					list.appendChild(row);
				});

				const actionRow = el('div', 'bsc-settings-row');
				const applyBtn = el('button', 'bsc-btn primary', 'Apply');
				applyBtn.type = 'button';
				applyBtn.addEventListener('click', () => {
					onApply(draft);
					window.starlBottomSheet.close();
					notify('Saved');
				});
				actionRow.appendChild(applyBtn);
				body.appendChild(actionRow);
			},
		});
	}

	function openShuffleSheet() {
		openChoiceSheet('When you click shuffle', SHUFFLE_MODES, liveSettings.shuffleMode, (id) => {
			liveSettings.shuffleMode = id;
			liveSettings = reconcileSettings(liveSettings);
			persist(liveSettings);
		});
	}

	function openLoopSheet() {
		openChoiceSheet('When you click loop', LOOP_MODES, liveSettings.loopMode, (id) => {
			liveSettings.loopMode = id;
			liveSettings = reconcileSettings(liveSettings);
			persist(liveSettings);
			// no re-derive needed: the live loop behavior is independent of the mode
			// (the mode only changes how the next button tap cycles)
		});
	}

	/* ☆======= boot it up =======☆ */

	function wireButtons() {
		const shuffleItem = document.getElementById('playback-shuffle-item');
		if (shuffleItem) shuffleItem.addEventListener('click', openShuffleSheet);
		const loopItem = document.getElementById('playback-loop-item');
		if (loopItem) loopItem.addEventListener('click', openLoopSheet);
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
		wireButtons();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}

	/* ☆======= Public API =======☆ */

	window.starlPlaybackPrefs = {
		getShuffleMode() {
			return (liveSettings && liveSettings.shuffleMode) || DEFAULT_SHUFFLE;
		},
		getLoopMode() {
			return (liveSettings && liveSettings.loopMode) || DEFAULT_LOOP;
		},
	};
})();

/**
 * ☆=========================================☆
 * Lyrics - the lyrics screen for the maximized player
 * Turns the maximized player into a lyrics view: fetches lyrics from the server
 * (LRCLIB-backed), renders synced or static text, highlights the line matching the
 * song time, lets you tap a line to seek there, and falls back to a random message
 * from lyrics-failed.txt when there's nothing to show
 *
 * --- What this file does? ---
 * - open(track) / close(): toggles 'lyrics-mode' on .main-player (only the player changes)
 * - probe(track): warms the SERVER cache on track change + records availability for the
 *   context-menu label, WITHOUT persisting client-side (per spec)
 * - isAvailable(trackKey): what the context menu reads to show "Lyrics - unavailable"
 * - the note button toggles synced <-> static; a missing mode shows the matching fail text
 * - chevron-down closes the screen
 *
 * --- Dictionary / Terms / Extra details ---
 * - "synced" = timed LRC lyrics (clickable, highlight follows playback)
 * - "static" = plain untimed lyrics (no highlight, no seek)
 * - the single <audio> element is window.starlPlaybackState.audio (time source + seek target)
 * - styling lives entirely in lyrics.css via root vars - no CSS is set from here
 * ☆=========================================☆
 */

(function () {
	const FAIL_TEXT_URL = './js/notes/lyrics-failed.txt';

	/* ☆======= State =======☆ */

	let els = null;
	let current = {track: null, data: null, synced: [], mode: 'synced'};
	let availability = {}; // trackKey -> boolean (in-memory only; feeds the menu label)
	let failSections = null; // {fetchFail:[], noStatic:[], noAnimated:[]}
	let syncRAF = 0;
	let lastActiveIndex = -1;
	let closeTimer = 0;
	const CLOSE_ANIM_MS = 260;

	/* ☆======= Element refs =======☆ */

	function getEls() {
		if (els && els.root && els.root.isConnected) return els;
		const player = document.querySelector('.main-player');
		els = {
			player,
			root: player && player.querySelector('.mp-lyrics'),
			scroll: player && player.querySelector('.mp-lyrics-scroll'),
			toggle: player && player.querySelector('.mp-lyrics-toggle'),
			close: player && player.querySelector('.mp-lyrics-close'),
			meta: player && player.querySelector('.mp-lyrics-meta'),
		};
		return els;
	}

	function getAudio() {
		return (window.starlPlaybackState && window.starlPlaybackState.audio) || null;
	}

	/* ☆======= Fail-text file (sectioned) =======☆ */

	// lyrics-failed.txt groups quoted lines under "--- <section> ---" separators. Parse it
	// once into the buckets we care about, tolerant of the file's loose dash counts. The file
	// doubles as a "references" file - besides the failure messages it holds the loading texts
	async function loadFailSections() {
		if (failSections) return failSections;
		const buckets = {fetchFail: [], noStatic: [], noAnimated: [], loading: []};
		try {
			// prefer the user's edited quotes (from lyrics settings) over the bundled file
			const settings = window.starlLyricsSettings;
			const override =
				settings && typeof settings.getFailTextOverride === 'function' ? settings.getFailTextOverride() : '';
			const text = override && override.trim() ? override : await (await fetch(FAIL_TEXT_URL)).text();
			let bucket = null;
			for (const raw of text.split('\n')) {
				const line = raw.trim();
				if (!line) continue;
				const header = line.match(/^-{1,}\s*(.*?)\s*-{1,}$/);
				if (header) {
					const name = header[1].toLowerCase();
					if (name.includes('fetch')) bucket = buckets.fetchFail;
					else if (name.includes('static')) bucket = buckets.noStatic;
					else if (name.includes('animated')) bucket = buckets.noAnimated;
					else if (name.includes('loading')) bucket = buckets.loading;
					else bucket = null;
					continue;
				}
				if (bucket) bucket.push(line.replace(/^["']|["']$/g, ''));
			}
		} catch (e) {
			// network/file failure - keep empty buckets; randomLine() has its own fallback
		}
		failSections = buckets;
		return failSections;
	}

	const DEFAULT_LINE = {loading: 'finding the words…'};

	async function randomLine(kind) {
		const sections = await loadFailSections();
		const list = (sections && sections[kind]) || [];
		if (!list.length) return DEFAULT_LINE[kind] || 'oops, no lyrics over here :(';
		return list[Math.floor(Math.random() * list.length)];
	}

	// warm the references file early so the loading text can show without a fetch lag
	loadFailSections();

	// re-read the references after the user edits their quotes in settings
	function reloadReferences() {
		failSections = null;
		loadFailSections();
	}

	/* ☆======= LRC parsing =======☆ */

	function parseLRC(lrc) {
		const lines = [];
		for (const raw of String(lrc || '').split('\n')) {
			const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
			if (!m) continue;
			const time = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
			lines.push({time, text: m[3].trim()});
		}
		return lines.sort((a, b) => a.time - b.time);
	}

	/* ☆======= Server fetch =======☆ */

	// some upstream sources hand back album as {name: ...} instead of a plain string -
	// URLSearchParams.set() would otherwise stringify it to the literal "[object Object]"
	// and send that to the server, breaking the lyrics match.
	function albumToString(value) {
		if (typeof value === 'string') return value;
		if (value && typeof value === 'object' && typeof value.name === 'string') return value.name;
		return '';
	}

	function buildLyricsUrl(track) {
		const base = typeof getApiBase === 'function' ? getApiBase() : window.STARL_API_BASE || '';
		const qs = new URLSearchParams({artist: track.artist || '', track: track.title || ''});
		const album = albumToString(track.album);
		if (album) qs.set('album', album);
		if (track.duration) qs.set('duration', String(Math.round(track.duration)));
		return base + '/lyrics?' + qs.toString();
	}

	// fetch lyrics for a track. reads the client cache first; only writes it back when
	// persist is true (open() persists, probe() doesn't - that's the spec's caching rule).
	async function fetchLyrics(track, persist) {
		const cache = window.starlLyricsCache;
		if (track.trackKey && cache) {
			const hit = cache.get(track.trackKey);
			if (hit) return hit;
		}
		const token = typeof getAccessToken === 'function' ? getAccessToken() : '';
		const res = await fetch(buildLyricsUrl(track), {headers: token ? {Authorization: 'Bearer ' + token} : {}});
		if (!res.ok) throw new Error('lyrics request failed: ' + res.status);
		const data = await res.json();
		if (persist && track.trackKey && cache) cache.set(track.trackKey, data);
		return data;
	}

	/* ☆======= Rendering =======☆ */

	function clearScroll() {
		const {scroll} = getEls();
		if (scroll) scroll.innerHTML = '';
		lastActiveIndex = -1;
	}

	async function renderFail(kind) {
		const {scroll} = getEls();
		if (!scroll) return;
		stopSync();
		scroll.classList.add('is-fail');
		scroll.classList.remove('is-loading');
		scroll.innerHTML = '';
		const el = document.createElement('div');
		el.className = 'mp-lyrics-fail';
		el.textContent = await randomLine(kind);
		scroll.appendChild(el);
	}

	// loading state: a random "loading" line from the references file with a gentle pulse
	// self-guards so a late-resolving message never paints over lyrics that already arrived
	async function renderLoading(track) {
		const {scroll} = getEls();
		if (!scroll) return;
		stopSync();
		scroll.classList.add('is-fail', 'is-loading');
		scroll.innerHTML = '';
		const el = document.createElement('div');
		el.className = 'mp-lyrics-fail mp-lyrics-loading';
		const msg = await randomLine('loading');
		if (current.track !== track || current.data) return; // superseded or data already in - drugs
		el.textContent = msg;
		scroll.appendChild(el);
	}

	function renderSynced() {
		const {scroll} = getEls();
		if (!scroll) return;
		scroll.classList.remove('is-fail', 'is-loading');
		scroll.innerHTML = '';
		current.synced.forEach((ln, i) => {
			const div = document.createElement('div');
			div.className = 'mp-lyric-line' + (ln.text === '' ? ' blank' : '');
			div.dataset.i = String(i);
			div.textContent = ln.text;
			div.addEventListener('click', () => seekToLine(i));
			scroll.appendChild(div);
		});
		startSync();
	}

	function renderStatic() {
		const {scroll} = getEls();
		if (!scroll) return;
		stopSync();
		scroll.classList.remove('is-fail', 'is-loading');
		scroll.innerHTML = '';
		for (const raw of String(current.data.plain || '').split('\n')) {
			const div = document.createElement('div');
			div.className = 'mp-lyric-line static' + (raw.trim() === '' ? ' blank' : '');
			div.textContent = raw;
			scroll.appendChild(div);
		}
	}

	// renders whatever the current mode + data allow. a requested-but-missing mode shows the
	// matching fail message ("no animated/static lyrics") ONLY when the other mode exists; when
	// neither synced nor static is available it always falls back to the "fetch fail" lines
	function render() {
		const data = current.data;
		const {toggle} = getEls();
		if (toggle) toggle.classList.toggle('synced', current.mode === 'synced');

		const hasSynced = current.synced.length > 0;
		const hasPlain = Boolean(data && data.plain);

		if (!data || !data.found || (!hasSynced && !hasPlain)) {
			renderFail('fetchFail');
			return;
		}
		if (current.mode === 'synced') {
			if (hasSynced) renderSynced();
			else renderFail('noAnimated');
		} else {
			if (hasPlain) renderStatic();
			else renderFail('noStatic');
		}
	}

	/* ☆======= Sync highlight loop =======☆ */

	// centers the active line WITHIN the scroll container only. Using scrollTo on the
	// container (instead of scrollIntoView) keeps the scroll bounded to .mp-lyrics-scroll,
	// so reaching the last line never bubbles up and drags the whole maximized player
	function centerLineInScroll(scroll, lineEl) {
		const lineRect = lineEl.getBoundingClientRect();
		const contRect = scroll.getBoundingClientRect();
		const delta = lineRect.top - contRect.top - (scroll.clientHeight / 2 - lineRect.height / 2);
		const target = Math.max(0, Math.min(scroll.scrollTop + delta, scroll.scrollHeight - scroll.clientHeight));
		scroll.scrollTo({top: target, behavior: 'smooth'});
	}

	function startSync() {
		stopSync();
		const audio = getAudio();
		if (!audio || !current.synced.length) return;
		const tick = () => {
			const t = Number(audio.currentTime) || 0;
			let active = 0;
			for (let i = 0; i < current.synced.length; i++) {
				if (current.synced[i].time <= t) active = i;
				else break;
			}
			if (active !== lastActiveIndex) {
				const {scroll} = getEls();
				if (scroll) {
					const lines = scroll.querySelectorAll('.mp-lyric-line');
					lines.forEach((el, i) => {
						el.classList.toggle('active', i === active);
						el.classList.toggle('passed', i < active);
					});
					const activeEl = lines[active];
					if (activeEl) centerLineInScroll(scroll, activeEl);
				}
				lastActiveIndex = active;
			}
			syncRAF = requestAnimationFrame(tick);
		};
		syncRAF = requestAnimationFrame(tick);
	}

	function stopSync() {
		if (syncRAF) {
			cancelAnimationFrame(syncRAF);
			syncRAF = 0;
		}
	}

	function seekToLine(i) {
		const audio = getAudio();
		const ln = current.synced[i];
		if (!audio || !ln) return;
		try {
			audio.currentTime = ln.time;
		} catch (e) {}
	}

	/* ☆======= Mode toggle =======☆ */

	function setMode(mode) {
		current.mode = mode;
		render();
	}

	function toggleMode() {
		setMode(current.mode === 'synced' ? 'static' : 'synced');
	}

	/* ☆======= Open / close =======☆ */

	async function open(track) {
		if (!track) return;
		const {player, root} = getEls();
		if (!player || !root) return;

		current.track = track;
		current.data = null;
		current.synced = [];

		// cancel any quick close so reopening mid-animation lands cleanly open
		if (closeTimer) {
			clearTimeout(closeTimer);
			closeTimer = 0;
		}
		player.classList.remove('lyrics-closing');
		player.classList.add('lyrics-mode');
		setEntryActive(true);

		// re-roll the highlight animation for this song when the user picked "random"
		if (window.starlLyricsSettings && typeof window.starlLyricsSettings.onSongOpen === 'function') {
			window.starlLyricsSettings.onSongOpen();
		}

		// show a loading message while we fetch - unless the lyrics are already cached client
		// side, in which case the result is instant and a loading flash would just be noise
		clearScroll();
		const cached = track.trackKey && window.starlLyricsCache ? window.starlLyricsCache.get(track.trackKey) : null;
		if (!cached) renderLoading(track);

		let data;
		try {
			data = await fetchLyrics(track, true);
		} catch (e) {
			data = {found: false, synced: null, plain: null};
		}
		// a newer open() may have superseded this one while awaiting - drugs
		if (current.track !== track) return;

		current.data = data;
		current.synced = data && data.synced ? parseLRC(data.synced) : [];
		if (track.trackKey) availability[track.trackKey] = Boolean(data && data.found);

		// default to synced when available, otherwise static
		current.mode = current.synced.length ? 'synced' : 'static';
		render();
	}

	function close() {
		const {player} = getEls();
		stopSync();
		setEntryActive(false);
		if (!player || !player.classList.contains('lyrics-mode')) return;
		// play the exit animation, then drop lyrics-mode so the cover/details fade back in
		player.classList.add('lyrics-closing');
		clearTimeout(closeTimer);
		closeTimer = setTimeout(() => {
			closeTimer = 0;
			player.classList.remove('lyrics-mode', 'lyrics-closing');
		}, CLOSE_ANIM_MS);
	}

	// reflect open state on the maximized-player lyrics button (filled icon when open)
	function setEntryActive(on) {
		const btn = document.getElementById('mp-open-lyrics');
		if (btn) btn.classList.toggle('lyrics-open', Boolean(on));
	}

	function isOpen() {
		const {player} = getEls();
		return Boolean(player && player.classList.contains('lyrics-mode'));
	}

	/* ☆======= Background probe (track change) =======☆ */

	// song identity for lyrics purposes - title+artist is what the lyrics actually depend on
	// (more reliable than trackKey, which acts different between the menu's and playback's schemes)
	function songId(t) {
		return [t && t.title, t && t.artist]
			.map((x) =>
				String(x || '')
					.toLowerCase()
					.trim(),
			)
			.join('|');
	}

	// called on every track change. If the lyrics screen is open, reloads it for the new song
	// otherwise just warms the server cache + records availability for the menu label (no
	// client-side persist - that only happens when the screen is opened)
	async function probe(track) {
		if (!track || !track.title || !track.artist) return;

		if (isOpen() && songId(current.track) !== songId(track)) {
			open(track);
			return; // open() fetches, persists, and records if avaliable
		}

		const tk = track.trackKey || '';
		if (tk && tk in availability) return; // already known
		try {
			const data = await fetchLyrics(track, false);
			if (tk) availability[tk] = Boolean(data && data.found);
		} catch (e) {
			// leave availability undefined - the menu just shows the neutral "Lyrics" label :3
		}
	}

	function isAvailable(trackKey) {
		return trackKey in availability ? availability[trackKey] : undefined;
	}

	/* ☆======= Wiring =======☆ */

	function attach() {
		const {toggle, close: closeBtn, meta} = getEls();
		if (toggle && !toggle.dataset.bound) {
			toggle.dataset.bound = '1';
			toggle.addEventListener('click', toggleMode);
		}
		if (closeBtn && !closeBtn.dataset.bound) {
			closeBtn.dataset.bound = '1';
			closeBtn.addEventListener('click', close);
		}

		// tapping the title/artist opens the track context menu (spec: open the menu from
		// the lyrics screen via the title/background)
		if (meta && !meta.dataset.bound) {
			meta.dataset.bound = '1';
			meta.addEventListener('click', () => {
				const sheet = window.starlPlayerContextSheet;
				if (sheet && typeof sheet.open === 'function') sheet.open();
			});
		}

		// extra entry points: the .mp-additional "lyrics" button and the new icon next to the
		// favorite star both open lyrics for the currently playing track
		const openFromPlayer = () => {
			const sheet = window.starlPlayerContextSheet;
			const track = sheet && typeof sheet.getCurrentTrack === 'function' ? sheet.getCurrentTrack() : null;
			if (track) open(track);
		};
		['open-lyrics', 'mp-open-lyrics'].forEach((id) => {
			const btn = document.getElementById(id);
			if (btn && !btn.dataset.bound) {
				btn.dataset.bound = '1';
				btn.addEventListener('click', openFromPlayer);
			}
		});
	}

	if (document.readyState !== 'loading') {
		attach();
	} else {
		document.addEventListener('DOMContentLoaded', attach, {once: true});
	}

	/* ☆======= Public API =======☆ */

	window.starlLyrics = {open, close, toggleMode, probe, isAvailable, isOpen, reloadReferences};
})();

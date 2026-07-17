/**
 * ☆=========================================☆
 * Lyrics settings - font, size, highlight style/animation, and the quotes editor
 * The lyrics counterpart to appearence.js: same persistence model (a named section of
 * the account state, mirrored to localStorage and synced to the server), same bottom-sheet
 * UI building blocks. Nothing here hardcodes styles - it only flips root vars and data
 * attributes that lyrics.css reads.
 *
 * --- What this file does? ---
 * - applySettings(): writes --lyrics-font / --lyrics-font-size and the .mp-lyrics
 *   data-hl-type / data-hl-anim attributes that drive the highlight look
 * - opens a sheet per setting (font / size / highlight style / highlight animation)
 *   with a live lyric preview, Apply and Reset
 * - the "Edit lyrics quotes" editor edits the references file (lyrics-failed.txt),
 *   capped at 254 lines, sanitized, saved to the account state + client, with a reset
 * - onSongOpen(): re-rolls the animation when the user picked "random"
 *
 * --- Dictionary / Terms / Extra details ---
 * - settings live under the 'lyrics' account-state section (server-synced, offline-cached)
 * - the two highlight colors are plain root color vars, so the appearance color picker
 *   already exposes them - no extra UI needed here
 * ☆=========================================☆
 */

(function () {
	const SECTION_NAME = 'lyrics';
	const LOCAL_KEY = 'starl_lyrics_settings';
	const FAIL_TEXT_URL = './js/notes/lyrics-failed.txt';

	const FONT_SIZE_MIN = 0.8;
	const FONT_SIZE_MAX = 1.7;
	const FONT_SIZE_STEP = 0.05;
	const MAX_QUOTE_LINES = 254;

	const HIGHLIGHT_TYPES = [
		{id: 'transparency', label: 'Transparency', desc: 'Other lines fade out; the current one stays bright.'},
		{id: 'block', label: 'Block', desc: 'The current line gets a colored background.'},
	];
	const HIGHLIGHT_ANIMS = [
		{id: 'static', label: 'Static', desc: 'Snaps to the current line, no movement.'},
		{id: 'grow-static', label: 'Grow (static)', desc: 'Current line is a bit bigger, no animation.'},
		{id: 'grow-animated', label: 'Grow (animated)', desc: 'Current line smoothly grows larger.'},
		{id: 'difference-static', label: 'Difference (static)', desc: 'Other lines shrink, current stays full size.'},
		{id: 'difference-animated', label: 'Difference (animated)', desc: 'Other lines smoothly shrink away.'},
		{id: 'random', label: 'Random', desc: 'Picks a different animation for each song.'},
	];
	// the concrete animations "random" rolls between (everything except "random" itself)
	const RANDOM_POOL = HIGHLIGHT_ANIMS.slice(0, -1).map((a) => a.id);

	const DEFAULTS = {
		font: 'InstrumentSans',
		fontSize: 1.25,
		highlightType: 'transparency',
		highlightAnim: 'grow-animated',
		failText: '',
	};

	let liveSettings = clone(DEFAULTS);

	/* ☆======= small helpers =======☆ */

	function clone(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function notify(message) {
		if (typeof window.showToast === 'function') window.showToast(message, 'success');
	}

	function pickRandomAnim() {
		return RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
	}

	function mpLyricsEl() {
		return document.querySelector('.main-player .mp-lyrics');
	}

	/* ☆======= font discovery (@font-face families, like appearence.js) =======☆ */

	function getFontFamilies() {
		const families = [];
		const seen = new Set();
		const visited = new Set();
		function walk(sheet) {
			if (!sheet || visited.has(sheet)) return;
			visited.add(sheet);
			let rules;
			try {
				rules = sheet.cssRules;
			} catch (e) {
				return;
			}
			if (!rules) return;
			for (const rule of rules) {
				if (rule instanceof CSSImportRule) {
					walk(rule.styleSheet);
				} else if (rule instanceof CSSFontFaceRule) {
					const fam = rule.style
						.getPropertyValue('font-family')
						.replace(/^['"]|['"]$/g, '')
						.trim();
					if (fam && !seen.has(fam)) {
						seen.add(fam);
						families.push(fam);
					}
				}
			}
		}
		for (const sheet of document.styleSheets) walk(sheet);
		return families;
	}

	/* ☆======= apply to document =======☆ */

	function applySettings(s) {
		if (!s) return;
		const root = document.documentElement.style;
		root.setProperty('--lyrics-font', "'" + s.font + "', var(--default-font)");
		root.setProperty('--lyrics-font-size', Number(s.fontSize).toFixed(2) + 'rem');
		const mp = mpLyricsEl();
		if (mp) {
			mp.dataset.hlType = s.highlightType;
			mp.dataset.hlAnim = s.highlightAnim === 'random' ? pickRandomAnim() : s.highlightAnim;
		}
	}

	// called by lyrics.js each time a song's lyrics open, so "random" gets a fresh animation
	// per song (and a no-op for any fixed choice)
	function onSongOpen() {
		if (liveSettings.highlightAnim !== 'random') return;
		const mp = mpLyricsEl();
		if (mp) mp.dataset.hlAnim = pickRandomAnim();
	}

	/* ☆======= store (localStorage cache + account-state sync) =======☆ */

	function loadLocalCache() {
		try {
			const raw = localStorage.getItem(LOCAL_KEY);
			const parsed = raw ? JSON.parse(raw) : null;
			return parsed && parsed.settings ? parsed : null;
		} catch (e) {
			return null;
		}
	}

	function saveLocalCache(settings, pendingSync) {
		try {
			localStorage.setItem(LOCAL_KEY, JSON.stringify({settings, pendingSync: Boolean(pendingSync)}));
		} catch (e) {}
	}

	function accountApi() {
		return window.starlAccountState || null;
	}

	function persist(settings) {
		const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
		saveLocalCache(settings, !online);
		const api = accountApi();
		if (api && typeof api.setSection === 'function') {
			api.setSection(SECTION_NAME, settings, {skipRefresh: true});
		}
	}

	function reconcile(settings) {
		let changed = false;
		Object.keys(DEFAULTS).forEach((key) => {
			if (settings[key] === undefined || settings[key] === null) {
				settings[key] = DEFAULTS[key];
				changed = true;
			}
		});
		settings.fontSize = clampSize(Number(settings.fontSize));
		return changed;
	}

	function clampSize(v) {
		if (!Number.isFinite(v)) return DEFAULTS.fontSize;
		return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, v));
	}

	window.addEventListener('starl-server-connection-state', (event) => {
		if (!(event && event.detail && event.detail.online)) return;
		const cached = loadLocalCache();
		if (!cached || !cached.pendingSync) return;
		const api = accountApi();
		if (api && typeof api.setSection === 'function')
			api.setSection(SECTION_NAME, cached.settings, {skipRefresh: true});
		saveLocalCache(cached.settings, false);
	});

	window.addEventListener('starl-account-state-updated', () => {
		const api = accountApi();
		const fromServer = api ? api.getSection(SECTION_NAME) : null;
		if (!fromServer || typeof fromServer !== 'object') return;
		if (JSON.stringify(fromServer) === JSON.stringify(liveSettings)) return;
		liveSettings = fromServer;
		if (reconcile(liveSettings)) persist(liveSettings);
		else saveLocalCache(liveSettings, false);
		applySettings(liveSettings);
		if (window.starlLyrics && typeof window.starlLyrics.reloadReferences === 'function') {
			window.starlLyrics.reloadReferences();
		}
	});

	/* ☆======= shared sheet bits =======☆ */

	function appendApplyResetRow(body, onApply, onReset) {
		const row = el('div', 'bsc-settings-row');
		const resetBtn = el('button', 'bsc-btn', 'Reset');
		resetBtn.type = 'button';
		resetBtn.addEventListener('click', onReset);
		const applyBtn = el('button', 'bsc-btn primary', 'Apply');
		applyBtn.type = 'button';
		applyBtn.addEventListener('click', onApply);
		row.appendChild(resetBtn);
		row.appendChild(applyBtn);
		body.appendChild(row);
	}

	// a standalone lyric preview - it reuses the real .mp-lyrics styling (and its data-hl-*
	// rules) via the .lyr-preview override, so every highlight option looks exactly as it
	// will on the player
	function buildPreview(draft) {
		const wrap = el('div', 'mp-lyrics lyr-preview');
		wrap.dataset.hlType = draft.highlightType;
		wrap.dataset.hlAnim = draft.highlightAnim === 'random' ? pickRandomAnim() : draft.highlightAnim;
		['the quiet before the words', 'this is the line you are on', 'and the next one waiting'].forEach((t, i) => {
			wrap.appendChild(el('div', 'mp-lyric-line' + (i === 1 ? ' active' : ''), t));
		});
		return wrap;
	}

	/* ☆======= font sheet =======☆ */

	function openFontSheet() {
		const draft = clone(liveSettings);
		window.starlBottomSheet.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'Lyrics font'));
				body.appendChild(buildPreview(draft));
				const list = el('div', 'appr-font-list');
				body.appendChild(list);
				getFontFamilies().forEach((family) => {
					const row = el('div', 'appr-font-row' + (draft.font === family ? ' is-selected' : ''));
					row.style.fontFamily = "'" + family + "'";
					row.appendChild(el('span', '', family));
					if (liveSettings.font === family) row.appendChild(el('span', 'appr-font-current', 'Current'));
					row.addEventListener('click', () => {
						draft.font = family;
						document.documentElement.style.setProperty(
							'--lyrics-font',
							"'" + family + "', var(--default-font)",
						);
						list.querySelectorAll('.appr-font-row').forEach((o) => o.classList.remove('is-selected'));
						row.classList.add('is-selected');
					});
					list.appendChild(row);
				});
				appendApplyResetRow(
					body,
					() => commit(draft, 'Lyrics font applied'),
					() => resetField('font'),
				);
			},
			onClose: () => applySettings(liveSettings),
		});
	}

	/* ☆======= font size sheet =======☆ */

	function openSizeSheet() {
		const draft = clone(liveSettings);
		window.starlBottomSheet.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'Lyrics font size'));
				body.appendChild(buildPreview(draft));
				const row = el('div', 'appr-slider-row lyr-size-row');
				const slider = document.createElement('input');
				slider.type = 'range';
				slider.className = 'appr-slider';
				slider.min = String(FONT_SIZE_MIN);
				slider.max = String(FONT_SIZE_MAX);
				slider.step = String(FONT_SIZE_STEP);
				slider.value = String(draft.fontSize);
				const readout = el('span', 'appr-transition-readout', draft.fontSize.toFixed(2) + 'rem');
				slider.addEventListener('input', () => {
					draft.fontSize = clampSize(Number(slider.value));
					readout.textContent = draft.fontSize.toFixed(2) + 'rem';
					document.documentElement.style.setProperty('--lyrics-font-size', draft.fontSize.toFixed(2) + 'rem');
				});
				row.appendChild(slider);
				row.appendChild(readout);
				body.appendChild(row);
				appendApplyResetRow(
					body,
					() => commit(draft, 'Lyrics size applied'),
					() => resetField('fontSize'),
				);
			},
			onClose: () => applySettings(liveSettings),
		});
	}

	/* ☆======= highlight style / animation sheets (radio-style option list) =======☆ */

	// cycles the highlighted line through the preview so the chosen animation actually plays
	function startPreviewCycle(preview) {
		const lines = preview.querySelectorAll('.mp-lyric-line');
		if (lines.length < 2) return 0;
		let idx = 1;
		return window.setInterval(() => {
			lines.forEach((l, i) => {
				l.classList.toggle('active', i === idx);
				l.classList.toggle('passed', i < idx);
			});
			idx = (idx + 1) % lines.length;
		}, 1200);
	}

	function openChoiceSheet(title, key, options, toastMsg) {
		const draft = clone(liveSettings);
		let previewTimer = 0;
		window.starlBottomSheet.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', title));
				const preview = buildPreview(draft);
				body.appendChild(preview);
				previewTimer = startPreviewCycle(preview);
				const list = el('div', 'lyr-choice-list');
				body.appendChild(list);
				options.forEach((opt) => {
					const row = el('div', 'lyr-choice-row' + (draft[key] === opt.id ? ' is-selected' : ''));
					const textWrap = el('div', 'lyr-choice-text');
					textWrap.appendChild(el('div', 'lyr-choice-label', opt.label));
					if (opt.desc) textWrap.appendChild(el('div', 'lyr-choice-sub', opt.desc));
					row.appendChild(textWrap);
					row.appendChild(el('span', 'lyr-choice-check'));
					row.addEventListener('click', () => {
						draft[key] = opt.id;
						// reflect the choice on the preview immediately
						if (key === 'highlightType') preview.dataset.hlType = opt.id;
						else preview.dataset.hlAnim = opt.id === 'random' ? pickRandomAnim() : opt.id;
						list.querySelectorAll('.lyr-choice-row').forEach((o) => o.classList.remove('is-selected'));
						row.classList.add('is-selected');
					});
					list.appendChild(row);
				});
				appendApplyResetRow(
					body,
					() => commit(draft, toastMsg),
					() => resetField(key),
				);
			},
			onClose: () => {
				if (previewTimer) clearInterval(previewTimer);
				applySettings(liveSettings);
			},
		});
	}

	/* ☆======= commit / reset =======☆ */

	function commit(draft, message) {
		liveSettings = clone(draft);
		persist(liveSettings);
		applySettings(liveSettings);
		window.starlBottomSheet.close();
		notify(message);
	}

	function resetField(key) {
		liveSettings[key] = DEFAULTS[key];
		persist(liveSettings);
		applySettings(liveSettings);
		window.starlBottomSheet.close();
		notify('Reset to default');
	}

	/* ☆======= quotes editor (references file) =======☆ */

	async function fetchDefaultFailText() {
		try {
			return await (await fetch(FAIL_TEXT_URL)).text();
		} catch (e) {
			return '';
		}
	}

	function sanitizeFailText(text) {
		const lines = String(text || '')
			.replace(/\r/g, '')
			.split('\n')
			.map((l) => l.replace(/[ \t]+$/, ''))
			.slice(0, MAX_QUOTE_LINES);
		while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
		return lines.join('\n');
	}

	async function openQuotesEditor() {
		const seed =
			liveSettings.failText && liveSettings.failText.trim()
				? liveSettings.failText
				: await fetchDefaultFailText();
		window.starlBottomSheet.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'Edit lyrics quotes'));
				body.appendChild(
					el(
						'div',
						'lyr-quotes-hint',
						'Up to 254 lines. Keep the "--- section ---" headers; a random line under each is shown when lyrics are loading or missing.',
					),
				);
				const ta = document.createElement('textarea');
				ta.className = 'lyr-quotes-textarea';
				ta.value = seed;
				ta.spellcheck = false;
				ta.autocapitalize = 'off';
				ta.autocomplete = 'off';
				body.appendChild(ta);

				const row = el('div', 'bsc-settings-row');
				const resetBtn = el('button', 'bsc-btn', 'Reset');
				resetBtn.type = 'button';
				resetBtn.addEventListener('click', async () => {
					ta.value = await fetchDefaultFailText();
				});
				const saveBtn = el('button', 'bsc-btn primary', 'Save');
				saveBtn.type = 'button';
				saveBtn.addEventListener('click', () => {
					liveSettings.failText = sanitizeFailText(ta.value);
					persist(liveSettings);
					if (window.starlLyrics && typeof window.starlLyrics.reloadReferences === 'function') {
						window.starlLyrics.reloadReferences();
					}
					window.starlBottomSheet.close();
					notify('Lyrics quotes saved');
				});
				row.appendChild(resetBtn);
				row.appendChild(saveBtn);
				body.appendChild(row);
			},
		});
	}

	/* ☆======= boot =======☆ */

	function wireButtons() {
		const map = {
			'lyrics-font-item': openFontSheet,
			'lyrics-size-item': openSizeSheet,
			'lyrics-highlight-item': () =>
				openChoiceSheet('Highlight style', 'highlightType', HIGHLIGHT_TYPES, 'Highlight style applied'),
			'lyrics-anim-item': () =>
				openChoiceSheet('Highlight animation', 'highlightAnim', HIGHLIGHT_ANIMS, 'Highlight animation applied'),
			'lyrics-quotes-item': openQuotesEditor,
		};
		Object.keys(map).forEach((id) => {
			const node = document.getElementById(id);
			if (node) node.addEventListener('click', map[id]);
		});
	}

	function init() {
		const cached = loadLocalCache();
		if (cached) {
			liveSettings = cached.settings;
		} else {
			const api = accountApi();
			const fromServer = api ? api.getSection(SECTION_NAME) : null;
			if (fromServer && typeof fromServer === 'object') {
				liveSettings = fromServer;
				saveLocalCache(liveSettings, false);
			} else {
				liveSettings = clone(DEFAULTS);
			}
		}
		if (reconcile(liveSettings)) persist(liveSettings);
		applySettings(liveSettings);
		wireButtons();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}

	/* ☆======= public API =======☆ */

	window.starlLyricsSettings = {applySettings, onSongOpen, getFailTextOverride: () => liveSettings.failText || ''};
})();

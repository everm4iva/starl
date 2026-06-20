/**
 * ☆=========================================☆
 * Appearance settings - colors, fonts, transitions
 * Lets the user customize the look of the app from root.css's own custom
 * properties. Nothing here is a hand-copied list: colors, fonts and
 * transition vars are all discovered by reading the live stylesheets, so
 * root.css stays the single source of truth.
 *
 * --- What this file does? ---
 * - Discovers customizable vars: every non-transparent color custom property,
 *   every '--anim-*' transition property, and every @font-face family
 * - Opens a bottom sheet per setting ("Set colors" / "Set transitions" / "Set font")
 *   with live preview, an Apply button, and a Reset-to-default button
 * - Recomputes the matching '-transparent-N' variables whenever a base color changes
 * - Persists the chosen settings under the 'appearance' section of starlAccountState,
 *   so they live in the user's own server-side state file and sync across devices
 * - Keeps working offline: settings are cached in localStorage and re-applied on
 *   boot; once the server becomes reachable again the cached settings are re-sent
 *
 * --- Dictionary / Terms / Extra details ---
 * - "factory" = the default values declared in root.css itself (used by Reset)
 * - transparent suffix N maps to alpha hex N * 0x11 (root.css already follows this:
 *   2->22, 4->44, 6->66, 8->88), so new transparent values are derived, not guessed
 * ☆=========================================☆
 */

(function () {
	const SECTION_NAME = 'appearance';
	const LOCAL_KEY = 'starl_appearance_settings';
	const TRANSITION_TYPES = ['linear', 'ease'];
	const TRANSITION_MIN_MS = 0;
	const TRANSITION_MAX_MS = 10000;
	const TRANSITION_STEP_MS = 50;

	let factory = {rootDecls: new Map(), fontFamilies: []};
	let liveSettings = null;

	/* ☆======= CSSOM discovery (var/font lists) =======☆ */

	function collectSheetRules(sheet, rootDecls, fontFamilies, seen) {
		if (!sheet || seen.has(sheet)) return;
		seen.add(sheet);
		let rules;
		try {
			rules = sheet.cssRules;
		} catch (error) {
			return;
		}
		if (!rules) return;
		for (const rule of rules) {
			if (rule instanceof CSSImportRule) {
				collectSheetRules(rule.styleSheet, rootDecls, fontFamilies, seen);
			} else if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
				for (let i = 0; i < rule.style.length; i++) {
					const prop = rule.style[i];
					rootDecls.set(prop, rule.style.getPropertyValue(prop).trim());
				}
			} else if (rule instanceof CSSFontFaceRule) {
				const family = rule.style
					.getPropertyValue('font-family')
					.replace(/^['"]|['"]$/g, '')
					.trim();
				if (family && !fontFamilies.includes(family)) {
					fontFamilies.push(family);
				}
			}
		}
	}

	function discoverRootCss() {
		const rootDecls = new Map();
		const fontFamilies = [];
		const seen = new Set();
		for (const sheet of document.styleSheets) {
			collectSheetRules(sheet, rootDecls, fontFamilies, seen);
		}
		return {rootDecls, fontFamilies};
	}

	const NON_COLOR_VALUE_RE = /^(unset|initial|inherit|revert|revert-layer)$/i;
	const COMPUTED_VALUE_RE = /\b(env|max|min|calc|clamp)\(/;

	function getColorVarNames() {
		const names = [];
		factory.rootDecls.forEach((value, key) => {
			if (key.includes('transparent')) return;
			if (key.startsWith('--anim-')) return;
			if (key === '--font-color') return; // base text color stays fixed for legibility
			const trimmed = value.trim();
			if (!trimmed || NON_COLOR_VALUE_RE.test(trimmed)) return; // runtime-assigned placeholders (--artist1, --album1, ...)
			if (trimmed === 'transparent') return; // intentionally invisible containers (--container-bg)
			if (COMPUTED_VALUE_RE.test(trimmed)) return; // computed layout values, not real colors (--status-bar-space)
			let isColor = false;
			try {
				isColor = CSS.supports('color', trimmed);
			} catch (error) {}
			if (isColor) names.push(key);
		});
		return names;
	}

	function getTransitionVarNames() {
		const names = [];
		factory.rootDecls.forEach((_value, key) => {
			if (key.startsWith('--anim-')) names.push(key);
		});
		return names;
	}

	function getTransparentSuffixes(baseName) {
		const prefix = baseName + '-transparent-';
		const suffixes = [];
		factory.rootDecls.forEach((_value, key) => {
			if (key.startsWith(prefix)) {
				const n = Number(key.slice(prefix.length));
				if (Number.isFinite(n)) suffixes.push(n);
			}
		});
		return suffixes;
	}

	/* ☆======= color math =======☆ */

	function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	function rgbToHex(r, g, b) {
		return (
			'#' + [r, g, b].map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')
		);
	}

	function hexToRgb(hex) {
		let normalized = String(hex || '').replace('#', '');
		if (normalized.length === 3) {
			normalized = normalized
				.split('')
				.map((c) => c + c)
				.join('');
		}
		const num = parseInt(normalized, 16) || 0;
		return {r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255};
	}

	function rgbToHsl(r, g, b) {
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let h = 0;
		let s = 0;
		const l = (max + min) / 2;
		const delta = max - min;
		if (delta !== 0) {
			s = delta / (1 - Math.abs(2 * l - 1));
			switch (max) {
				case r:
					h = ((g - b) / delta) % 6;
					break;
				case g:
					h = (b - r) / delta + 2;
					break;
				default:
					h = (r - g) / delta + 4;
			}
			h *= 60;
			if (h < 0) h += 360;
		}
		return {h, s: s * 100, l: l * 100};
	}

	function hslToRgb(h, s, l) {
		s /= 100;
		l /= 100;
		const c = (1 - Math.abs(2 * l - 1)) * s;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = l - c / 2;
		let r = 0;
		let g = 0;
		let b = 0;
		if (h < 60) [r, g, b] = [c, x, 0];
		else if (h < 120) [r, g, b] = [x, c, 0];
		else if (h < 180) [r, g, b] = [0, c, x];
		else if (h < 240) [r, g, b] = [0, x, c];
		else if (h < 300) [r, g, b] = [x, 0, c];
		else [r, g, b] = [c, 0, x];
		return {r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255};
	}

	function colorToHex(value) {
		const probe = document.createElement('div');
		probe.style.display = 'none';
		probe.style.color = value;
		document.body.appendChild(probe);
		const computed = getComputedStyle(probe).color;
		document.body.removeChild(probe);
		const numbers = computed.match(/[\d.]+/g);
		if (!numbers || numbers.length < 3) return '#000000';
		return rgbToHex(Number(numbers[0]), Number(numbers[1]), Number(numbers[2]));
	}

	function buildTransparentValue(hex, alphaUnit) {
		const alphaHex = clamp(Math.round(alphaUnit * 17), 0, 255)
			.toString(16)
			.padStart(2, '0');
		return hex + alphaHex;
	}

	/* ☆======= transition value parsing =======☆ */

	const DURATION_RE = /(\d*\.?\d+)(ms|s)\b/;
	const EASING_RE = /\b(linear|ease-in-out|ease-in|ease-out|ease|step-start|step-end|cubic-bezier\([^)]*\))\b/;

	function parseTransitionValue(value) {
		const durationMatch = value.match(DURATION_RE);
		const easingMatch = value.match(EASING_RE);
		let ms = 0;
		if (durationMatch) {
			const num = parseFloat(durationMatch[1]);
			ms = durationMatch[2] === 's' ? num * 1000 : num;
		}
		let type = easingMatch ? easingMatch[1] : 'ease';
		if (!TRANSITION_TYPES.includes(type)) type = 'ease';
		return {ms: clamp(ms, TRANSITION_MIN_MS, TRANSITION_MAX_MS), type};
	}

	function buildTransitionValue(rawDeclaredValue, ms, type) {
		const durationText = ms % 1000 === 0 ? ms / 1000 + 's' : Math.round(ms) + 'ms';
		let next = rawDeclaredValue;
		next = DURATION_RE.test(next) ? next.replace(DURATION_RE, durationText) : next + ' ' + durationText;
		next = EASING_RE.test(next) ? next.replace(EASING_RE, type) : next + ' ' + type;
		return next;
	}

	/* ☆======= apply to document =======☆ */

	function applyColor(name, value) {
		const hex = colorToHex(value);
		document.documentElement.style.setProperty(name, hex);
		getTransparentSuffixes(name).forEach((n) => {
			document.documentElement.style.setProperty(name + '-transparent-' + n, buildTransparentValue(hex, n));
		});
		return hex;
	}

	function applyTransition(name, entry) {
		const raw = factory.rootDecls.get(name) || '';
		document.documentElement.style.setProperty(name, buildTransitionValue(raw, entry.ms, entry.type));
	}

	function getDefaultFontFallbackChain() {
		const raw = factory.rootDecls.get('--default-font') || '';
		return raw.split(',').map((part) => part.trim());
	}

	function applyFont(fontName) {
		const fallback = getDefaultFontFallbackChain().slice(1);
		document.documentElement.style.setProperty('--default-font', ["'" + fontName + "'", ...fallback].join(', '));
	}

	function applySettings(settings) {
		if (!settings) return;
		Object.keys(settings.colors || {}).forEach((name) => applyColor(name, settings.colors[name]));
		if (settings.font) applyFont(settings.font);
		Object.keys(settings.transitions || {}).forEach((name) => applyTransition(name, settings.transitions[name]));
	}

	/* ☆======= defaults =======☆ */

	function buildFactoryDefaults() {
		const colors = {};
		getColorVarNames().forEach((name) => {
			colors[name] = colorToHex(factory.rootDecls.get(name));
		});
		const transitions = {};
		getTransitionVarNames().forEach((name) => {
			transitions[name] = parseTransitionValue(factory.rootDecls.get(name) || '');
		});
		const fontRaw = factory.rootDecls.get('--default-font') || '';
		const font = fontRaw
			.split(',')[0]
			.trim()
			.replace(/^['"]|['"]$/g, '');
		return {colors, font, transitions};
	}

	/* ☆======= store =======☆ */

	function deepClone(value) {
		return JSON.parse(JSON.stringify(value));
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

	window.addEventListener('starl-account-state-updated', () => {
		const api = getAccountStateApi();
		const fromServer = api ? api.getSection(SECTION_NAME) : null;
		if (!fromServer || typeof fromServer !== 'object') return;
		if (JSON.stringify(fromServer) === JSON.stringify(liveSettings)) return;
		liveSettings = fromServer;
		if (reconcileSettings(liveSettings)) {
			persist(liveSettings);
		} else {
			saveLocalCache(liveSettings, false);
		}
		applySettings(liveSettings);
	});

	/* ☆======= UI helpers =======☆ */

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function formatLabel(varName, stripPrefix) {
		return varName
			.replace(/^--/, '')
			.replace(stripPrefix || '', '')
			.split('-')
			.filter(Boolean)
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	}

	function formatSeconds(ms) {
		return (ms / 1000).toFixed(2) + 's';
	}

	function appendApplyResetRow(body, handlers) {
		const row = el('div', 'bsc-settings-row');
		const resetBtn = el('button', 'bsc-btn', 'Reset');
		resetBtn.type = 'button';
		resetBtn.addEventListener('click', handlers.onReset);
		const applyBtn = el('button', 'bsc-btn primary', 'Apply');
		applyBtn.type = 'button';
		applyBtn.addEventListener('click', handlers.onApply);
		row.appendChild(resetBtn);
		row.appendChild(applyBtn);
		body.appendChild(row);
	}

	function notify(message) {
		if (typeof window.showToast === 'function') {
			window.showToast(message, 'success');
		}
	}

	/* ☆======= colors sheet =======☆ */

	function buildColorPanel(panel, name, draft, swatch) {
		const rgb = hexToRgb(draft.colors[name]);
		const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
		const sliders = {};
		const config = {h: {max: 360, label: 'H'}, s: {max: 100, label: 'S'}, l: {max: 100, label: 'L'}};

		Object.keys(config).forEach((channel) => {
			const row = el('div', 'appr-slider-row');
			row.appendChild(el('div', 'appr-slider-label', config[channel].label));
			const input = document.createElement('input');
			input.type = 'range';
			input.className = 'appr-slider';
			input.min = '0';
			input.max = String(config[channel].max);
			input.step = '1';
			input.value = String(Math.round(hsl[channel]));
			row.appendChild(input);
			panel.appendChild(row);
			sliders[channel] = input;
			input.addEventListener('input', updateFromSliders);
		});

		function updateFromSliders() {
			const next = hslToRgb(Number(sliders.h.value), Number(sliders.s.value), Number(sliders.l.value));
			const hex = rgbToHex(next.r, next.g, next.b);
			draft.colors[name] = hex;
			swatch.style.backgroundColor = hex;
			applyColor(name, hex);
		}
	}

	function makeColorPanelController(draft) {
		let openPanel = null;

		function commitDraft() {
			liveSettings = deepClone(draft);
			persist(liveSettings);
		}

		function closeCurrent() {
			if (!openPanel) return;
			openPanel.classList.add('hidden');
			openPanel = null;
			commitDraft();
		}

		function toggle(panel) {
			if (openPanel === panel) {
				closeCurrent();
				return;
			}
			closeCurrent();
			panel.classList.remove('hidden');
			openPanel = panel;
		}

		return {toggle, closeCurrent};
	}

	function renderColorRow(list, name, draft, panelController) {
		const row = el('div', 'appr-color-row');
		row.appendChild(el('div', 'appr-color-label', formatLabel(name)));
		const swatch = el('div', 'appr-color-swatch');
		swatch.style.backgroundColor = draft.colors[name];
		row.appendChild(swatch);
		list.appendChild(row);

		const panel = el('div', 'appr-color-panel hidden');
		list.appendChild(panel);
		let built = false;

		row.addEventListener('click', () => {
			if (!built) {
				buildColorPanel(panel, name, draft, swatch);
				built = true;
			}
			panelController.toggle(panel);
		});
	}

	function openColorsSheet() {
		const draft = deepClone(liveSettings);
		const panelController = makeColorPanelController(draft);
		window.starlBottomSheet.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'Set colors'));
				const list = el('div', 'appr-color-list');
				body.appendChild(list);
				getColorVarNames().forEach((name) => renderColorRow(list, name, draft, panelController));
				appendApplyResetRow(body, {
					onApply() {
						liveSettings = deepClone(draft);
						persist(liveSettings);
						window.starlBottomSheet.close();
						notify('Colors applied');
					},
					onReset() {
						liveSettings = deepClone(liveSettings);
						liveSettings.colors = buildFactoryDefaults().colors;
						applySettings(liveSettings);
						persist(liveSettings);
						window.starlBottomSheet.close();
						notify('Colors reset');
					},
				});
			},
			onClose() {
				panelController.closeCurrent();
				applySettings(liveSettings);
			},
		});
	}

	/* ☆======= transitions sheet =======☆ */

	function renderTransitionRow(list, name, draft) {
		const entry = draft.transitions[name];
		const row = el('div', 'appr-transition-row');
		row.appendChild(el('div', 'appr-transition-label', formatLabel(name, 'anim-')));

		const controls = el('div', 'appr-transition-controls');
		const slider = document.createElement('input');
		slider.type = 'range';
		slider.className = 'appr-slider';
		slider.min = String(TRANSITION_MIN_MS);
		slider.max = String(TRANSITION_MAX_MS);
		slider.step = String(TRANSITION_STEP_MS);
		slider.value = String(entry.ms);

		const readout = el('span', 'appr-transition-readout', formatSeconds(entry.ms));

		const select = document.createElement('select');
		select.className = 'appr-transition-type';
		TRANSITION_TYPES.forEach((type) => {
			const option = document.createElement('option');
			option.value = type;
			option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
			if (entry.type === type) option.selected = true;
			select.appendChild(option);
		});

		function applyLive() {
			entry.ms = Number(slider.value);
			entry.type = select.value;
			readout.textContent = formatSeconds(entry.ms);
			applyTransition(name, entry);
		}
		slider.addEventListener('input', applyLive);
		select.addEventListener('change', applyLive);

		controls.appendChild(slider);
		controls.appendChild(readout);
		controls.appendChild(select);
		row.appendChild(controls);
		list.appendChild(row);
	}

	function openTransitionsSheet() {
		const draft = deepClone(liveSettings);
		window.starlBottomSheet.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'Set transitions'));
				const list = el('div', 'appr-transition-list');
				body.appendChild(list);
				getTransitionVarNames().forEach((name) => renderTransitionRow(list, name, draft));
				appendApplyResetRow(body, {
					onApply() {
						liveSettings = deepClone(draft);
						persist(liveSettings);
						window.starlBottomSheet.close();
						notify('Transitions applied');
					},
					onReset() {
						liveSettings = deepClone(liveSettings);
						liveSettings.transitions = buildFactoryDefaults().transitions;
						applySettings(liveSettings);
						persist(liveSettings);
						window.starlBottomSheet.close();
						notify('Transitions reset');
					},
				});
			},
			onClose() {
				applySettings(liveSettings);
			},
		});
	}

	/* ☆======= font sheet =======☆ */

	function openFontSheet() {
		const draft = deepClone(liveSettings);
		window.starlBottomSheet.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'Set font'));
				const list = el('div', 'appr-font-list');
				body.appendChild(list);

				factory.fontFamilies.forEach((family) => {
					const row = el('div', 'appr-font-row' + (draft.font === family ? ' is-selected' : ''));
					row.style.fontFamily = "'" + family + "'";
					row.appendChild(el('span', '', family));
					if (liveSettings.font === family) {
						row.appendChild(el('span', 'appr-font-current', 'Current'));
					}
					row.addEventListener('click', () => {
						draft.font = family;
						applyFont(family);
						list.querySelectorAll('.appr-font-row').forEach((other) =>
							other.classList.remove('is-selected'),
						);
						row.classList.add('is-selected');
					});
					list.appendChild(row);
				});

				appendApplyResetRow(body, {
					onApply() {
						liveSettings = deepClone(draft);
						persist(liveSettings);
						window.starlBottomSheet.close();
						notify('Font applied');
					},
					onReset() {
						liveSettings = deepClone(liveSettings);
						liveSettings.font = buildFactoryDefaults().font;
						applySettings(liveSettings);
						persist(liveSettings);
						window.starlBottomSheet.close();
						notify('Font reset');
					},
				});
			},
			onClose() {
				applySettings(liveSettings);
			},
		});
	}

	/* ☆======= keep settings in step with root.css =======☆ */

	// variables get added/removed from root.css over time. backfill anything missing
	// from a previously-saved settings object so an old cache never shows up as
	// black/blank for a var that didn't exist yet when it was first saved.
	function reconcileSettings(settings) {
		const defaults = buildFactoryDefaults();
		let changed = false;

		if (!settings.colors || typeof settings.colors !== 'object') {
			settings.colors = {};
			changed = true;
		}
		Object.keys(defaults.colors).forEach((name) => {
			if (!(name in settings.colors)) {
				settings.colors[name] = defaults.colors[name];
				changed = true;
			}
		});

		if (!settings.transitions || typeof settings.transitions !== 'object') {
			settings.transitions = {};
			changed = true;
		}
		Object.keys(defaults.transitions).forEach((name) => {
			if (!(name in settings.transitions)) {
				settings.transitions[name] = defaults.transitions[name];
				changed = true;
			}
		});

		if (!settings.font) {
			settings.font = defaults.font;
			changed = true;
		}

		return changed;
	}

	/* ☆======= boot it up =======☆ */

	function wireButtons() {
		const colorsItem = document.getElementById('appearance-colors-item');
		const transitionsItem = document.getElementById('appearance-transitions-item');
		const fontItem = document.getElementById('appearance-font-item');
		if (colorsItem) colorsItem.addEventListener('click', openColorsSheet);
		if (transitionsItem) transitionsItem.addEventListener('click', openTransitionsSheet);
		if (fontItem) fontItem.addEventListener('click', openFontSheet);
	}

	function init() {
		factory = discoverRootCss();

		const cached = loadLocalCache();
		if (cached) {
			liveSettings = cached.settings;
		} else {
			const api = getAccountStateApi();
			const fromServer = api ? api.getSection(SECTION_NAME) : null;
			if (fromServer && typeof fromServer === 'object') {
				liveSettings = fromServer;
				saveLocalCache(liveSettings, false);
			} else {
				liveSettings = buildFactoryDefaults();
				persist(liveSettings);
			}
		}

		if (reconcileSettings(liveSettings)) {
			persist(liveSettings);
		}

		applySettings(liveSettings);
		wireButtons();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}
})();

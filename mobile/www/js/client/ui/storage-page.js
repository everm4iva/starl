/**
 * ☆=========================================☆
 * Storage page - the "Manage storage" overlay
 * A full-screen page opened from the account tab. Shows one stacked bar of where
 * storage goes (music/image caches, their reserved headroom, user + app storage,
 * free space) and lets the user set the caps and overflow actions. All the math,
 * persistence and enforcement lives in data/storage.js - this file is UI only.
 *
 * --- What this file does? ---
 * - open() / close() / goBack(): show/hide the overlay (one internal sub-view for
 *   the "Total size" setting, so goBack pops to the main view before closing)
 * - Builds the stacked .storage-bar + a legend, refreshed from collectSnapshot()
 * - Renders the setting dropdowns (percent sliders + overflow-action choices),
 *   writing changes back through window.starlStorageManager.setSettings()
 *
 * --- Dictionary / Terms / Extra details ---
 * - Segment widths come from a live snapshot (bytes); colors come from the
 *   --storage-color-* vars in root.css - nothing visual is hardcoded here
 * ☆=========================================☆
 */

(function () {
	const GB = 1024 * 1024 * 1024;

	// bar segments, drawn left to right. color comes from the matching CSS class
	const SEGMENTS = [
		{id: 'music', cls: 'music-spent', label: 'Music cache'},
		{id: 'image', cls: 'image-spent', label: 'Image cache'},
		{id: 'user', cls: 'user', label: 'User storage'},
		{id: 'app', cls: 'color-app', label: 'App storage'},
		{id: 'musicAllow', cls: 'music-allow', label: 'Music headroom'},
		{id: 'imageAllow', cls: 'image-allow', label: 'Image headroom'},
		{id: 'free', cls: 'free', label: 'Free storage'},
	];

	const OVERFLOW_CHOICES = [
		{
			id: 'delete-all',
			cls: 'danger',
			label: 'Delete all',
			note: 'Wipes this whole cache the moment it fills up. Nothing is kept.',
		},
		{
			id: 'remove-older',
			label: 'Remove older',
			note: 'Deletes the oldest cached items first, just until it fits again. (default)',
		},
		{
			id: 'compress',
			cls: 'warn',
			label: 'Compress all',
			note: 'Shrinks cached images to reclaim room (music can’t be compressed, so it removes older instead). Can cause quality loss.',
		},
		{
			id: 'no-cache',
			label: 'Don’t cache anymore',
			note: 'Stops caching new items once the limit is hit. Nothing already saved is deleted.',
		},
	];

	let overlayEl = null;
	let titleEl = null;
	let mainViewEl = null;
	let barEl = null;
	let legendEl = null;
	let lastSnapshot = null;
	let totalValueEl = null; // the "Device storage" / "12 GB" / "Full storage" readout on the Total size row
	let totalMenuEl = null; // the open context menu, if any

	/* ☆======= tiny DOM helper (matches appearence.js / playback-prefs.js) =======☆ */

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function manager() {
		return window.starlStorageManager || null;
	}

	function formatBytes(bytes) {
		let value = Number(bytes) || 0;
		if (value < 1024) return value + ' B';
		const units = ['KB', 'MB', 'GB', 'TB'];
		let unit = -1;
		do {
			value /= 1024;
			unit++;
		} while (value >= 1024 && unit < units.length - 1);
		return value.toFixed(value < 10 ? 1 : 0) + ' ' + units[unit];
	}

	/* ☆======= bar math =======☆ */

	// turn a raw snapshot into {id -> bytes} for each segment (summing to the bar total)
	function segmentBytes(snap) {
		const appOther = Math.max(0, snap.appBytes - snap.musicBytes - snap.imageBytes - snap.userBytes);
		const musicAllow = Math.max(0, snap.musicCapBytes - snap.musicBytes);
		const imageAllow = Math.max(0, snap.imageCapBytes - snap.imageBytes);
		return {
			music: snap.musicBytes,
			image: snap.imageBytes,
			user: snap.userBytes,
			app: appOther,
			musicAllow,
			imageAllow,
			free: snap.freeBytes,
		};
	}

	function barTotalBytes(snap, bytesById) {
		// prefer the device total; fall back to the sum of the parts if unknown
		if (snap.totalBytes > 0) return snap.totalBytes;
		return Object.keys(bytesById).reduce((total, id) => total + bytesById[id], 0) || 1;
	}

	function renderBar(snap) {
		if (!barEl || !legendEl) return;
		barEl.textContent = '';
		legendEl.textContent = '';

		const bytesById = segmentBytes(snap);
		const total = barTotalBytes(snap, bytesById);

		// the free segment fills whatever's left so the bar never overflows 100%
		// (its legend still shows the true free bytes)
		let othersSum = 0;
		SEGMENTS.forEach((seg) => {
			if (seg.id !== 'free') othersSum += bytesById[seg.id] || 0;
		});
		const freeWidthBytes = Math.max(0, total - othersSum);

		SEGMENTS.forEach((seg) => {
			const bytes = bytesById[seg.id] || 0;
			const widthBytes = seg.id === 'free' ? freeWidthBytes : bytes;
			const pct = Math.max(0, Math.min(100, (widthBytes / total) * 100));

			const bar = el('div', 'storage-seg ' + seg.cls);
			bar.style.setProperty('--seg-pct', pct.toFixed(3) + '%');
			barEl.appendChild(bar);

			const entry = el('div', 'storage-legend-item');
			entry.appendChild(el('span', 'storage-legend-dot ' + seg.cls));
			entry.appendChild(el('span', 'storage-legend-label', seg.label));
			entry.appendChild(el('span', 'storage-legend-value', formatBytes(bytes)));
			legendEl.appendChild(entry);
		});
	}

	/* ☆======= main view: settings rows =======☆ */

	function makeItemRow(iconCls, text, navCls) {
		const item = el('div', 'item');
		item.appendChild(el('div', 'item-icon ' + iconCls));
		item.appendChild(el('div', 'item-text', text));
		item.appendChild(el('div', 'item-navtype' + (navCls ? ' ' + navCls : '')));
		return item;
	}

	// a settings row that expands an inline panel when its header is tapped
	function makeDropdown(iconCls, text, buildPanel) {
		const wrap = el('div', 'storage-drop');
		const header = makeItemRow(iconCls, text, 'drop');
		const panel = el('div', 'storage-drop-panel hidden');
		buildPanel(panel);
		header.addEventListener('click', () => {
			const open = panel.classList.toggle('hidden');
			header.classList.toggle('is-open', !open);
		});
		wrap.appendChild(header);
		wrap.appendChild(panel);
		return wrap;
	}

	function makePercentPanel(kind) {
		return function (panel) {
			panel.appendChild(
				el(
					'div',
					'storage-drop-desc',
					kind === 'music'
						? 'How much of the total size the downloaded music may fill.'
						: 'How much of the total size the cached artwork may fill.',
				),
			);
			const row = el('div', 'storage-slider-row');
			const slider = document.createElement('input');
			slider.type = 'range';
			slider.className = 'appr-slider storage-slider';
			slider.min = '0';
			slider.max = '100';
			slider.step = '1';
			const readout = el('span', 'storage-slider-readout');
			row.appendChild(slider);
			row.appendChild(readout);
			panel.appendChild(row);

			function syncReadout() {
				const pct = Number(slider.value);
				const mgr = manager();
				if (mgr && mgr.getSettings().totalMode === 'full') {
					readout.textContent = pct + '%  (no limit)';
					return;
				}
				const cap = lastSnapshot ? Math.round((pct / 100) * lastSnapshot.budgetBytes) : 0;
				readout.textContent = pct + '%  (' + formatBytes(cap) + ')';
			}

			slider.dataset.kind = kind;
			slider.classList.add('js-pct-slider');
			slider.addEventListener('input', syncReadout);
			slider.addEventListener('change', () => {
				const patch = {};
				patch[kind + 'Pct'] = Number(slider.value);
				manager().setSettings(patch);
			});
			slider._syncReadout = syncReadout;
		};
	}

	function makeActionPanel(kind) {
		return function (panel) {
			panel.appendChild(
				el(
					'div',
					'storage-drop-desc',
					'What happens when the ' + (kind === 'music' ? 'music' : 'image') + ' cache overflows its limit.',
				),
			);
			const list = el('div', 'sq-mode-list');
			OVERFLOW_CHOICES.forEach((choice) => {
				const row = el('div', 'sq-mode-row storage-action-row' + (choice.cls ? ' ' + choice.cls : ''));
				row.dataset.action = choice.id;
				row.dataset.kind = kind;
				row.appendChild(el('div', 'sq-mode-label', choice.label));
				row.appendChild(el('div', 'sq-mode-note', choice.note));
				row.addEventListener('click', () => {
					const patch = {};
					patch[kind + 'OverflowAction'] = choice.id;
					manager().setSettings(patch);
				});
				list.appendChild(row);
			});
			panel.appendChild(list);
		};
	}

	function buildSettings(container) {
		const section = el('div', 'section', 'Storage settings');
		const box = el('div', 'box');

		// total size opens a small context menu (device / fixed / full)
		buildTotalSizeRow(box);

		box.appendChild(makeDropdown('image-cache', 'Image cache', makePercentPanel('image')));
		box.appendChild(makeDropdown('music-cache', 'Music cache', makePercentPanel('music')));
		box.appendChild(makeDropdown('image-action', 'Image limit action', makeActionPanel('image')));
		box.appendChild(makeDropdown('music-action', 'Music limit action', makeActionPanel('music')));

		section.appendChild(box);
		container.appendChild(section);
	}

	/* ☆======= total-size row + context menu =======☆ */

	let fixedSliderEl = null;
	let fixedReadoutEl = null;
	let fixedWrapEl = null;

	function totalModeLabel(settings) {
		if (settings.totalMode === 'full') return 'Full storage';
		if (settings.totalMode === 'fixed') return Math.max(1, Math.round(settings.totalGbBytes / GB)) + ' GB';
		return 'Device storage';
	}

	// the Total size row: a normal settings row that pops a context menu + an inline
	// GB slider that only shows while "Fixed size" is the chosen mode
	function buildTotalSizeRow(box) {
		const row = el('div', 'item storage-total-row');
		row.appendChild(el('div', 'item-icon storage'));
		row.appendChild(el('div', 'item-text', 'Total size'));
		totalValueEl = el('div', 'storage-total-value');
		row.appendChild(totalValueEl);
		row.appendChild(el('div', 'item-navtype'));
		row.addEventListener('click', (e) => {
			e.stopPropagation();
			openTotalMenu(row);
		});
		box.appendChild(row);

		fixedWrapEl = el('div', 'storage-drop-panel storage-fixed-panel hidden');
		fixedWrapEl.appendChild(
			el('div', 'storage-drop-desc', 'The fixed total that the image and music caps are a percentage of.'),
		);
		const sliderRow = el('div', 'storage-slider-row');
		fixedSliderEl = document.createElement('input');
		fixedSliderEl.type = 'range';
		fixedSliderEl.className = 'appr-slider storage-slider';
		fixedSliderEl.min = '1';
		fixedSliderEl.step = '1';
		fixedReadoutEl = el('span', 'storage-slider-readout');
		sliderRow.appendChild(fixedSliderEl);
		sliderRow.appendChild(fixedReadoutEl);
		fixedWrapEl.appendChild(sliderRow);
		box.appendChild(fixedWrapEl);

		fixedSliderEl.addEventListener('input', () => {
			fixedReadoutEl.textContent = fixedSliderEl.value + ' GB';
		});
		fixedSliderEl.addEventListener('change', () => {
			manager().setSettings({totalMode: 'fixed', totalGbBytes: Number(fixedSliderEl.value) * GB});
		});
	}

	function closeTotalMenu() {
		if (totalMenuEl) totalMenuEl.remove();
		totalMenuEl = null;
	}

	function openTotalMenu(anchor) {
		closeTotalMenu();
		const menu = el('div', 'context-menu storage-total-menu');

		function option(label, onPick) {
			const button = el('button', 'context-menu-button', label);
			button.type = 'button';
			button.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				closeTotalMenu();
				onPick();
			});
			menu.appendChild(button);
		}

		option('Full storage (no limits)', () => manager().setSettings({totalMode: 'full'}));
		option('Device storage', () => manager().setSettings({totalMode: 'device'}));
		option('Fixed size', () => {
			const current = manager().getSettings();
			const patch = {totalMode: 'fixed'};
			// never switch to fixed with a 0 total - that would make every cap resolve to 0
			// and wipe the caches. seed it with the current free space instead
			if (!(current.totalGbBytes > 0)) {
				const freeGb = lastSnapshot ? Math.floor(lastSnapshot.freeBytes / GB) : 0;
				patch.totalGbBytes = Math.max(1, freeGb) * GB;
			}
			manager().setSettings(patch);
		});

		document.body.appendChild(menu);
		totalMenuEl = menu;

		const rect = anchor.getBoundingClientRect();
		menu.style.top = String(rect.bottom + 5) + 'px';
		menu.style.left = String(Math.max(8, rect.right - menu.offsetWidth)) + 'px';

		window.addEventListener('click', closeTotalMenu, {once: true});
	}

	/* ☆======= build once =======☆ */

	function ensureDOM() {
		if (overlayEl) return;

		overlayEl = el('div', 'storage-page hidden');

		const topbar = el('div', 'storage-topbar');
		const back = el('div', 'storage-back');
		back.addEventListener('click', goBack);
		titleEl = el('div', 'storage-title', 'Manage storage');
		topbar.appendChild(back);
		topbar.appendChild(titleEl);
		overlayEl.appendChild(topbar);

		const scroll = el('div', 'storage-scroll');

		mainViewEl = el('div', 'storage-view');
		const barWrap = el('div', 'storage-bar-wrap');
		barEl = el('div', 'storage-bar');
		legendEl = el('div', 'storage-legend');
		barWrap.appendChild(barEl);
		barWrap.appendChild(legendEl);
		mainViewEl.appendChild(barWrap);
		buildSettings(mainViewEl);
		scroll.appendChild(mainViewEl);

		overlayEl.appendChild(scroll);
		document.body.appendChild(overlayEl);
	}

	/* ☆======= refresh dynamic bits from a fresh snapshot =======☆ */

	function syncControls() {
		const mgr = manager();
		if (!mgr || !lastSnapshot) return;
		const settings = mgr.getSettings();

		overlayEl.querySelectorAll('.js-pct-slider').forEach((slider) => {
			const kind = slider.dataset.kind;
			slider.value = String(kind === 'music' ? settings.musicPct : settings.imagePct);
			if (typeof slider._syncReadout === 'function') slider._syncReadout();
		});

		overlayEl.querySelectorAll('.storage-action-row').forEach((row) => {
			const active = settings[row.dataset.kind + 'OverflowAction'] === row.dataset.action;
			row.classList.toggle('is-selected', active);
		});

		if (totalValueEl) totalValueEl.textContent = totalModeLabel(settings);

		if (fixedSliderEl && fixedWrapEl) {
			const maxGb = Math.max(1, Math.floor(lastSnapshot.freeBytes / GB) || 1);
			fixedSliderEl.max = String(maxGb);
			fixedSliderEl.value = String(Math.min(maxGb, Math.max(1, Math.round(settings.totalGbBytes / GB))));
			fixedReadoutEl.textContent = fixedSliderEl.value + ' GB';
			// the inline GB slider only makes sense while "Fixed size" is chosen
			fixedWrapEl.classList.toggle('hidden', settings.totalMode !== 'fixed');
		}
	}

	function refresh() {
		const mgr = manager();
		if (!mgr) return;
		mgr.collectSnapshot().then((snap) => {
			lastSnapshot = snap;
			renderBar(snap);
			syncControls();
		});
	}

	/* ☆======= open / close / back =======☆ */

	function open() {
		ensureDOM();
		overlayEl.classList.remove('hidden');
		refresh();
	}

	function close() {
		closeTotalMenu();
		if (overlayEl) overlayEl.classList.add('hidden');
	}

	function goBack() {
		close();
	}

	/* ☆======= boot =======☆ */

	function wireButton() {
		const item = document.getElementById('manage-storage-item');
		if (item) item.addEventListener('click', open);
	}

	function init() {
		wireButton();
		window.addEventListener('starl-storage-updated', () => {
			if (overlayEl && !overlayEl.classList.contains('hidden')) refresh();
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}

	window.starlStoragePage = {open, close, goBack};
})();

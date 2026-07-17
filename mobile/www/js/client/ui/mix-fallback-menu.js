/**
 * ☆=========================================☆
 * When MIX fails menu - the little chooser for the library fallback mode
 * A real MIX needs the server's radio pool (internet + a working /mix). When that's
 * not there, mix-fallback.js can fill the mix from your downloads instead. This tiny
 * sheet just picks HOW: off / similar / any. It used to be a whole settings page -
 * one radio group never needed a page, so it's a bottom sheet now.
 *
 * --- What this file does? ---
 * - open(): shows the sheet with the three modes, current one lit
 * - Tapping a mode writes the 'mixFallback' section to account state and closes
 * - Wires the "When MIX fails" row in the account tab (#mix-fallback-item) to open()
 *
 * --- Dictionary / Terms / Extra details ---
 * - "library" = songs you've already downloaded (they play offline)
 * - the current mode is read back through starlMixFallback.getMode(), so this sheet and
 *   the engine always agree on the default ('similar') even before anything's saved
 * ☆=========================================☆
 */

(function () {
	const SECTION_NAME = 'mixFallback';

	const OPTIONS = [
		{id: 'off', label: 'Off', note: "Just show an error, don't build anything."},
		{
			id: 'similar',
			label: 'Similar songs from library',
			note: "Prefers downloads by the seed's artist (and artists you follow), then fills with the rest.",
		},
		{id: 'any', label: 'Any songs from library', note: "A plain shuffle of everything you've downloaded."},
	];

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function currentMode() {
		const fb = window.starlMixFallback;
		return fb && typeof fb.getMode === 'function' ? fb.getMode() : 'similar';
	}

	function save(mode) {
		const api = window.starlAccountState;
		if (api && typeof api.setSection === 'function') {
			api.setSection(SECTION_NAME, {mode}, {skipRefresh: true});
		}
	}

	function open() {
		const bs = window.starlBottomSheet;
		if (!bs) return;

		bs.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'When MIX fails'));
				body.appendChild(
					el(
						'div',
						'rec-group-note',
						"When a mix can't be built (offline, or the server has nothing), fill it from your library cache instead.",
					),
				);

				const selected = currentMode();
				const list = el('div', 'rec-option-list');

				OPTIONS.forEach((opt) => {
					const row = el('div', 'rec-option-row' + (selected === opt.id ? ' is-selected' : ''));
					row.appendChild(el('div', 'rec-option-label', opt.label));
					row.appendChild(el('div', 'rec-option-note', opt.note));
					row.addEventListener('click', () => {
						// only one option stays lit
						list.querySelectorAll('.rec-option-row').forEach((r) => r.classList.remove('is-selected'));
						row.classList.add('is-selected');
						save(opt.id);
						setTimeout(() => bs.close(), 120);
					});
					list.appendChild(row);
				});

				body.appendChild(list);
			},
		});
	}

	function wireButton() {
		const item = document.getElementById('mix-fallback-item');
		if (item) item.addEventListener('click', open);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', wireButton, {once: true});
	} else {
		wireButton();
	}

	window.starlMixFallbackMenu = {open};
})();

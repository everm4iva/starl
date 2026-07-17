/**
 * ☆=========================================☆
 * Stats settings - the "Data collection" switch, clear, and export buttons
 * Wires the three rows under Account -> Recommendation system to the stats tracker.
 * No counting happens here - that's stats-tracker.js. This is just the buttons.
 *
 * --- What this file does? ---
 * - Data collection: opens an On/Off sheet (starlStats.setEnabled) - syncs across devices
 * - Clear all colected data: asks first, then wipes the server-side score
 * - Export all statistics data: pulls the score and saves it as statistics.json
 *
 * --- Dictionary / Terms / Extra details ---
 * - Uses the shared bottom sheet + the .rec-option-* styles (recommendation-settings.css)
 * ☆=========================================☆
 */

(function () {
	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function toast(message, kind) {
		if (typeof window.showToast === 'function') window.showToast(message, kind || 'success');
	}

	function statsApi() {
		return window.starlStats || null;
	}

	/* ☆======= Data collection on/off =======☆ */

	const COLLECT_OPTIONS = [
		{on: true, label: 'On', note: 'The server keeps score of what you play, open, and skip.'},
		{on: false, label: 'Off', note: 'Nothing new is recorded. Your existing score stays until you clear it.'},
	];

	function openCollectSheet() {
		const api = statsApi();
		const bs = window.starlBottomSheet;
		if (!api || !bs) return;
		const enabled = api.isEnabled();

		bs.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'Data collection'));
				const list = el('div', 'rec-option-list');
				COLLECT_OPTIONS.forEach((opt) => {
					const row = el('div', 'rec-option-row' + (opt.on === enabled ? ' is-selected' : ''));
					row.appendChild(el('div', 'rec-option-label', opt.label));
					row.appendChild(el('div', 'rec-option-note', opt.note));
					row.addEventListener('click', () => {
						api.setEnabled(opt.on);
						bs.close();
						toast(opt.on ? 'Collecting data' : 'Data collection off');
					});
					list.appendChild(row);
				});
				body.appendChild(list);
			},
		});
	}

	/* ☆======= Clear (asks first) =======☆ */

	function openClearSheet() {
		const api = statsApi();
		const bs = window.starlBottomSheet;
		if (!api || !bs) return;

		bs.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'Clear all collected data'));
				body.appendChild(
					el('div', 'rec-group-note', 'This wipes your listening score on the server. It cannot be undone.'),
				);
				const row = el('div', 'bsc-settings-row');
				const cancelBtn = el('button', 'bsc-btn', 'Cancel');
				cancelBtn.type = 'button';
				cancelBtn.addEventListener('click', () => bs.close());
				const clearBtn = el('button', 'bsc-btn danger', 'Clear');
				clearBtn.type = 'button';
				clearBtn.addEventListener('click', async () => {
					clearBtn.disabled = true;
					clearBtn.textContent = 'Clearing…';
					const ok = await api.clear();
					// your boosts/debuffs/blacklist ride on this same score, so wipe them too
					if (window.starlRecommend && typeof window.starlRecommend.clearAll === 'function') {
						window.starlRecommend.clearAll();
					}
					bs.close();
					toast(ok ? 'Statistics cleared' : 'Could not clear (are you online?)', ok ? 'success' : 'danger');
				});
				row.appendChild(cancelBtn);
				row.appendChild(clearBtn);
				body.appendChild(row);
			},
		});
	}

	/* ☆======= Export =======☆ */

	async function exportStats() {
		const api = statsApi();
		if (!api) return;
		toast('Building statistics.json…');
		const data = await api.getStats();
		if (!data || (!Object.keys(data.tracks || {}).length && !Object.keys(data.artists || {}).length)) {
			toast('No statistics to export yet', 'danger');
			return;
		}
		if (window.starlFileExport && typeof window.starlFileExport.saveJson === 'function') {
			window.starlFileExport.saveJson('statistics', data);
		}
	}

	/* ☆======= boot =======☆ */

	function wire(id, handler) {
		const item = document.getElementById(id);
		if (item) item.addEventListener('click', handler);
	}

	function init() {
		wire('stats-collect-item', openCollectSheet);
		wire('stats-clear-item', openClearSheet);
		wire('stats-export-item', exportStats);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}
})();

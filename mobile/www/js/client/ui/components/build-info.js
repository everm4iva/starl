/**
 * ☆=========================================☆
 * Build info - a little "what am I running?" panel from point.json
 * The "Build Info" row in the account tab. Clicking it pops a bottom sheet that
 * just lists the fields from point.json (version, build date, edition, etc.).
 *
 * --- What this file does? ---
 * - On click: read point.json (cached after first load) and show it as a key/value list
 * - Falls back to a friendly message if the file can't be read
 *
 * --- Dictionary / Terms / Extra details ---
 * - point.json lives next to index.html; it's the app's build manifest
 * ☆=========================================☆
 */

(function () {
	let cachedPoint = null;

	// pretty label for each known key; anything unknown gets a title-cased fallback
	const LABELS = {
		name: 'Name',
		creator: 'Creator',
		edition: 'Edition',
		version: 'Version',
		date: 'Build date',
		protocol: 'Protocol',
		type: 'Type',
		author: 'Author',
		target: 'Target',
	};

	function labelFor(key) {
		if (LABELS[key]) return LABELS[key];
		return String(key).charAt(0).toUpperCase() + String(key).slice(1);
	}

	async function loadPoint() {
		if (cachedPoint) return cachedPoint;
		const res = await fetch('point.json', {cache: 'no-store'});
		if (!res.ok) throw new Error('point.json ' + res.status);
		cachedPoint = await res.json();
		return cachedPoint;
	}

	// flatten {build:{...}} into one list, top-level fields first then the build block
	function toRows(point) {
		const rows = [];
		Object.keys(point || {}).forEach((key) => {
			const value = point[key];
			if (value && typeof value === 'object') return; // nested handled below
			rows.push([labelFor(key), String(value)]);
		});
		const build = point && point.build;
		if (build && typeof build === 'object') {
			Object.keys(build).forEach((key) => {
				rows.push([labelFor(key), String(build[key])]);
			});
		}
		return rows;
	}

	function renderSheet(body, rows) {
		const heading = document.createElement('div');
		heading.className = 'bsc-settings-header';
		heading.textContent = 'Build info';
		body.appendChild(heading);

		const list = document.createElement('div');
		list.className = 'build-info-list';
		rows.forEach(([label, value]) => {
			const row = document.createElement('div');
			row.className = 'build-info-row';
			const k = document.createElement('span');
			k.className = 'build-info-key';
			k.textContent = label;
			const v = document.createElement('span');
			v.className = 'build-info-value';
			v.textContent = value;
			row.appendChild(k);
			row.appendChild(v);
			list.appendChild(row);
		});
		body.appendChild(list);
	}

	async function openBuildInfo() {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		bs.open({
			render(body) {
				const loading = document.createElement('div');
				loading.className = 'ipl-status';
				loading.textContent = 'Loading build info…';
				body.appendChild(loading);
			},
		});
		try {
			const point = await loadPoint();
			bs.open({render: (body) => renderSheet(body, toRows(point))});
		} catch (e) {
			bs.open({
				render(body) {
					const msg = document.createElement('div');
					msg.className = 'ipl-status';
					msg.textContent = 'Build info is unavailable.';
					body.appendChild(msg);
				},
			});
		}
	}

	function init() {
		const item = document.getElementById('about-build-info');
		if (!item) return;
		item.addEventListener('click', openBuildInfo);
	}

	if (document.readyState !== 'loading') init();
	else document.addEventListener('DOMContentLoaded', init, {once: true});
})();

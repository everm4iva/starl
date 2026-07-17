/**
 * ☆=========================================☆
 * Search recents - idle state for the search tab
 * Renders a unified list of recent search queries and clicked result items
 * when the search bar is empty. Called by search.js via window.starlSearchRecents
 *
 * --- What this file does? ---
 * - addQuery(q): stores a search query string with a timestamp (deduped)
 * - addItem(item, shape): stores a clicked search result item with a timestamp
 * - render(root, buildPills, createResultItem, onSelectQuery, onSelectItem):
 *   shows up to 10 entries (queries + items) sorted by most recent first;
 *   each row has a remove button; clicking a query re-runs that search,
 *   clicking an item fires onSelectItem(item, shape) to replay the same action
 * - Falls back to a "Start searching" message when nothing is stored
 *
 * --- Dictionary / Terms / Extra details ---
 * - Entries live in localStorage under 'starl_search_recents_v2'
 * - shape 'circle' = artist, 'square' = track or album
 * - buildPills / createResultItem are passed in from search.js
 * ☆=========================================☆
 */

(function () {
	const STORAGE_KEY = 'starl_search_recents_v2';
	const MAX_ENTRIES = 10;

	/* ☆======= Storage helpers =======☆ */

	function load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			return raw ? JSON.parse(raw) : [];
		} catch (e) {
			return [];
		}
	}

	function save(list) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
		} catch (e) {}
	}

	function addQuery(q) {
		if (!q || !q.trim()) return;
		const normalized = q.trim();
		const list = load().filter((e) => !(e.type === 'query' && e.query === normalized));
		list.unshift({type: 'query', query: normalized, timestamp: Date.now()});
		save(list);
	}

	function addItem(item, shape) {
		const key = item.id || item.sourceUrl || item.url || item.trackKey || '';
		if (!key) return;
		const entry = {
			type: 'item',
			key,
			shape: shape || 'square',
			title: item.title || '',
			subtitle: item.artist || item.author || '',
			thumbnail: item.thumbnail || item.imageUrl || '',
			kind: item.kind || '',
			id: item.id || '',
			sourceUrl: item.sourceUrl || item.url || '',
			trackKey: item.trackKey || '',
			timestamp: Date.now(),
		};
		const list = load().filter((e) => !(e.type === 'item' && e.key === key));
		list.unshift(entry);
		save(list);
	}

	function removeEntry(list, entry) {
		if (entry.type === 'query') {
			return list.filter((e) => !(e.type === 'query' && e.query === entry.query));
		}
		return list.filter((e) => !(e.type === 'item' && e.key === entry.key));
	}

	/* ☆======= Render =======☆ */

	function render(resultsRoot, buildPills, createResultItem, onSelectQuery, onSelectItem) {
		resultsRoot.innerHTML = '';
		buildPills(resultsRoot);

		const entries = load();
		if (!entries.length) {
			const msg = document.createElement('div');
			msg.className = 'sr-message';
			msg.textContent = 'Start searching to discover music.';
			resultsRoot.appendChild(msg);
			return;
		}

		const heading = document.createElement('div');
		heading.className = 'sr-heading';
		heading.textContent = 'Recents';
		resultsRoot.appendChild(heading);

		entries.forEach((entry, i) => {
			let row;

			if (entry.type === 'item') {
				// re-use the standard result row builder so it looks identical to search results
				const syntheticItem = {
					title: entry.title,
					artist: entry.subtitle,
					thumbnail: entry.thumbnail,
					imageUrl: entry.thumbnail,
					kind: entry.kind,
					id: entry.id,
					sourceUrl: entry.sourceUrl,
					url: entry.sourceUrl,
					trackKey: entry.trackKey,
				};
				row = createResultItem(syntheticItem, entry.shape);
				// override the click handler set by createResultItem so it goes through onSelectItem.
				// capture phase fires before the remove button (a child, added below) gets its own
				// click - bail out here when the click is actually on the remove button, or it can
				// never run and "remove" just replays the item-select instead
				row.addEventListener(
					'click',
					(e) => {
						if (e.target.closest('.sr-remove-btn')) return;
						e.stopImmediatePropagation();
						if (typeof onSelectItem === 'function') onSelectItem(syntheticItem, entry.shape);
					},
					true,
				);
			} else {
				// query row - search icon + query text
				row = document.createElement('div');
				row.className = 'sr-item';
				const icon = document.createElement('div');
				icon.className = 'sr-cover sr-cover-square sr-recent-query-icon';
				const info = document.createElement('div');
				info.className = 'sr-info';
				const title = document.createElement('div');
				title.className = 'sr-title';
				title.textContent = entry.query;
				info.appendChild(title);
				const actions = document.createElement('div');
				actions.className = 'sr-actions';
				row.appendChild(icon);
				row.appendChild(info);
				row.appendChild(actions);
				if (typeof onSelectQuery === 'function') {
					row.addEventListener('click', () => onSelectQuery(entry.query));
				}
			}

			row.style.animationDelay = i * 25 + 'ms';

			// remove button
			const removeBtn = document.createElement('div');
			removeBtn.className = 'sr-remove-btn';
			removeBtn.title = 'Remove from recents';
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				save(removeEntry(load(), entry));
				row.style.transition = 'all 0.2s ease';
				row.style.opacity = '0';
				row.style.transform = 'translateX(20px)';
				setTimeout(() => row.remove(), 200);
			});
			const actionsEl = row.querySelector('.sr-actions');
			if (actionsEl) actionsEl.appendChild(removeBtn);

			resultsRoot.appendChild(row);
		});
	}

	window.starlSearchRecents = {render, addQuery, addItem};
})();

/**
 * ☆=========================================☆
 * Search recents - idle state for the search tab
 * Renders the recent history list when the search bar is empty.
 * Called by search.js via window.starlSearchRecents.render().
 *
 * --- What this file does? ---
 * - render(root, buildPills, createResultItem): fills the results root with recents
 * - Shows the last 12 played tracks from listening history
 * - Adds a remove button to each recent row
 * - Falls back to a "Start searching" message when history is empty
 *
 * --- Dictionary / Terms / Extra details ---
 * - buildPills / createResultItem are passed in from search.js so this file
 *   doesn't need to duplicate the pill bar or item factory
 * ☆=========================================☆
 */

(function () {
	function render(resultsRoot, buildPills, createResultItem) {
		resultsRoot.innerHTML = '';
		buildPills(resultsRoot);
		const history = window.starlHistory ? window.starlHistory.getAll().slice(0, 12) : [];
		if (!history.length) {
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
		history.forEach((track, i) => {
			const item = {...track, thumbnail: track.imageUrl || '', url: track.sourceUrl || ''};
			const isArtist = track.kind === 'channel' || track.kind === 'artist';
			const row = createResultItem(item, isArtist ? 'circle' : 'square');
			row.style.animationDelay = i * 25 + 'ms';
			const removeBtn = document.createElement('div');
			removeBtn.className = 'sr-remove-btn';
			removeBtn.title = 'Remove from recents';
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (window.starlHistory && typeof window.starlHistory.remove === 'function') {
					window.starlHistory.remove(track.trackKey || track.sourceUrl || track.streamUrl || '');
				}
				row.style.transition = 'all 0.2s ease';
				row.style.opacity = '0';
				row.style.transform = 'translateX(20px)';
				setTimeout(() => row.remove(), 200);
			});
			row.querySelector('.sr-actions').appendChild(removeBtn);
			resultsRoot.appendChild(row);
		});
	}

	window.starlSearchRecents = {render};
})();

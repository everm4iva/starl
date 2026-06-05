/*
Last tracks home preview
-> this file keeps the homepage history row in sync with the listening history store.
-> it shows the five newest listens and a shortcut into the full history tab.
-> when history changes, this view rerenders from the same source.
*/

(function () {
	const sectionSelector = '.sec-LastTracks';
	const rootSelector = '.sec-LastTracks .sec-container';
	const updateEventName = 'starl-history-updated';
	let sectionEl = null;
	let rootEl = null;
	let lastRenderedSignature = '';

	function getHistory() {
		if (window.starlHistory && typeof window.starlHistory.getAll === 'function') {
			return window.starlHistory.getAll();
		}
		return [];
	}

	function formatDuration(totalSeconds) {
		const seconds = Number(totalSeconds);
		if (!Number.isFinite(seconds) || seconds <= 0) {
			return '--:--';
		}
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return mins + ':' + String(secs).padStart(2, '0');
	}

	function getMediaCache() {
		return window.starlMediaCache || null;
	}

	function openLibraryTab() {
		const button = document.querySelector('.tabs-btn[data-tab="library"]');
		if (button) {
			button.click();
			try {
				window.dispatchEvent(new CustomEvent('starl-library-open-history'));
			} catch (error) {}
			return;
		}

		const libraryTab = document.querySelector('.tab.library');
		const tabPanels = Array.from(document.querySelectorAll('.tab[data-tab]'));
		const tabButtons = Array.from(document.querySelectorAll('.tabs-btn[data-tab]'));
		if (!libraryTab || tabPanels.length === 0 || tabButtons.length === 0) {
			return;
		}

		tabPanels.forEach((panel) => {
			panel.classList.toggle('is-hidden', panel !== libraryTab);
		});
		tabButtons.forEach((tabButton) => {
			const icon = tabButton.querySelector('.tabs-btn-icon');
			const isActive = tabButton.dataset.tab === 'library';
			if (icon) {
				icon.classList.toggle('active', isActive);
			}
		});
		try {
			window.dispatchEvent(new CustomEvent('starl-library-open-history'));
		} catch (error) {}
	}

	function playHistoryItem(item) {
		if (!item || (!item.sourceUrl && !item.streamUrl)) {
			return;
		}
		if (window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
			window.starlPlayer.playFromSearch({
				url: item.sourceUrl || item.streamUrl || '',
				trackKey: item.trackKey || item.sourceUrl || item.streamUrl,
				streamUrl: item.streamUrl || item.sourceUrl || '',
				title: item.title,
				artist: item.artist,
				album: item.album,
				thumbnail: item.imageUrl,
				duration: item.duration,
			});
		}
	}

	function createHistoryCard(item, index) {
		const card = document.createElement('div');
		card.className = 'slt-item';
		card.tabIndex = 0;
		card.setAttribute('role', 'button');
		card.setAttribute('aria-label', (item.title || 'Untitled') + ' by ' + (item.artist || 'Unknown artist'));

		const bg = document.createElement('div');
		bg.className = 'slt-item-bg';

		if (item.imageUrl) {
			const mediaCache = getMediaCache();
			if (mediaCache && typeof mediaCache.setProgressiveImage === 'function') {
				mediaCache
					.setProgressiveImage(bg, item.imageUrl, (resolvedUrl) => {
						if (resolvedUrl) {
							bg.style.backgroundImage = 'url("' + resolvedUrl.replace(/"/g, '%22') + '")';
						}
					})
					.catch(() => {});
			} else {
				bg.style.backgroundImage = 'url("' + item.imageUrl.replace(/"/g, '%22') + '")';
			}
		}

		const gradient = document.createElement('div');
		gradient.className = 'slt-item-gradient';

		const info = document.createElement('div');
		info.className = 'slt-item-time-artist';
		info.textContent = formatDuration(item.duration) + ' • by ' + (item.artist || 'Unknown artist');

		const title = document.createElement('div');
		title.className = 'slt-item-title';
		title.textContent = item.title || 'Untitled';

		card.addEventListener('click', () => playHistoryItem(item));
		card.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				playHistoryItem(item);
			}
		});

		card.appendChild(bg);
		card.appendChild(gradient);
		card.appendChild(info);
		card.appendChild(title);
		if (window.starlTrackContextMenu && typeof window.starlTrackContextMenu.bindTarget === 'function') {
			window.starlTrackContextMenu.bindTarget(card, () => item, {source: 'history'});
		}
		card.style.animationDelay = index * 35 + 'ms';
		return card;
	}

	function createSeeMoreCard() {
		const card = document.createElement('div');
		card.className = 'sh-shortcut';
		card.tabIndex = 0;
		card.setAttribute('role', 'button');
		card.setAttribute('aria-label', 'See more history');

		const icon = document.createElement('div');
		icon.className = 'sh-shortcut-icon history';

		const label = document.createElement('div');
		label.className = 'sh-shortcut-text';
		label.textContent = 'See more';

		card.addEventListener('click', openLibraryTab);
		card.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				openLibraryTab();
			}
		});

		card.appendChild(icon);
		card.appendChild(label);
		return card;
	}

	function render(items) {
		if (!sectionEl) {
			sectionEl = document.querySelector(sectionSelector);
		}
		if (sectionEl) {
			sectionEl.classList.add('hidden');
		}

		if (!rootEl) {
			rootEl = document.querySelector(rootSelector);
			if (!rootEl) {
				return;
			}
		}

		const historyItems = (Array.isArray(items) ? items : getHistory()).slice(0, 5);
		const signature = historyItems
			.map((item) => [item.trackKey, item.listenedAt, item.imageUrl].join('~'))
			.join('||');
		if (sectionEl) {
			sectionEl.classList.toggle('hidden', historyItems.length === 0);
		}
		if (signature === lastRenderedSignature && rootEl && rootEl.childElementCount > 0) {
			return;
		}
		lastRenderedSignature = signature;
		rootEl.innerHTML = '';

		if (!historyItems.length) {
			const emptyCard = document.createElement('div');
			emptyCard.className = 'slt-item';
			emptyCard.setAttribute('aria-disabled', 'true');

			const gradient = document.createElement('div');
			gradient.className = 'slt-item-gradient';

			const info = document.createElement('div');
			info.className = 'slt-item-time-artist';
			info.textContent = 'Play a song to build your history';

			const title = document.createElement('div');
			title.className = 'slt-item-title';
			title.textContent = 'No recent tracks yet';

			emptyCard.appendChild(gradient);
			emptyCard.appendChild(info);
			emptyCard.appendChild(title);
			rootEl.appendChild(emptyCard);
		} else {
			historyItems.forEach((item, index) => {
				rootEl.appendChild(createHistoryCard(item, index));
			});
		}

		rootEl.appendChild(createSeeMoreCard());
	}

	function handleHistoryUpdate(event) {
		const items = event && event.detail && Array.isArray(event.detail.items) ? event.detail.items : undefined;
		render(items);
	}

	function init() {
		render();
		window.addEventListener(updateEventName, handleHistoryUpdate);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}
})();

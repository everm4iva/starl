/**
 * ☆=========================================☆
 * Layout tabs - CSS helpers, time display, scrubbing, tab navigation
 * The second half of layout.js. Depends on layout.js (loaded first) for
 * rootStyle, playerTime, sliderProgress, bottomTimeElapsed, and element refs.
 *
 * --- What this file does? ---
 * - isScrubbing: tracks whether the user is actively dragging the seek bar
 * - setTextVar() / setBgVar(): writes CSS custom properties used by the UI
 * - setLoadingState(): shows/hides the loading indicator
 * - setTimeVars() / updateSliderProgress(): keeps the time/seek UI in sync
 * - getMediaCache() / prepareArtworkUrl(): artwork resolution helpers
 * - initTabNavigation(): wires the tab bar click handlers
 *
 * --- Dictionary / Terms / Extra details ---
 * - CSS vars drive text content (content: var(--player-song-title) in CSS)
 * - setBgVar() progressively loads artwork via the media cache
 * ☆=========================================☆
 */

/* ☆======= CSS helpers + time display =======☆ */

let isScrubbing = false;

function escapeCssString(value) {
	return String(value ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'");
}

function setTextVar(name, value) {
	rootStyle.setProperty(name, "'" + escapeCssString(value) + "'");
}

function setLoadingState(isLoading) {
	if (loadingIndicator) {
		// only show loading indicator when mini player is visible
		const show = Boolean(isLoading) && miniPlayer && !miniPlayer.classList.contains('hidden');
		loadingIndicator.classList.toggle('hidden', !show);
	}
	if (bottomNav) {
		bottomNav.classList.toggle('is-loading', Boolean(isLoading));
	}
}

function setBgVar(url) {
	if (url) {
		const cache = getMediaCache();
		if (cache && typeof cache.setProgressiveImage === 'function') {
			cache.setProgressiveImage('player-bg', url, (resolvedUrl) => {
				rootStyle.setProperty('--player-bg', 'url("' + prepareArtworkUrl(resolvedUrl) + '")');
			});
			return;
		}
		rootStyle.setProperty('--player-bg', 'url("' + prepareArtworkUrl(url) + '")');
	}
}

function getMediaCache() {
	return window.starlMediaCache || null;
}

function prepareArtworkUrl(url) {
	const rawUrl = String(url || '');
	if (!rawUrl) {
		return '';
	}
	const apiBase = getApiBase();
	const normalizedUrl = rawUrl.startsWith('/image/') ? apiBase + rawUrl : rawUrl;
	if (normalizedUrl.startsWith(apiBase + '/image/')) {
		const token = getAccessToken();
		if (token && !normalizedUrl.includes('token=')) {
			return normalizedUrl + (normalizedUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
		}
	}
	return normalizedUrl;
}

function formatDuration(totalSeconds) {
	const seconds = Number(totalSeconds);
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return '0:00';
	}
	const hrs = Math.floor(seconds / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);
	if (hrs > 0) {
		return hrs + ':' + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
	}
	return mins + ':' + String(secs).padStart(2, '0');
}

function setTimeVars(currentSeconds, totalSeconds) {
	const total = Number(totalSeconds) || 0;
	const current = Number(currentSeconds) || 0;
	setTextVar('--player-time-elapsed', formatDuration(current));
	setTextVar('--player-time-total', formatDuration(total));
	let progress = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
	if (total > 0 && current >= total - 0.25) {
		progress = 100;
	}
	rootStyle.setProperty('--player-time-progress', progress.toFixed(2) + '%');
	if (bottomTimeElapsed) {
		bottomTimeElapsed.style.width = progress.toFixed(2) + '%';
	}
}

function updateSliderProgress() {
	if (!playerTime || !sliderProgress) {
		return;
	}
	const min = Number(playerTime.min) || 0;
	const max = Number(playerTime.max) || 0;
	const value = Number(playerTime.value) || 0;
	const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
	sliderProgress.style.width = percent + '%';
}

if (playerTime) {
	playerTime.addEventListener('input', () => {
		isScrubbing = true;
		updateSliderProgress();
	});
	playerTime.addEventListener('change', () => {
		isScrubbing = false;
	});
	playerTime.addEventListener('pointerdown', () => {
		isScrubbing = true;
	});
	playerTime.addEventListener('pointerup', () => {
		isScrubbing = false;
	});
}

updateSliderProgress();

/* ☆======= Tabs =======☆ */

const tabButtons = Array.from(document.querySelectorAll('.tabs-btn[data-tab]'));
const tabPanels = Array.from(document.querySelectorAll('.tab[data-tab]'));

function getTabNameFromButton(button) {
	return button.dataset.tab;
}

function setActiveTab(tabName) {
	tabPanels.forEach((panel) => {
		const isActive = panel.dataset.tab === tabName;
		panel.classList.toggle('is-hidden', !isActive);
	});

	tabButtons.forEach((button) => {
		const icon = button.querySelector('.tabs-btn-icon');
		const isActive = button.dataset.tab === tabName;
		if (icon) {
			icon.classList.toggle('active', isActive);
		}
	});
}

function initTabNavigation() {
	if (tabButtons.length === 0 || tabPanels.length === 0) {
		return;
	}

	tabButtons.forEach((button) => {
		button.addEventListener('click', () => {
			setActiveTab(getTabNameFromButton(button));
		});
	});
}

initTabNavigation();
renderExportLocationSettings();

window.starlLayout = window.starlLayout || {};
window.starlLayout.showToast = showToast;

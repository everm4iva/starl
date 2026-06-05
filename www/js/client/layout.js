/*
Client layout and tabs
-> this file keeps the visible shell of the app in sync with the player.
-> it updates time labels, loading state, tab switching, and the logout flow.
-> simple rule: when the player changes, the layout follows.
*/

// ----- Progress & time -----
const playerTime = document.getElementById('player-time');
const sliderProgress = document.getElementById('slider-progress');
const rootStyle = document.documentElement.style;
const auth = window.starlAuth;
const loadingIndicator = document.getElementById('loading-indicator');

const exportAccountButton = document.getElementById('export-account-button');
const exportLocationSelect = document.getElementById('export-location-select');
const exportLocationHint = document.getElementById('export-location-hint');
const deleteAccountButton = document.getElementById('delete-account-button');
const logoutButton = document.getElementById('logout-button');
let toastTimer = null;

if (auth && typeof auth.ensureAuth === 'function') {
	auth.ensureAuth();
}

function logoutAndRedirect() {
	clearAllLocalAccountData();
	try {
		if (window.MusicControls && typeof window.MusicControls.destroy === 'function') {
			window.MusicControls.destroy(
				() => {},
				() => {},
			);
		}
	} catch (error) {}

	try {
		if (typeof audio !== 'undefined') {
			audio.pause();
			audio.removeAttribute('src');
			audio.load();
		}
	} catch (error) {}

	try {
		localStorage.removeItem('starl_player_state');
	} catch (error) {}

	if (auth && typeof auth.clearAccessToken === 'function') {
		auth.clearAccessToken();
	}
	if (auth && typeof auth.redirectToLogin === 'function') {
		auth.redirectToLogin();
		return;
	}
	window.location.href = 'login.html';
}

function showToast(message, kind) {
	let toast = document.getElementById('app-toast');
	if (!toast) {
		toast = document.createElement('div');
		toast.id = 'app-toast';
		toast.className = 'app-toast hidden';
		document.body.appendChild(toast);
	}
	toast.textContent = message;
	toast.classList.remove('hidden');
	toast.classList.toggle('is-danger', kind === 'danger');
	toast.classList.toggle('is-success', kind === 'success');
	toast.classList.add('visible');
	if (toastTimer) {
		clearTimeout(toastTimer);
	}
	toastTimer = setTimeout(() => {
		toast.classList.remove('visible');
		toast.classList.add('hidden');
		toast.classList.remove('is-danger', 'is-success');
	}, 1800);
}

function clearAllLocalAccountData() {
	try {
		if (window.starlAccountState && typeof window.starlAccountState.clearLocalCache === 'function') {
			window.starlAccountState.clearLocalCache();
		}
	} catch (error) {}
	try {
		localStorage.removeItem('starl_listening_history');
	} catch (error) {}
	try {
		localStorage.removeItem('starl_account_state');
	} catch (error) {}
	// Also clear any cached update state so user can re-check after manual clear
	try {
		if (window.starlUpdateCheck && typeof window.starlUpdateCheck.clearCache === 'function') {
			window.starlUpdateCheck.clearCache();
		}
	} catch (error) {}
}

// ----- Update banner -----

(function initUpdateBanner() {
	const banner = document.getElementById('update-banner');
	const bannerTitle = document.getElementById('update-banner-title');
	const bannerSub = document.getElementById('update-banner-sub');
	const updateBtn = document.getElementById('update-app-button');
	if (!banner) return;

	function showBanner(info) {
		if (bannerTitle) bannerTitle.textContent = 'Update available — v' + (info.serverVersion || '');
		if (bannerSub) bannerSub.textContent = 'You are on v' + (info.clientVersion || '') + '. Music still plays, but new content is blocked until updated.';
		banner.classList.remove('hidden');
	}

	function hideBanner() {
		banner.classList.add('hidden');
	}

	// Restore from cached state immediately
	const upd = window.starlUpdateCheck;
	if (upd && typeof upd.isOutdated === 'function' && upd.isOutdated()) {
		showBanner(upd.getUpdateInfo() || {});
	}

	window.addEventListener('starl-update-available', (e) => {
		showBanner(e.detail || {});
	});

	window.addEventListener('starl-up-to-date', hideBanner);

	if (updateBtn) {
		updateBtn.addEventListener('click', () => {
			const info = upd && typeof upd.getUpdateInfo === 'function' ? upd.getUpdateInfo() : null;
			const url = info && info.download_url;
			if (!url) {
				showToast('No download link available.', 'danger');
				return;
			}
			// Open download link — works on Android via Cordova InAppBrowser or plain window.open
			try {
				if (window.cordova && window.cordova.InAppBrowser) {
					window.cordova.InAppBrowser.open(url, '_system');
				} else {
					window.open(url, '_blank');
				}
			} catch (e) {
				window.open(url, '_blank');
			}
		});
	}
})();

async function exportAccountData() {
	const token = getAccessToken();
	if (!token) {
		alert('Please sign in first.');
		return;
	}
	try {
		const response = await fetch(getApiBase() + '/account/export', {headers: {'Authorization': 'Bearer ' + token}});
		if (!response.ok) {
			throw new Error('Export failed.');
		}
		const payload = await response.json();
		const exportPayload = {
			exportedAt: new Date().toISOString(),
			user: payload.user || {},
			state: payload.state || {},
			updatedAt: payload.updated_at || null,
		};

		const fileProtocol = window.starlFileProtocol;
		if (fileProtocol && typeof fileProtocol.saveJsonForTarget === 'function') {
			const result = await fileProtocol.saveJsonForTarget(
				'account-export',
				'starl-account-export-' + Date.now() + '.json',
				exportPayload,
			);
			if (result && result.path) {
				const locationText = result.locationLabel ? ' to ' + result.locationLabel : '';
				showToast('Account exported' + locationText + ': ' + result.path, 'success');
			} else {
				showToast('Account exported', 'success');
			}
			return;
		}

		const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {type: 'application/json'});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'starl-account-export-' + Date.now() + '.json';
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		showToast('Account exported', 'success');
	} catch (error) {
		alert(error && error.message ? error.message : 'Export failed.');
	}
}

function renderExportLocationSettings() {
	if (!exportLocationSelect) {
		return;
	}

	const fileProtocol = window.starlFileProtocol;
	if (!fileProtocol || typeof fileProtocol.describeTarget !== 'function') {
		exportLocationSelect.disabled = true;
		if (exportLocationHint) {
			exportLocationHint.textContent = 'Export location settings unavailable.';
		}
		return;
	}

	const info = fileProtocol.describeTarget('account-export');
	if (!info) {
		exportLocationSelect.disabled = true;
		if (exportLocationHint) {
			exportLocationHint.textContent = 'Account export target not found.';
		}
		return;
	}

	// If Cordova is present but the File plugin isn't available, surface a helpful hint
	// so users know why native directories aren't listed.
	if (typeof window !== 'undefined' && window.cordova && !(window.cordova && window.cordova.file)) {
		if (exportLocationHint) {
			exportLocationHint.textContent =
				'Cordova detected but the File plugin is unavailable. Install `cordova-plugin-file` and rebuild the app to enable native export locations.';
		}
	}

	const options = Array.isArray(info.availableLocations) ? info.availableLocations : [];
	exportLocationSelect.innerHTML = '';
	options.forEach((option) => {
		const el = document.createElement('option');
		el.value = option.id;
		el.textContent = option.label;
		exportLocationSelect.appendChild(el);
	});

	exportLocationSelect.value = info.locationId || 'auto';
	exportLocationSelect.disabled = options.length <= 1;

	if (exportLocationHint) {
		if (info.strategy === 'cordova-file' && info.directory) {
			exportLocationHint.textContent = 'Files are saved under: ' + info.directory + 'exports/';
		} else {
			exportLocationHint.textContent =
				'Files are downloaded by the browser (Download folder behavior depends on device settings).';
		}
	}
}

async function deleteAccount() {
	const token = getAccessToken();
	if (!token) {
		alert('Please sign in first.');
		return;
	}
	const typedConfirmation = prompt('Type DELETE to permanently remove this account.');
	if (!typedConfirmation || typedConfirmation.trim().toUpperCase() !== 'DELETE') {
		return;
	}
	try {
		const response = await fetch(getApiBase() + '/account/delete', {
			method: 'DELETE',
			headers: {'Authorization': 'Bearer ' + token},
		});
		if (!response.ok) {
			throw new Error('Delete failed.');
		}
		clearAllLocalAccountData();
		showToast('Account deleted', 'success');
		setTimeout(() => {
			logoutAndRedirect();
		}, 900);
	} catch (error) {
		alert(error && error.message ? error.message : 'Delete failed.');
	}
}

function clearCurrentTrack() {
	try {
		if (typeof audio !== 'undefined') {
			audio.pause();
			try {
				audio.removeAttribute('src');
			} catch (e) {}
			audio.load();
		}
	} catch (e) {}

	currentTrackKey = '';
	currentStreamUrl = '';
	try {
		localStorage.removeItem(PLAYER_STATE_KEY);
	} catch (e) {}

	try {
		setTrackMeta({title: '', artist: '', album: '', imageUrl: '', duration: 0});
	} catch (e) {}

	try {
		setPlayerOpen(false);
	} catch (e) {}

	if (bottomNav) {
		bottomNav.classList.add('no-mini');
	}
}

if (logoutButton) {
	logoutButton.addEventListener('click', logoutAndRedirect);
}

if (exportAccountButton) {
	exportAccountButton.addEventListener('click', exportAccountData);
}

if (exportLocationSelect) {
	exportLocationSelect.addEventListener('change', () => {
		const fileProtocol = window.starlFileProtocol;
		if (!fileProtocol || typeof fileProtocol.setTargetLocation !== 'function') {
			return;
		}
		fileProtocol.setTargetLocation('account-export', exportLocationSelect.value);
		renderExportLocationSettings();
	});
}

if (deleteAccountButton) {
	deleteAccountButton.addEventListener('click', deleteAccount);
}

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
		// Only show loading indicator when mini player is visible
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

// ----- Tabs -----
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

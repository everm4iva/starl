/**
 * ☆=========================================☆
 * Layout - app shell, tabs, time display, account actions
 * Keeps the visible shell in sync with the player and the logged-in user.
 * Simple rule: when the player or auth state changes, the layout follows.
 *
 * --- What this file does? ---
 * - Tab navigation: switches between Home / Search / Library / Account panels
 * - Time display: formats and updates the player's elapsed/total time vars
 * - Loading state: shows/hides the loading indicator and mini-player overlay
 * - setTextVar() / setBgVar(): writes CSS custom properties used by the UI
 * - Update banner: shows "update available" when the server version is newer
 * - Account panel: export, delete account, clear cache, logout
 * - showToast(): global toast for success/error messages
 *
 * --- Dictionary / Terms / Extra details ---
 * - CSS vars drive text content (content: var(--player-song-title) in CSS)
 * - setBgVar() progressively loads artwork via the media cache
 * ☆=========================================☆
 */

/* ☆======= Element refs + auth =======☆ */

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

	// drop any self-hosted server we were connected to, so login comes back on the default one
	// and you can freely pick any method again (this is how "switch back" happens)
	if (auth && typeof auth.clearActiveServer === 'function') {
		auth.clearActiveServer();
	}

	// fire-and-forget: destroy the notification/media session, then navigate
	// after a short delay so the foreground service has time to stop before the
	// webView tears down
	try {
		if (window.MusicControls && typeof window.MusicControls.destroy === 'function') {
			window.MusicControls.destroy(
				() => {},
				() => {},
			);
		}
	} catch (error) {}

	setTimeout(() => window.location.replace('login.html'), 300);
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
	// also clear any cached update state so user can re-check after manual clear
	try {
		if (window.starlUpdateCheck && typeof window.starlUpdateCheck.clearCache === 'function') {
			window.starlUpdateCheck.clearCache();
		}
	} catch (error) {}
}

/* ☆======= Update banner =======☆ */

(function initUpdateBanner() {
	const banner = document.getElementById('update-banner');
	const bannerTitle = document.getElementById('update-banner-title');
	const bannerSub = document.getElementById('update-banner-sub');
	const updateBtn = document.getElementById('update-app-button');
	if (!banner) return;

	const DISMISS_KEY = 'starl_update_banner_dismissed_version';

	function isDismissedForSession(serverVersion) {
		try {
			return sessionStorage.getItem(DISMISS_KEY) === String(serverVersion || '');
		} catch (e) {
			return false;
		}
	}

	function dismissForSession(serverVersion) {
		try {
			sessionStorage.setItem(DISMISS_KEY, String(serverVersion || ''));
		} catch (e) {}
	}

	function showBanner(info) {
		if (isDismissedForSession(info.serverVersion)) return;
		if (bannerTitle) bannerTitle.textContent = 'Update available - v' + (info.serverVersion || '');
		if (bannerSub)
			bannerSub.textContent =
				'You are on v' +
				(info.clientVersion || '') +
				'. Music still plays, but new content is blocked until updated.';
		banner.classList.remove('hidden');
	}

	function hideBanner() {
		banner.classList.add('hidden');
	}

	/* ☆======= Swipe left-to-right to dismiss =======☆ */

	(function attachSwipeDismiss() {
		let startX = 0;
		let startY = 0;
		let tracking = false;

		banner.addEventListener(
			'touchstart',
			(e) => {
				const t = e.touches && e.touches[0];
				if (!t) return;
				startX = t.clientX;
				startY = t.clientY;
				tracking = true;
				banner.style.transition = 'none';
			},
			{passive: true},
		);

		banner.addEventListener(
			'touchmove',
			(e) => {
				if (!tracking) return;
				const t = e.touches && e.touches[0];
				if (!t) return;
				const dx = t.clientX - startX;
				if (dx > 0) banner.style.transform = 'translateX(' + dx + 'px)';
			},
			{passive: true},
		);

		banner.addEventListener('touchend', (e) => {
			if (!tracking) return;
			tracking = false;
			banner.style.transition = '';
			const t = (e.changedTouches && e.changedTouches[0]) || {};
			const dx = (t.clientX || 0) - startX;
			const dy = Math.abs((t.clientY || 0) - startY);
			if (dx > 80 && dx > dy) {
				const upd = window.starlUpdateCheck;
				const info = upd && typeof upd.getUpdateInfo === 'function' ? upd.getUpdateInfo() : null;
				dismissForSession(info && info.serverVersion);
				banner.style.transform = '';
				hideBanner();
			} else {
				banner.style.transform = '';
			}
		});
	})();

	// restore from cached state immediately
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
			// open download link - works on Android via Cordova InAppBrowser or plain window.open
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

/* ☆======= Account panel actions =======☆ */

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

	window.starlPlaybackState.reset();
	try {
		localStorage.removeItem(window.starlPlaybackState.PLAYER_STATE_KEY);
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

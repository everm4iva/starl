/**
 * ☆=========================================☆
 * Server player - server API calls and user profile
 * Handles all direct server communication for playback: requesting track downloads,
 * fetching the logged-in user's profile, and loading server-side cache status.
 *
 * --- What this file does? ---
 * - requestTrackDownload(): asks the server to prepare a track for streaming
 * - fetchUserProvider(): fetches /auth/me and writes profile CSS vars
 * - loadCacheStatus(): fetches /cache/status and shows it in the account panel
 * - Restores cached user profile at startup so the UI doesn't flash empty
 * - toAbsoluteUrl(): normalises relative server paths to full URLs
 *
 * --- Dictionary / Terms / Extra details ---
 * - "user provider" = login method (ex: 'google') returned by the server
 * - Profile CSS vars: --user-profile-name, --user-profile-pic (used in account tab)
 * ☆=========================================☆
 */

/* ☆======= Profile cache =======☆ */

let _starl_user_provider = null;
const PROFILE_CACHE_KEY = 'starl_user_profile';

function notifyServerFailure() {
	if (window.starlAccountState && typeof window.starlAccountState.notifyServerFailure === 'function') {
		window.starlAccountState.notifyServerFailure();
	}
}

function readCachedProfileFromLocalStorage() {
	try {
		const raw = localStorage.getItem(PROFILE_CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return null;
		return {name: String(parsed.name || ''), picture: String(parsed.picture || '')};
	} catch (e) {
		return null;
	}
}

function writeCachedProfileToLocalStorage(profile) {
	try {
		if (!profile || typeof profile !== 'object') return;
		localStorage.setItem(
			PROFILE_CACHE_KEY,
			JSON.stringify({
				name: String(profile.name || ''),
				picture: String(profile.picture || ''),
				updatedAt: Date.now(),
			}),
		);
	} catch (e) {}
}

function hasCustomAccountOverride() {
	try {
		const raw = localStorage.getItem('starl_account_settings');
		if (!raw) return false;
		const parsed = JSON.parse(raw);
		return Boolean(parsed && (parsed.name || parsed.pictureDataUrl));
	} catch (e) {
		return false;
	}
}

function applyProfileToCss(profile) {
	if (!profile || (!profile.name && !profile.picture) || hasCustomAccountOverride()) {
		return;
	}
	const root = document.documentElement.style;
	const escapeCss = function (v) {
		return String(v || '')
			.replace(/\\/g, '\\\\')
			.replace(/'/g, "\\'");
	};
	if (profile.name) {
		root.setProperty('--user-profile-name', "'" + escapeCss(profile.name) + "'");
	}
	if (profile.picture) {
		root.setProperty('--user-profile-pic', 'url("' + profile.picture + '")');
	}
}

// restore cached user profile early (if present). If media cache script
// hasn't loaded yet, retry a few times before giving up.
(function restoreCachedProfile(retries) {
	retries = typeof retries === 'number' ? retries : 6; // ~6 * 200ms = 1.2s
	// always try localStorage first as a fast and resilient fallback.
	try {
		const ls = readCachedProfileFromLocalStorage();
		if (ls) {
			applyProfileToCss(ls);
		}
	} catch (e) {}
	try {
		const cache = window.starlMediaCache;
		if (cache && typeof cache.getUserProfile === 'function') {
			cache
				.getUserProfile()
				.then((prof) => {
					if (prof && (prof.name || prof.picture)) {
						applyProfileToCss(prof);
						writeCachedProfileToLocalStorage(prof);
					}
				})
				.catch(() => {});
			return;
		}
	} catch (e) {}
	if (retries > 0) {
		setTimeout(() => restoreCachedProfile(retries - 1), 200);
	}
})();

/* ☆======= Server API calls =======☆ */

function toAbsoluteUrl(base, path) {
	if (!path) {
		return '';
	}
	if (/^https?:\/\//i.test(path)) {
		return path;
	}
	return base + (path.startsWith('/') ? path : '/' + path);
}

async function requestTrackDownload(sourceUrl, token) {
	let response;
	try {
		response = await fetch(getApiBase() + '/download', {
			method: 'POST',
			headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
			body: JSON.stringify({url: sourceUrl, quality: 'high'}),
		});
	} catch (error) {
		notifyServerFailure();
		throw error;
	}

	const authClient = window.starlAuth;
	if (authClient && typeof authClient.handleAuthFailure === 'function' && authClient.handleAuthFailure(response)) {
		return {authFailed: true, data: null};
	}

	const data = await response.json();
	if (!response.ok) {
		if (response.status >= 500) {
			notifyServerFailure();
		}
		const detail = data && data.detail ? String(data.detail) : 'Download failed.';
		throw new Error(detail);
	}

	return {authFailed: false, data};
}

async function fetchUserProvider() {
	try {
		let token = getAccessToken();
		if (!token) return null;
		let res = await fetch(getApiBase() + '/auth/me', {headers: {'Authorization': 'Bearer ' + token}});
		if (res.status === 401) {
			const auth = window.starlAuth;
			const refreshed = auth && typeof auth.tryRefreshToken === 'function' && (await auth.tryRefreshToken());
			if (!refreshed) return null;
			token = getAccessToken();
			res = await fetch(getApiBase() + '/auth/me', {headers: {'Authorization': 'Bearer ' + token}});
		}
		if (!res.ok) {
			if (res.status >= 500) {
				notifyServerFailure();
			}
			return null;
		}
		const data = await res.json();
		const user = data && data.user ? data.user : null;
		_starl_user_provider = user && user.provider ? String(user.provider).toLowerCase() : null;
		try {
			// update CSS root variables for profile name and picture
			const root = document.documentElement.style;
			const escapeCss = function (v) {
				return String(v || '')
					.replace(/\\/g, '\\\\')
					.replace(/'/g, "\\'");
			};
			if (user) {
				const name = user.name || '';
				const getFirstName = function (full) {
					let s = String(full || '').trim();
					if (!s) return '';
					// if it's an email, take part before @
					if (s.indexOf('@') !== -1) {
						s = s.split('@', 1)[0];
					}
					const parts = s.split(/\s+/);
					return parts[0] || s;
				};
				const pic = user.picture || '';
				const displayName = getFirstName(name);
				const hasOverride = hasCustomAccountOverride();
				if (!hasOverride) {
					root.setProperty('--user-profile-name', "'" + escapeCss(displayName) + "'");
				}
				let profilePicUrl = '';
				if (pic) {
					// decode common HTML entities and strip quotes to avoid &quot; appearing in CSS
					const decodeHtml = function (s) {
						return String(s || '')
							.replace(/&quot;/g, '"')
							.replace(/&amp;/g, '&')
							.replace(/&#39;|&apos;/g, "'")
							.replace(/&lt;/g, '<')
							.replace(/&gt;/g, '>');
					};
					let clean = decodeHtml(pic);
					clean = clean.replace(/['\"]/g, '');
					// use server-side image cache/proxy to avoid client-side 429s from providers like Google
					const proxy = getApiBase() + '/cache/image?url=' + encodeURIComponent(clean) + '&res=low';
					if (!hasOverride) {
						root.setProperty('--user-profile-pic', 'url("' + proxy + '")');
					}
					profilePicUrl = proxy;

					// persist cached profile for offline UI - pass the raw URL so media-cache handles its own proxying and avoids double-wrapping
					try {
						const cache = window.starlMediaCache;
						if (cache && typeof cache.setUserProfile === 'function') {
							cache.setUserProfile({name: displayName, picture: clean}).catch(() => {});
						}
					} catch (e) {}
				}

				writeCachedProfileToLocalStorage({name: displayName, picture: profilePicUrl});
			}
		} catch (err) {}
		return _starl_user_provider;
	} catch (e) {
		notifyServerFailure();
		return null;
	}
}

async function loadCacheStatus() {
	const panel = document.getElementById('cache-status');
	if (!panel) {
		return;
	}
	const token = getAccessToken();
	if (!token) {
		panel.textContent = 'Sign in to see cache status.';
		return;
	}
	try {
		const response = await fetch(getApiBase() + '/cache/status', {headers: {'Authorization': 'Bearer ' + token}});
		const authClient = window.starlAuth;
		if (
			authClient &&
			typeof authClient.handleAuthFailure === 'function' &&
			authClient.handleAuthFailure(response)
		) {
			return;
		}
		const data = await response.json();
		if (!response.ok) {
			if (response.status >= 500) {
				notifyServerFailure();
			}
			panel.textContent = 'Cache status unavailable.';
			return;
		}
		const audioCount = Number(data.audio_count) || 0;
		const imageCount = Number(data.image_count) || 0;
		const audioMb = ((Number(data.audio_bytes) || 0) / (1024 * 1024)).toFixed(1);
		const imageMb = ((Number(data.image_bytes) || 0) / (1024 * 1024)).toFixed(1);
		panel.textContent =
			audioCount +
			' tracks cached, ' +
			imageCount +
			' images cached (' +
			audioMb +
			' MB audio, ' +
			imageMb +
			' MB images).';

		try {
			if (window.starlMediaCache && typeof window.starlMediaCache.getCacheStats === 'function') {
				const local = await window.starlMediaCache.getCacheStats();
				const la = Number(local.audio_count) || 0;
				const lb = ((Number(local.audio_bytes) || 0) / (1024 * 1024)).toFixed(1);
				const li = Number(local.image_count) || 0;
				const lbimg = ((Number(local.image_bytes) || 0) / (1024 * 1024)).toFixed(1);
				panel.textContent +=
					' - local: ' + la + ' tracks, ' + li + ' images (' + lb + ' MB audio, ' + lbimg + ' MB images).';
			}
		} catch (err) {
			// ignore local cache errors
		}
	} catch (error) {
		notifyServerFailure();
		panel.textContent = 'Cache status unavailable.';
	}
}

loadCacheStatus();

window.addEventListener('starl-server-connection-state', (event) => {
	if (!event || !event.detail || !event.detail.online) {
		return;
	}
	fetchUserProvider();
	loadCacheStatus();
});

document.addEventListener('DOMContentLoaded', () => {
	const clearBtn = document.getElementById('clear-local-cache-button');
	if (!clearBtn) return;
	clearBtn.addEventListener('click', async () => {
		try {
			if (!confirm('Clear local cache? This will remove downloaded tracks and images from this device.')) return;
		} catch (e) {
			return;
		}
		clearBtn.disabled = true;
		const orig = clearBtn.textContent;
		clearBtn.textContent = 'Clearing...';
		try {
			if (window.starlMediaCache && typeof window.starlMediaCache.clearCache === 'function') {
				await window.starlMediaCache.clearCache();
			}
		} catch (err) {
			// ignore
		}
		await loadCacheStatus();
		clearBtn.disabled = false;
		clearBtn.textContent = orig;
	});
});

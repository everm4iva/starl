async function checkHasCachedTracks() {
	if (!('indexedDB' in window)) return false;
	try {
		if (typeof indexedDB.databases === 'function') {
			const dbs = await indexedDB.databases();
			if (
				!dbs.some(function (d) {
					return d.name === 'starl-media-cache';
				})
			)
				return false;
		}
		const db = await new Promise(function (resolve) {
			const req = indexedDB.open('starl-media-cache');
			req.onsuccess = function () {
				resolve(req.result);
			};
			req.onerror = function () {
				resolve(null);
			};
			req.onblocked = function () {
				resolve(null);
			};
			req.onupgradeneeded = function () {
				try {
					req.transaction.abort();
				} catch (e) {}
			};
		});
		if (!db) return false;
		if (!db.objectStoreNames.contains('tracks')) {
			db.close();
			return false;
		}
		const count = await new Promise(function (resolve) {
			try {
				const tx = db.transaction('tracks', 'readonly');
				const r = tx.objectStore('tracks').count();
				r.onsuccess = function () {
					resolve(r.result || 0);
				};
				r.onerror = function () {
					resolve(0);
				};
			} catch (e) {
				resolve(0);
			}
		});
		db.close();
		return count > 0;
	} catch (e) {
		return false;
	}
}

function coolLogin() {
	const auth = window.starlAuth;
	const loginButtons = Array.from(document.querySelectorAll('[data-provider]'));
	const status = document.getElementById('login-status');
	const offlineButton = document.getElementById('login-button-cache');
	const offlineDivider = document.getElementById('login-offline-divider');

	if (!auth || !loginButtons.length || !status) {
		return;
	}

	function readTokenFromHash() {
		const hash = window.location.hash || '';
		if (!hash.startsWith('#')) {
			return '';
		}
		const params = new URLSearchParams(hash.slice(1));
		return params.get('access_token') || '';
	}

	async function finalizeLogin(token) {
		localStorage.setItem('starl_access_token', token);
		try {
			const response = await fetch(auth.getApiBase() + '/auth/login', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({access_token: token}),
			});
			if (!response.ok) {
				const text = await response.text();
				status.textContent = 'Server login failed: ' + response.status + ' ' + text;
				return false;
			}
		} catch (error) {
			status.textContent = 'Server login failed: ' + error.message;
			return false;
		}
		return true;
	}

	let _consuming = false;
	let _consumedDeeplink = null;
	async function consumeDeeplink() {
		if (_consuming) return false;
		const lastDeep = localStorage.getItem('starl_last_deeplink');
		if (!lastDeep || !/access_token/i.test(lastDeep)) return false;
		// only act on a deep link that arrived recently (this sign-in attempt),
		// never a stale token from a previous session.
		const ts = parseInt(localStorage.getItem('starl_last_deeplink_ts') || '0', 10);
		if (!ts || Date.now() - ts > 2 * 60 * 1000) return false;
		if (lastDeep === _consumedDeeplink) return false;
		_consuming = true;
		_consumedDeeplink = lastDeep;
		status.textContent = 'Finishing sign-in...';
		try {
			const ok = await auth.finalizeLoginFromUrl(lastDeep);
			if (ok) {
				try {
					localStorage.removeItem('starl_last_deeplink');
					localStorage.removeItem('starl_last_deeplink_ts');
				} catch (e) {}
				auth.exitCacheMode();
				window.location.replace('index.html');
				return true;
			}
			status.textContent = 'Sign-in did not complete. Tap a provider to try again.';
			_consumedDeeplink = null;
		} catch (error) {
			status.textContent = 'Sign-in error: ' + (error && error.message ? error.message : error);
			_consumedDeeplink = null;
		} finally {
			_consuming = false;
		}
		return false;
	}

	async function start() {
		const existing = auth.getAccessToken();
		if (existing) {
			const ok = await auth.validateToken(existing);
			if (ok) {
				auth.exitCacheMode();
				window.location.href = 'index.html';
				return;
			}
			auth.clearAccessToken();
		}

		if (await consumeDeeplink()) return;

		const tokenFromHash = readTokenFromHash();
		if (tokenFromHash) {
			status.textContent = 'Finishing login...';
			const ok = await finalizeLogin(tokenFromHash);
			window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
			if (ok) {
				auth.exitCacheMode();
				window.location.href = 'index.html';
				return;
			}
		}

		status.textContent = 'Choose method to sign in.';

		checkHasCachedTracks().then(function (hasCache) {
			if (hasCache && offlineButton && offlineDivider) {
				offlineDivider.style.display = '';
				offlineButton.style.display = '';
			}
		});
	}

	if (offlineButton) {
		offlineButton.addEventListener('click', function () {
			auth.enterCacheMode();
			window.location.href = 'index.html';
		});
	}

	// connect to server: opens the little sheet with your saved servers (+ create connection)
	const connectButton = document.getElementById('login-button-connect');
	if (connectButton) {
		connectButton.addEventListener('click', function () {
			if (window.starlServerMenu) window.starlServerMenu.open();
		});
	}

	// tapping google/discord doesn't jump straight to a server anymore - it opens
	// the public server picker first, so you choose who you're signing in with
	loginButtons.forEach((button) => {
		button.addEventListener('click', () => {
			const provider = button.dataset.provider || 'google';
			if (window.starlPublicServerPicker) window.starlPublicServerPicker.open(provider);
		});
	});

	// when the app returns from the external browser sign-in, Cordova fires
	// 'resume' (and, on some devices, 'deviceready' again). Re-check the stored
	// deep link on each so the login always completes even if the native
	// handleOpenURL injection was missed
	document.addEventListener('resume', function () {
		consumeDeeplink();
	}, false);
	document.addEventListener('deviceready', function () {
		consumeDeeplink();
	}, false);
	// visibilitychange is a WebView-level fallback that fires even when Cordova's
	// resume doesn't reach this page
	document.addEventListener('visibilitychange', function () {
		if (document.visibilityState === 'visible') consumeDeeplink();
	}, false);

	start();
}

coolLogin();

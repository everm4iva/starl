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

		const tokenFromHash = readTokenFromHash();
		const lastDeep = localStorage.getItem('starl_last_deeplink');
		if (lastDeep) {
			status.textContent = 'Last deeplink: ' + lastDeep;
			console.log('[starl] last deeplink:', lastDeep);
		}
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

	loginButtons.forEach((button) => {
		button.addEventListener('click', async () => {
			const provider = button.dataset.provider || 'google';
			status.textContent = 'Opening ' + provider.charAt(0).toUpperCase() + provider.slice(1) + ' sign-in...';
			window.location.href =
				auth.getApiBase() + '/auth/' + provider + '?return_to=' + encodeURIComponent(auth.getReturnUrl());
		});
	});

	start();
}

coolLogin();

function coolLogin() {
	const auth = window.starlAuth;
	const loginButtons = Array.from(document.querySelectorAll('[data-provider]'));
	const status = document.getElementById('login-status');

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
				window.location.href = 'index.html';
				return;
			}
		}

		status.textContent = 'Choose method to sign in.';
	}

	loginButtons.forEach(button => {
		button.addEventListener('click', async () => {
			const provider = button.dataset.provider || 'google';
			status.textContent = 'Opening ' + provider.charAt(0).toUpperCase() + provider.slice(1) + ' sign-in...';
			window.location.href = auth.getApiBase() + '/auth/' + provider + '?return_to=' + encodeURIComponent(auth.getReturnUrl());
		});
	});

	start();
}

coolLogin();

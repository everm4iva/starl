/**
 * ☆=========================================☆
 * Public server picker - who do you want to sign in with?
 * The sheet that opens when you tap "Continue with Google/Discord" on the login screen.
 * Lists the public servers from public-servers.js, you pick one, and it carries on to that
 * server's oauth flow.
 *
 * --- What this file does? ---
 * - open(provider): fetches the list and paints it (name, address, status dot)
 * - only "online" is actually connectable, everything else just blocks the tap with a message
 * - tapping an outdated row: asks you to confirm first ("some features may not work")
 * - tapping a good row: points the app at that server and jumps into its oauth page
 *
 * --- Dictionary / Terms / Extra details ---
 * - "provider" is "google" or "discord", same as the login button's data-provider
 * - status can be online / offline / unavailable / in repair / updating - each gets its own
 *   dot color, see styles/public-server-picker.css. anything unrecognised falls back to offline
 * - styling lives in styles/public-server-picker.css, built on the shared .srv- classes
 * ☆=========================================☆
 */

(function () {
	var overlayEl = null;

	// known statuses -> a css-safe slug + the label shown in the "can't connect" message
	var STATUS_SLUGS = {
		online: 'online',
		offline: 'offline',
		unavailable: 'unavailable',
		'in repair': 'repair',
		updating: 'updating',
	};

	function statusInfo(server) {
		var raw = String(server.status || 'offline').trim().toLowerCase();
		return {
			slug: STATUS_SLUGS[raw] || 'offline',
			label: raw,
			connectable: raw === 'online',
		};
	}

	function close() {
		if (overlayEl) overlayEl.remove();
		overlayEl = null;
	}

	function statusDot(info) {
		var dot = document.createElement('span');
		dot.className = 'pub-srv-dot pub-srv-dot--' + info.slug;
		return dot;
	}

	function goToServer(server, provider) {
		var auth = window.starlAuth;
		auth.setActiveServer(server.url);
		window.location.href = server.url + '/auth/' + provider + '?return_to=' + encodeURIComponent(auth.getReturnUrl());
	}

	function handlePick(server, provider, info) {
		if (!info.connectable) {
			close();
			window.starlConfirmDialog.alert("Can't connect - this server is currently " + info.label + '.');
			return;
		}
		if (server.outdated) {
			close();
			window.starlConfirmDialog.confirm(
				'This server (v' + server.version + ') is older than your app (v' + server.clientVersion + '). Some features may not work.',
				function () { goToServer(server, provider); },
			);
			return;
		}
		close();
		goToServer(server, provider);
	}

	function buildItem(server, provider) {
		var info = statusInfo(server);

		var item = document.createElement('div');
		item.className = 'srv-item pub-srv-item';

		var head = document.createElement('div');
		head.className = 'srv-item-head';

		head.appendChild(statusDot(info));

		var body = document.createElement('div');
		body.className = 'srv-item-body';
		var name = document.createElement('span');
		name.className = 'srv-item-name';
		name.textContent = server.name;
		var sub = document.createElement('span');
		sub.className = 'srv-item-sub';
		sub.textContent = server.url.replace(/^https?:\/\//i, '') + ' - ' + info.label;
		body.appendChild(name);
		body.appendChild(sub);

		head.appendChild(body);
		item.appendChild(head);

		head.addEventListener('click', function () { handlePick(server, provider, info); });

		return item;
	}

	async function open(provider) {
		close();

		overlayEl = document.createElement('div');
		overlayEl.className = 'srv-overlay';

		var sheet = document.createElement('div');
		sheet.className = 'srv-sheet';

		var title = document.createElement('div');
		title.className = 'srv-title';
		title.textContent = 'Choose a server';

		var listEl = document.createElement('div');
		listEl.className = 'srv-list';
		var loading = document.createElement('div');
		loading.className = 'srv-empty';
		loading.textContent = 'looking for servers...';
		listEl.appendChild(loading);

		sheet.appendChild(title);
		sheet.appendChild(listEl);
		overlayEl.appendChild(sheet);

		overlayEl.addEventListener('click', function (e) {
			if (e.target === overlayEl) close();
		});

		document.body.appendChild(overlayEl);

		var servers = await window.starlPublicServers.fetch();
		if (!overlayEl) return; // closed while we were fetching

		listEl.innerHTML = '';
		if (!servers.length) {
			var empty = document.createElement('div');
			empty.className = 'srv-empty';
			empty.textContent = 'no public servers found right now';
			listEl.appendChild(empty);
			return;
		}
		servers.forEach(function (server) { listEl.appendChild(buildItem(server, provider)); });
	}

	window.starlPublicServerPicker = {open: open, close: close};
})();

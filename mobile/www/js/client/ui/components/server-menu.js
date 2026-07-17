/**
 * ☆=========================================☆
 * Server menu - the "Connect to server" list
 * The little sheet that pops up from the login screen: every server you saved, each with a
 * 3-dot menu, and a "create connection" button down the bottom. Tapping a server connects.
 *
 * --- What this file does? ---
 * - open(): builds the overlay and paints the saved servers from starlConnections
 * - each row: picture, name, auth type, and a 3-dot that opens its little action menu
 * - the 3-dot menu: duplicate, edit, delete, ping (state shows on the button), see details
 * - tapping a row runs connect(), then drops you into the app on success
 * - "create connection" hands off to the connection form
 *
 * --- Dictionary / Terms / Extra details ---
 * - all the styling lives in styles/server-connect.css, we only add classes + set values here
 * - the row picture rides in as a --srv-pic css variable, so the css owns the look
 * ☆=========================================☆
 */

(function () {
	var overlayEl = null;

	function conns() {
		return window.starlConnections;
	}

	function close() {
		if (overlayEl) overlayEl.remove();
		overlayEl = null;
	}

	/* ☆======= small builders =======☆ */

	function iconSpan(name) {
		var i = document.createElement('span');
		i.className = 'srv-icon srv-icon--' + name;
		return i;
	}

	function menuRow(iconName, label, handler) {
		var row = document.createElement('button');
		row.type = 'button';
		row.className = 'srv-menu-item';
		row.appendChild(iconSpan(iconName));
		var text = document.createElement('span');
		text.className = 'srv-menu-label';
		text.textContent = label;
		row.appendChild(text);
		row.addEventListener('click', function (e) {
			e.preventDefault();
			e.stopPropagation();
			handler(row, text);
		});
		return row;
	}

	/* ☆======= the 3-dot action menu for one server =======☆ */

	function buildActionMenu(conn) {
		var menu = document.createElement('div');
		menu.className = 'srv-menu';

		// duplicate - clone it and repaint the list
		menu.appendChild(menuRow('copy', 'Duplicate', function () {
			conns().duplicate(conn.id);
			repaint();
		}));

		// edit - hand the connection to the form
		menu.appendChild(menuRow('edit', 'Edit', function () {
			close();
			window.starlConnectionForm.open(conn);
		}));

		// delete - drop it and repaint
		menu.appendChild(menuRow('delete', 'Delete', function () {
			conns().remove(conn.id);
			repaint();
		}));

		// ping - the state comes back right on this button, so you dont leave the menu
		menu.appendChild(menuRow('ping', 'Ping server', async function (row, text) {
			text.textContent = 'Ping server - pinging...';
			var r = await conns().ping(conn);
			if (r.state === 'active') text.textContent = 'Ping server - Active (' + r.latency + 'ms)';
			else if (r.state === 'offline') text.textContent = 'Ping server - offline';
			else text.textContent = 'Ping server - error ' + r.code;
		}));

		// see details - swaps in a little info panel with everything we know
		menu.appendChild(menuRow('details', 'See details', async function () {
			showDetails(conn);
		}));

		return menu;
	}

	/* ☆======= details panel =======☆ */

	async function showDetails(conn) {
		var panel = overlayEl.querySelector('.srv-details');
		panel.innerHTML = '';
		panel.classList.add('is-open');

		var meta = await conns().fetchMeta(conn);
		var rows = [
			['name', meta.name || conn.name || '-'],
			['host', conn.host || '-'],
			['port', conn.port || '(default)'],
			['auth type', meta.authMethod || conn.authMethod || '-'],
			['min version', meta.minVersion || '-'],
		];

		var ping = await conns().ping(conn);
		rows.push(['latency', ping.state === 'active' ? ping.latency + 'ms' : ping.state]);

		rows.forEach(function (pair) {
			var line = document.createElement('div');
			line.className = 'srv-detail-line';
			var k = document.createElement('span');
			k.className = 'srv-detail-key';
			k.textContent = pair[0];
			var v = document.createElement('span');
			v.className = 'srv-detail-val';
			v.textContent = String(pair[1]);
			line.appendChild(k);
			line.appendChild(v);
			panel.appendChild(line);
		});

		var back = document.createElement('button');
		back.type = 'button';
		back.className = 'srv-details-back';
		back.textContent = 'back';
		back.addEventListener('click', function () {
			panel.classList.remove('is-open');
		});
		panel.appendChild(back);
	}

	/* ☆======= one server row =======☆ */

	function buildItem(conn) {
		var item = document.createElement('div');
		item.className = 'srv-item';

		var head = document.createElement('div');
		head.className = 'srv-item-head';

		var pic = document.createElement('span');
		pic.className = 'srv-item-pic';
		if (conn.picture) pic.style.setProperty('--srv-pic', "url('" + conn.picture + "')");

		var body = document.createElement('div');
		body.className = 'srv-item-body';
		var name = document.createElement('span');
		name.className = 'srv-item-name';
		name.textContent = conn.name || 'server';
		var sub = document.createElement('span');
		sub.className = 'srv-item-sub';
		sub.textContent = (conn.authMethod || 'userpass') + ' - ' + (conn.host || '') + (conn.port ? ':' + conn.port : '');
		body.appendChild(name);
		body.appendChild(sub);

		var more = document.createElement('button');
		more.type = 'button';
		more.className = 'srv-item-more';
		more.appendChild(iconSpan('more'));

		head.appendChild(pic);
		head.appendChild(body);
		head.appendChild(more);
		item.appendChild(head);

		var menu = buildActionMenu(conn);
		menu.style.display = 'none';
		item.appendChild(menu);

		// the 3-dot just toggles this ones little menu (and shuts any other thats open)
		more.addEventListener('click', function (e) {
			e.preventDefault();
			e.stopPropagation();
			var isOpen = menu.style.display !== 'none';
			closeAllMenus();
			menu.style.display = isOpen ? 'none' : 'block';
			item.classList.toggle('is-open', !isOpen);
		});

		// tapping the row itself (not the 3-dot) is "connect me to this one"
		head.addEventListener('click', function () {
			doConnect(conn, item);
		});

		return item;
	}

	function closeAllMenus() {
		if (!overlayEl) return;
		overlayEl.querySelectorAll('.srv-menu').forEach(function (m) { m.style.display = 'none'; });
		overlayEl.querySelectorAll('.srv-item').forEach(function (i) { i.classList.remove('is-open'); });
	}

	/* ☆======= connect flow =======☆ */

	async function doConnect(conn, item) {
		var status = overlayEl.querySelector('.srv-status');
		status.textContent = 'connecting to ' + (conn.name || 'server') + '...';
		var r = await conns().connect(conn);
		if (r.ok) {
			status.textContent = 'connected! opening...';
			window.location.replace('index.html');
			return;
		}
		status.textContent = r.error || 'couldnt connect';
	}

	/* ☆======= paint =======☆ */

	function repaint() {
		if (!overlayEl) return;
		var listEl = overlayEl.querySelector('.srv-list');
		listEl.innerHTML = '';
		var all = conns().list();
		if (!all.length) {
			var empty = document.createElement('div');
			empty.className = 'srv-empty';
			empty.textContent = 'no servers yet - add one below :3';
			listEl.appendChild(empty);
		} else {
			all.forEach(function (conn) { listEl.appendChild(buildItem(conn)); });
		}
	}

	function open() {
		close();

		overlayEl = document.createElement('div');
		overlayEl.className = 'srv-overlay';

		var sheet = document.createElement('div');
		sheet.className = 'srv-sheet';

		var title = document.createElement('div');
		title.className = 'srv-title';
		title.textContent = 'Connect to server';

		var listEl = document.createElement('div');
		listEl.className = 'srv-list';

		var details = document.createElement('div');
		details.className = 'srv-details';

		var status = document.createElement('div');
		status.className = 'srv-status';

		var create = document.createElement('button');
		create.type = 'button';
		create.className = 'srv-create';
		create.appendChild(iconSpan('add'));
		var createLabel = document.createElement('span');
		createLabel.textContent = 'Create connection';
		create.appendChild(createLabel);
		create.addEventListener('click', function () {
			close();
			window.starlConnectionForm.open(null);
		});

		sheet.appendChild(title);
		sheet.appendChild(listEl);
		sheet.appendChild(details);
		sheet.appendChild(status);
		sheet.appendChild(create);
		overlayEl.appendChild(sheet);

		// a tap on the dim backdrop (outside the sheet) just closes the whole thing
		overlayEl.addEventListener('click', function (e) {
			if (e.target === overlayEl) close();
		});

		document.body.appendChild(overlayEl);
		repaint();
	}

	window.starlServerMenu = { open: open, close: close };
})();

/**
 * ☆=========================================☆
 * Connection form - make or edit a saved server
 * The little form behind "create connection" (and "edit"). You type a host, a client name,
 * and whatever the server asks for (pin / user / password), then save it to your list.
 *
 * --- What this file does? ---
 * - open(conn): opens blank for a new one, or pre-filled to edit an existing one
 * - it figures out the auth type from the server itself (/auth/mode), so you only see the
 *   fields you actually need, but you can still pick it by hand if the server is offline
 * - client name is kept clean live: letters + numbers only, up to 15, just like the server wants
 * - save writes it via starlConnections and pops you back to the server list
 *
 * --- Dictionary / Terms / Extra details ---
 * - styling is all in styles/server-connect.css, we only set classes + values here
 * - "detect" = ask the server which auth method it uses, so the form matches it
 * ☆=========================================☆
 */

(function () {
	var overlayEl = null;
	var draft = null;

	function conns() {
		return window.starlConnections;
	}

	function close() {
		if (overlayEl) overlayEl.remove();
		overlayEl = null;
		draft = null;
	}

	// letters + numbers only, capped at 15, same rule the server enforces
	function cleanClientName(raw) {
		return String(raw || '').replace(/[^a-z0-9]/gi, '').slice(0, 15);
	}

	/* ☆======= field builders =======☆ */

	function field(labelText, hintText) {
		var wrap = document.createElement('label');
		wrap.className = 'srv-field';
		var label = document.createElement('span');
		label.className = 'srv-field-label';
		label.textContent = labelText;
		if (hintText) {
			var hint = document.createElement('span');
			hint.className = 'srv-field-hint';
			hint.textContent = hintText;
			label.appendChild(hint);
		}
		var input = document.createElement('input');
		input.className = 'srv-input';
		input.type = 'text';
		wrap.appendChild(label);
		wrap.appendChild(input);
		return { wrap: wrap, input: input };
	}

	// draws only the cred inputs the chosen method needs, into the creds box
	function renderCreds(box, method) {
		box.innerHTML = '';
		if (method === 'none') {
			var note = document.createElement('div');
			note.className = 'srv-field-note';
			note.textContent = 'this server is open, no login needed :3';
			box.appendChild(note);
			return;
		}
		if (method === 'pin') {
			var pin = field('PIN');
			pin.input.type = 'password';
			pin.input.value = draft.pin || '';
			pin.input.addEventListener('input', function () { draft.pin = pin.input.value; });
			box.appendChild(pin.wrap);
			return;
		}
		if (method === 'userpass') {
			var user = field('Username');
			user.input.value = draft.username || '';
			user.input.addEventListener('input', function () { draft.username = user.input.value; });
			box.appendChild(user.wrap);
		}
		// both password and userpass need a password box
		var pass = field('Password');
		pass.input.type = 'password';
		pass.input.value = draft.password || '';
		pass.input.addEventListener('input', function () { draft.password = pass.input.value; });
		box.appendChild(pass.wrap);
	}

	/* ☆======= open =======☆ */

	function open(conn) {
		close();
		// editing keeps the id so save updates in place, a fresh one starts empty
		draft = conn ? Object.assign({}, conn) : { authMethod: 'userpass' };

		overlayEl = document.createElement('div');
		overlayEl.className = 'srv-overlay';

		var sheet = document.createElement('div');
		sheet.className = 'srv-sheet srv-form';

		var title = document.createElement('div');
		title.className = 'srv-title';
		title.textContent = conn ? 'Edit connection' : 'New connection';

		// host + optional port
		var host = field('Server ip / host', 'port optional');
		host.input.value = draft.host || '';
		host.input.addEventListener('input', function () { draft.host = host.input.value; });

		var port = field('Port', 'optional');
		port.input.type = 'number';
		port.input.value = draft.port || '';
		port.input.addEventListener('input', function () { draft.port = port.input.value.trim(); });

		// client name, kept clean as you type
		var client = field('Client name', 'a-z 0-9, max 15');
		client.input.value = draft.clientName || '';
		client.input.addEventListener('input', function () {
			var cleaned = cleanClientName(client.input.value);
			if (cleaned !== client.input.value) client.input.value = cleaned;
			draft.clientName = cleaned;
		});

		// auth method picker, gets auto-set by detect but you can pick it yourself too
		var methodWrap = document.createElement('label');
		methodWrap.className = 'srv-field';
		var methodLabel = document.createElement('span');
		methodLabel.className = 'srv-field-label';
		methodLabel.textContent = 'Auth type';
		var methodSel = document.createElement('select');
		methodSel.className = 'srv-input';
		[['userpass', 'username & password'], ['pin', 'pin'], ['password', 'password'], ['none', 'none (open)']].forEach(function (opt) {
			var o = document.createElement('option');
			o.value = opt[0];
			o.textContent = opt[1];
			methodSel.appendChild(o);
		});
		methodSel.value = draft.authMethod || 'userpass';
		methodWrap.appendChild(methodLabel);
		methodWrap.appendChild(methodSel);

		var creds = document.createElement('div');
		creds.className = 'srv-creds';

		methodSel.addEventListener('change', function () {
			draft.authMethod = methodSel.value;
			renderCreds(creds, draft.authMethod);
		});

		var status = document.createElement('div');
		status.className = 'srv-status';

		// detect: ask the server what it wants, then match the form to it
		var detectBtn = document.createElement('button');
		detectBtn.type = 'button';
		detectBtn.className = 'srv-btn srv-btn--ghost';
		detectBtn.textContent = 'Detect';
		detectBtn.addEventListener('click', async function () {
			if (!draft.host) { status.textContent = 'type a host first'; return; }
			status.textContent = 'asking the server...';
			var meta = await conns().fetchMeta(draft);
			if (!draft) return; // form got closed while we were waiting on the network
			if (meta.ok) {
				draft.authMethod = meta.authMethod;
				methodSel.value = meta.authMethod;
				renderCreds(creds, meta.authMethod);
				if (meta.name && !draft.name) draft.name = meta.name;
			}
			status.textContent = meta.ok ? ('this server uses: ' + meta.authMethod) : 'couldnt reach it, pick the type yourself';
		});

		var saveBtn = document.createElement('button');
		saveBtn.type = 'button';
		saveBtn.className = 'srv-btn srv-btn--primary';
		saveBtn.textContent = 'Save';
		saveBtn.addEventListener('click', function () {
			if (!draft.host) { status.textContent = 'a host is required'; return; }
			if (!draft.clientName) { status.textContent = 'a client name is required'; return; }
			if (!draft.name) draft.name = draft.host;
			conns().save(draft);
			close();
			window.starlServerMenu.open();
		});

		var cancelBtn = document.createElement('button');
		cancelBtn.type = 'button';
		cancelBtn.className = 'srv-btn srv-btn--ghost';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.addEventListener('click', function () {
			close();
			window.starlServerMenu.open();
		});

		var actions = document.createElement('div');
		actions.className = 'srv-form-actions';
		actions.appendChild(cancelBtn);
		actions.appendChild(detectBtn);
		actions.appendChild(saveBtn);

		sheet.appendChild(title);
		sheet.appendChild(host.wrap);
		sheet.appendChild(port.wrap);
		sheet.appendChild(client.wrap);
		sheet.appendChild(methodWrap);
		sheet.appendChild(creds);
		sheet.appendChild(status);
		sheet.appendChild(actions);
		overlayEl.appendChild(sheet);

		overlayEl.addEventListener('click', function (e) {
			if (e.target === overlayEl) close();
		});

		document.body.appendChild(overlayEl);
		renderCreds(creds, draft.authMethod || 'userpass');
	}

	window.starlConnectionForm = { open: open, close: close };
})();

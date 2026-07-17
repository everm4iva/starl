/**
 * ☆=========================================☆
 * Bottom sheet - slide-up sheet with backdrop
 * A reusable slide-up panel that appears from the bottom of the screen.
 * Any part of the app can call open() with a render function to fill it.
 *
 * --- What this file does? ---
 * - open(config): builds and shows the sheet; config.render(bodyEl) fills it
 * - close(): slides the sheet away and calls config.onClose when done
 * - Clicking the backdrop also closes the sheet
 * ☆=========================================☆
 */

(function () {
	let backdropEl = null;
	let sheetEl = null;
	let onCloseCallback = null;
	let closeTimer = null;

	/* ☆======= DOM setup =======☆ */

	function ensureDOM() {
		if (backdropEl) return;
		backdropEl = document.createElement('div');
		backdropEl.className = 'bottom-sheet-backdrop';
		backdropEl.addEventListener('click', close);
		document.body.appendChild(backdropEl);

		sheetEl = document.createElement('div');
		sheetEl.className = 'bottom-sheet';
		const handle = document.createElement('div');
		handle.className = 'bottom-sheet-handle';
		sheetEl.appendChild(handle);
		document.body.appendChild(sheetEl);
	}

	/* ☆======= Open / close =======☆ */

	function open(config) {
		ensureDOM();
		clearTimeout(closeTimer);

		// clear previous content except the handle
		while (sheetEl.children.length > 1) sheetEl.removeChild(sheetEl.lastChild);

		const body = document.createElement('div');
		body.className = 'bottom-sheet-body';
		if (config && typeof config.render === 'function') {
			config.render(body);
		}
		sheetEl.appendChild(body);

		onCloseCallback = config && typeof config.onClose === 'function' ? config.onClose : null;

		requestAnimationFrame(() => {
			backdropEl.classList.add('is-open');
			sheetEl.classList.add('is-open');
		});
	}

	function close() {
		if (!sheetEl) return;
		backdropEl.classList.remove('is-open');
		sheetEl.classList.remove('is-open');
		clearTimeout(closeTimer);
		closeTimer = setTimeout(() => {
			if (onCloseCallback) {
				onCloseCallback();
				onCloseCallback = null;
			}
		}, 350);
	}

	/* ☆======= Public API =======☆ */

	window.starlBottomSheet = {open, close};
})();

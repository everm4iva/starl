/*
Bottom sheet utility
-> creates and manages a slide-up bottom sheet with backdrop.
-> open(config) builds and shows the sheet; close() slides it away.
-> config: { render(sheetBodyEl), onClose? }
*/

(function () {
	let backdropEl = null;
	let sheetEl = null;
	let onCloseCallback = null;
	let closeTimer = null;

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

	function open(config) {
		ensureDOM();
		clearTimeout(closeTimer);

		// clear previous content except handle
		while (sheetEl.children.length > 1) sheetEl.removeChild(sheetEl.lastChild);

		const body = document.createElement('div');
		body.className = 'bottom-sheet-body';
		if (config && typeof config.render === 'function') {
			config.render(body);
		}
		sheetEl.appendChild(body);

		onCloseCallback = config && typeof config.onClose === 'function' ? config.onClose : null;

		// Trigger transition next frame
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

	window.starlBottomSheet = {open, close};
})();

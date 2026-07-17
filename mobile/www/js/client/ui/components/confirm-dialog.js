/**
 * ☆=========================================☆
 * Confirm dialog - a custom-styled alert/confirm, no native popups
 * Just a little centered sheet with a message and one or two buttons. Made generic on
 * purpose so anything in the app can use it, not just the public server picker.
 *
 * --- What this file does? ---
 * - alert(message): one "ok" button, just acknowledges and closes
 * - confirm(message, onConfirm, onCancel): "cancel" + "continue" buttons
 *
 * --- Dictionary / Terms / Extra details ---
 * - reuses the .srv-overlay / .srv-sheet look from server-connect.css, styling for the
 *   message + buttons lives in styles/confirm-dialog.css
 * ☆=========================================☆
 */

(function () {
	function close(overlayEl) {
		if (overlayEl) overlayEl.remove();
	}

	function build(message) {
		var overlayEl = document.createElement('div');
		overlayEl.className = 'srv-overlay confirm-overlay';

		var sheet = document.createElement('div');
		sheet.className = 'srv-sheet confirm-sheet';

		var text = document.createElement('div');
		text.className = 'confirm-message';
		text.textContent = message;

		var actions = document.createElement('div');
		actions.className = 'srv-form-actions confirm-actions';

		sheet.appendChild(text);
		sheet.appendChild(actions);
		overlayEl.appendChild(sheet);

		return {overlayEl: overlayEl, actions: actions};
	}

	function button(label, kind) {
		var btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'srv-btn ' + (kind === 'primary' ? 'srv-btn--primary' : 'srv-btn--ghost');
		btn.textContent = label;
		return btn;
	}

	function alert(message) {
		var built = build(message);
		var ok = button('OK', 'primary');
		ok.addEventListener('click', function () { close(built.overlayEl); });
		built.actions.appendChild(ok);
		document.body.appendChild(built.overlayEl);
	}

	function confirm(message, onConfirm, onCancel) {
		var built = build(message);
		var cancelBtn = button('Cancel', 'ghost');
		var continueBtn = button('Continue', 'primary');
		cancelBtn.addEventListener('click', function () {
			close(built.overlayEl);
			if (onCancel) onCancel();
		});
		continueBtn.addEventListener('click', function () {
			close(built.overlayEl);
			if (onConfirm) onConfirm();
		});
		built.actions.appendChild(cancelBtn);
		built.actions.appendChild(continueBtn);
		document.body.appendChild(built.overlayEl);
	}

	window.starlConfirmDialog = {alert: alert, confirm: confirm};
})();

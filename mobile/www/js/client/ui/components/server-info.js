/**
 * ☆=========================================☆
 * Server info - tap to ping the server, right there in the text
 * The "Server info" row in the account tab. No screen, no sheet - clicking it
 * pings the server and rewrites its own label with the result.
 *
 * --- What this file does? ---
 * - On click: ping GET /health and report one of:
 *     * "Active"            -> ping came back OK
 *     * "Offline"           -> no server to reach, or the ping failed
 *     * "Code <http code>"  -> server answered but with an error status
 *
 * --- Dictionary / Terms / Extra details ---
 * - even in offline / cache mode a tap still really tries the server - maybe it's back, or
 *   you're on the same wifi. we only say "Offline" if the ping actually fails, not upfront
 * - the ping has a short timeout so a dead server doesn't leave it spinning forever
 * ☆=========================================☆
 */

(function () {
	const BASE_LABEL = 'Server info';
	const PING_TIMEOUT_MS = 6000;

	function getApiBase() {
		if (typeof window.getApiBase === 'function') return window.getApiBase();
		return window.STARL_API_BASE || '';
	}

	function setLabel(textEl, suffix) {
		textEl.textContent = suffix ? BASE_LABEL + ' - ' + suffix : BASE_LABEL;
	}

	async function ping(textEl) {
		const base = getApiBase();
		// no configured server = nowhere to ping, so it's genuinely offline - duuh
		if (!base) {
			setLabel(textEl, 'Offline');
			return;
		}
		// even in offline / cache mode, a tap should actually try - the server might be back up,
		// or we're on the same wifi. only say Offline below if the ping really fails
		setLabel(textEl, 'Pinging…');

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
		try {
			const res = await fetch(base + '/health', {method: 'GET', signal: controller.signal});
			if (res.ok) {
				setLabel(textEl, 'Active');
			} else {
				setLabel(textEl, 'Code ' + res.status);
			}
		} catch (e) {
			// abort or network error -> we couldn't reach it at all, so it's offline - no shit bozo
			setLabel(textEl, 'Offline');
		} finally {
			clearTimeout(timer);
		}
	}

	function init() {
		const item = document.getElementById('about-server-info');
		if (!item) return;
		const textEl = item.querySelector('.item-text') || item;
		item.addEventListener('click', () => ping(textEl));
	}

	if (document.readyState !== 'loading') init();
	else document.addEventListener('DOMContentLoaded', init, {once: true});
})();

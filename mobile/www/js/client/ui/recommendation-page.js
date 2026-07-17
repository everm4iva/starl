/**
 * ☆=========================================☆
 * Recommendation page - a tiny builder for "pick one option per section" pages
 * Both Customize MIX and Customize Home are the same shape: a full-screen page with
 * a few sections, each offering a short list of choices where you pick exactly one.
 *
 * --- What this file does? ---
 * - create(config): returns { open, close } and wires the settings button that opens it
 * - Reads the current choices from an account-state section (so they sync across devices)
 * - Saves the moment you tap a choice; fires config.onChange(settings) if you pass one
 *
 * --- config shape ---
 *   {
 *     title:       'Customize MIX',
 *     buttonId:    'customize-mix-item',   // the account-tab row that opens it
 *     sectionName: 'mixSettings',          // account-state section it reads/writes
 *     defaults:    { artists:'new', genre:'random', mood:'consistent' },
 *     groups: [
 *       { key:'artists', title:'Artists', note:'...', options:[ {id, label, note?}, ... ] },
 *       ...
 *     ],
 *     onChange(settings) {}   // optional
 *   }
 *
 * --- Dictionary / Terms / Extra details ---
 * - one choice per section (single-select); the default is used for anything unset
 * - styles live in recommendation-settings.css (.rec-page / .rec-option-* / .rec-group-*)
 * ☆=========================================☆
 */

(function () {
	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function accountState() {
		return window.starlAccountState || null;
	}

	function create(config) {
		const cfg = config || {};
		const groups = Array.isArray(cfg.groups) ? cfg.groups : [];
		const defaults = cfg.defaults || {};
		let overlayEl = null;

		// backfill missing/invalid choices from the defaults so a half-saved blob is safe
		function readSettings() {
			const api = accountState();
			const stored = api && typeof api.getSection === 'function' ? api.getSection(cfg.sectionName, null) : null;
			const out = {...defaults};
			if (stored && typeof stored === 'object') {
				groups.forEach((group) => {
					const value = stored[group.key];
					if (group.options.some((opt) => opt.id === value)) out[group.key] = value;
				});
			}
			return out;
		}

		function saveSettings(settings) {
			const api = accountState();
			if (api && typeof api.setSection === 'function') {
				api.setSection(cfg.sectionName, settings, {skipRefresh: true});
			}
			if (typeof cfg.onChange === 'function') cfg.onChange(settings);
		}

		function buildGroups(scroll, settings) {
			groups.forEach((group) => {
				scroll.appendChild(el('div', 'rec-group-title', group.title));
				if (group.note) scroll.appendChild(el('div', 'rec-group-note', group.note));

				const list = el('div', 'rec-option-list');
				group.options.forEach((opt) => {
					const row = el('div', 'rec-option-row' + (settings[group.key] === opt.id ? ' is-selected' : ''));
					row.appendChild(el('div', 'rec-option-label', opt.label));
					if (opt.note) row.appendChild(el('div', 'rec-option-note', opt.note));
					row.addEventListener('click', () => {
						settings[group.key] = opt.id;
						// only one option in this group stays lit
						list.querySelectorAll('.rec-option-row').forEach((r) => r.classList.remove('is-selected'));
						row.classList.add('is-selected');
						saveSettings(settings);
					});
					list.appendChild(row);
				});
				scroll.appendChild(list);
			});
		}

		function ensureDOM() {
			if (overlayEl) return;
			overlayEl = el('div', 'rec-page hidden');

			const topbar = el('div', 'rec-topbar');
			const back = el('div', 'rec-back');
			back.addEventListener('click', close);
			topbar.appendChild(back);
			topbar.appendChild(el('div', 'rec-title', cfg.title || 'Settings'));
			overlayEl.appendChild(topbar);

			const scroll = el('div', 'rec-scroll');
			buildGroups(scroll, readSettings());
			overlayEl.appendChild(scroll);

			document.body.appendChild(overlayEl);
		}

		function open() {
			ensureDOM();
			// rebuild the choices from current state each open (another device may have changed them)
			const scroll = overlayEl.querySelector('.rec-scroll');
			if (scroll) {
				scroll.innerHTML = '';
				buildGroups(scroll, readSettings());
			}
			overlayEl.classList.remove('hidden');
		}

		function close() {
			if (overlayEl) overlayEl.classList.add('hidden');
		}

		function wireButton() {
			const item = document.getElementById(cfg.buttonId);
			if (item) item.addEventListener('click', open);
		}

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', wireButton, {once: true});
		} else {
			wireButton();
		}

		return {open, close};
	}

	// closes whichever recommendation page is on screen (used by the Android back button)
	function closeTop() {
		const openPage = document.querySelector('.rec-page:not(.hidden)');
		if (!openPage) return false;
		openPage.classList.add('hidden');
		return true;
	}

	window.starlRecommendationPage = {create, closeTop};
})();

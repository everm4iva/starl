/**
 * ☆=========================================☆
 * Home common - tiny shared helpers for the home recommendation rows
 * The four home rows (Recommended, New releases, Pick up albums, Pick up artists)
 * all need the same couple of chores: read a Customize Home setting, and paint a
 * cover onto a card. This keeps that in one place so each row file stays short.
 *
 * --- What this file does? ---
 * - getHomeSetting(key, fallback): read one choice from the 'homeSettings' section
 * - setCover(el, url): paint a background cover, going through the media cache if it can
 * - showRow(el, show): flip a whole home row visible/hidden
 * ☆=========================================☆
 */

(function () {
	const DEFAULTS = {general: 'lastTrack', newReleases: 'followed', pickAlbums: 'yes', pickArtists: 'yes'};

	function getHomeSetting(key, fallback) {
		const api = window.starlAccountState;
		const section = api && typeof api.getSection === 'function' ? api.getSection('homeSettings', null) : null;
		if (section && typeof section === 'object' && section[key] !== undefined) return section[key];
		return fallback !== undefined ? fallback : DEFAULTS[key];
	}

	function setCover(el, url) {
		if (!el || !url) return;
		const cache = window.starlMediaCache;
		if (cache && typeof cache.setImageEl === 'function') {
			cache.setImageEl(el, url, {variant: 'low'});
		} else {
			el.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
		}
	}

	function showRow(el, show) {
		if (el) el.classList.toggle('hidden', !show);
	}

	window.starlHomeCommon = {getHomeSetting, setCover, showRow};
})();

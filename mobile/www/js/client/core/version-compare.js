/**
 * ☆=========================================☆
 * Version compare - is version A older than version B?
 * Tiny shared helper, splits "1.2.3" style strings into numbers and compares
 * them piece by piece. Used by update-check.js and public-servers.js so both
 * agree on what "older" means.
 *
 * --- What this file does? ---
 * - parseVersion(): "1.2.3" -> [1, 2, 3], missing/garbage bits just become 0
 * - isOlderThan(a, b): true if version a is behind version b
 * ☆=========================================☆
 */

(function () {
	function parseVersion(v) {
		return String(v || '0')
			.split('.')
			.map((p) => parseInt(p, 10) || 0);
	}

	function isOlderThan(a, b) {
		const av = parseVersion(a);
		const bv = parseVersion(b);
		const len = Math.max(av.length, bv.length);
		for (let i = 0; i < len; i++) {
			const x = av[i] || 0;
			const y = bv[i] || 0;
			if (x < y) return true;
			if (x > y) return false;
		}
		return false;
	}

	window.starlVersionCompare = {parseVersion, isOlderThan};
})();

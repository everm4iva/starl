/**
 * ☆=========================================☆
 * StarlStorage - read the device's storage numbers.
 * Single action: getDeviceStorage -> { totalBytes, freeBytes, appBytes }.
 * ☆=========================================☆
 */
/* global cordova */

(function () {
	'use strict';

	function exec(success, error, action, args) {
		cordova.exec(success, error, 'StarlStorage', action, args || []);
	}

	const StarlStorage = {
		// success gets { totalBytes, freeBytes, appBytes } (all numbers, bytes)
		getDeviceStorage: function (success, error) {
			exec(success, error, 'getDeviceStorage', []);
		},
		// opens the system "save as" picker so the user chooses where the file lands.
		// success gets the saved file's content URI; error gets 'cancelled' if they backed out.
		saveTextFile: function (filename, mimeType, content, success, error) {
			exec(success, error, 'saveTextFile', [
				String(filename || 'export.json'),
				String(mimeType || 'application/json'),
				String(content == null ? '' : content),
			]);
		},
	};

	module.exports = StarlStorage;
})();

/**
 * ☆=========================================☆
 * MusicControls - control platform media controls.
 * Actions: create, updateIsPlaying, updateElapsed, destroy, subscribe.
 * ☆=========================================☆
 */
/* global cordova */

(function () {
	'use strict';

	function exec(success, error, action, args) {
		cordova.exec(success, error, 'MusicControls', action, args || []);
	}

	let subscribed = false;

	const MusicControls = {
		create: function (options, success, error) {
			exec(success, error, 'create', [options || {}]);
		},

		updateIsPlaying: function (isPlaying, success, error) {
			exec(success, error, 'updateIsPlaying', [{isPlaying: !!isPlaying}]);
		},

		updateElapsed: function (args, success, error) {
			// accept either (elapsed, duration) like music-controls2 or object
			let payload = args;
			if (typeof args === 'number') {
				payload = {elapsed: args};
			}
			exec(success, error, 'updateElapsed', [payload || {}]);
		},

		destroy: function (success, error) {
			exec(success, error, 'destroy', []);
		},

		subscribe: function (callback) {
			// keep one subscription alive (matches existing usage)
			if (subscribed) return;
			subscribed = true;
			exec(
				function (message) {
					if (typeof callback === 'function') callback(message);
				},
				function () {},
				'subscribe',
				[],
			);
		},

		listen: function () {
			// no-op for compatibility with cordova-plugin-music-controls
		},

		// native playback helpers: start a native foreground playback of a stream URL
		startNative: function (url, success, error) {
			exec(success, error, 'startNative', [{url: url}]);
		},

		playNative: function (success, error) {
			exec(success, error, 'playNative', []);
		},

		pauseNative: function (success, error) {
			exec(success, error, 'pauseNative', []);
		},

		stopNative: function (success, error) {
			exec(success, error, 'stopNative', []);
		},

		// returns 1 if the app was cold-started by tapping the notification (open-player flag),
		// 0 otherwise. Clears the flag on read so it fires only once per ice cold-start.
		getAndClearPendingOpenPlayer: function (success, error) {
			exec(success, error, 'getAndClearPendingOpenPlayer', []);
		},
	};

	module.exports = MusicControls;
})();

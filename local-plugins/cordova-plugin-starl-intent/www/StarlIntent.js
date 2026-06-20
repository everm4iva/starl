var exec = require('cordova/exec');

/**
 * StarlIntent - JS bridge for the Android share intent receiver.
 *
 * getInitialUrl(success, error)
 *   Resolves once with the URL that launched the app via a share, or "" if none.
 *
 * addShareListener(callback)
 *   fires callback({url}) every time a share URL arrives while the app is running.
 *   keeps the channel open (setKeepCallback on the Java side).
 */
var StarlIntent = {
	getInitialUrl: function (success, error) {
		exec(success, error, 'StarlIntent', 'getInitialUrl', []);
	},
	addShareListener: function (callback) {
		exec(callback, null, 'StarlIntent', 'addShareListener', []);
	},
};

module.exports = StarlIntent;

/**
 * ☆=========================================☆
 * StarlBackground - manage Android battery optimization settings.
 * Actions: isIgnoringBatteryOptimizations, requestIgnoreBatteryOptimizations, openBatteryOptimizationSettings, openAppSettings.
 * ☆=========================================☆
 */
/* global cordova */

(function () {
	'use strict';

	function exec(success, error, action, args) {
		cordova.exec(success, error, 'StarlBackground', action, args || []);
	}

	const StarlBackground = {
		isIgnoringBatteryOptimizations: function (success, error) {
			exec(success, error, 'isIgnoringBatteryOptimizations', []);
		},

		requestIgnoreBatteryOptimizations: function (success, error) {
			exec(success, error, 'requestIgnoreBatteryOptimizations', []);
		},

		openBatteryOptimizationSettings: function (success, error) {
			exec(success, error, 'openBatteryOptimizationSettings', []);
		},

		openAppSettings: function (success, error) {
			exec(success, error, 'openAppSettings', []);
		},
	};

	module.exports = StarlBackground;
})();

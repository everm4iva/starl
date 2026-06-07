var exec = require('cordova/exec');

module.exports = {
    // dismiss the Android 12+ splash screen. Call this once web UI is
    // ready to show (e.g. from a 'deviceready' handler).
    hide: function (success, error) {
        exec(success, error, 'StarlSplash', 'hide', []);
    }
};

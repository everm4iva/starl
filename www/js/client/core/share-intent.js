/**
 * ☆=========================================☆
 * Share intent - handle YouTube URLs shared to starl from other apps
 * Receives the URL via three paths (in priority order):
 *
 *   1. window._StarlBridge.getShareUrl() - @JavascriptInterface injected by
 *      hooks/after_prepare/add_share_intent.js into MainActivity
 *
 *   2. window.starlHandleShareUrl(url) - called directly by MainActivity's
 *      onNewIntent when the app is already running
 *
 *   3. StarlIntent cordova.exec (original plugin, kept as fallback)
 * ☆=========================================☆
 */
(function () {

    /* ☆======= Helpers =======☆ */

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[share-intent]');
        console.log.apply(console, args);
    }

    function toast(msg) {
        log('toast:', msg);
        if (window.starlLayout && typeof window.starlLayout.showToast === 'function') {
            starlLayout.showToast(msg);
        }
    }

    var _handled = false; // prevent double-play if multiple paths fire

    function handleSharedUrl(url) {
        if (!url || typeof url !== 'string') {
            log('handleSharedUrl: empty url, ignoring');
            return;
        }
        url = url.trim();
        log('handleSharedUrl received:', url);

        if (!/youtube\.com|youtu\.be/i.test(url)) {
            log('not a YouTube URL, ignoring');
            toast('starl: not a YouTube link');
            return;
        }

        if (_handled) {
            log('already handled a URL this session, skipping duplicate');
            return;
        }
        _handled = true;

        toast('starl: loading shared track…');

        var attempts = 0;
        function tryPlay() {
            attempts++;
            log('tryPlay attempt', attempts, 'starlPlayer ready:', !!(window.starlPlayer));
            if (window.starlPlayer && typeof window.starlPlayer.playFromSearch === 'function') {
                log('calling playFromSearch with url:', url);
                starlPlayer.playFromSearch({url: url});
                return;
            }
            if (attempts < 30) {
                setTimeout(tryPlay, 200);
            } else {
                log('ERROR: gave up waiting for starlPlayer after', attempts, 'attempts');
                toast('starl: player not ready, try again');
                _handled = false;
            }
        }
        tryPlay();
    }

    /* ☆======= Path 2: called by MainActivity.onNewIntent directly =======☆ */

    // java calls this when a share arrives while the app is already running
    window.starlHandleShareUrl = function (url) {
        log('starlHandleShareUrl (from Java onNewIntent):', url);
        _handled = false; // reset so a new share always plays
        handleSharedUrl(url);
    };

    /* ☆======= Paths 1 & 3: deviceready =======☆ */

    document.addEventListener('deviceready', function () {
        log('deviceready fired');
        log('  window._StarlBridge:', typeof window._StarlBridge);
        log('  window.StarlIntent:', typeof window.StarlIntent);

        /* --- path 1: @JavascriptInterface bridge (default) --- */
        if (window._StarlBridge && typeof window._StarlBridge.getShareUrl === 'function') {
            try {
                var bridgeUrl = _StarlBridge.getShareUrl();
                log('_StarlBridge.getShareUrl() returned:', JSON.stringify(bridgeUrl));
                if (bridgeUrl) handleSharedUrl(bridgeUrl);
            } catch (e) {
                log('_StarlBridge.getShareUrl() threw:', e);
            }
        } else {
            log('_StarlBridge not available (hook may not have run yet)');
        }

        /* --- path 3: cordova.exec plugin (fallback) --- */
        if (window.StarlIntent) {
            StarlIntent.getInitialUrl(function (url) {
                log('StarlIntent.getInitialUrl() returned:', JSON.stringify(url));
                if (url) handleSharedUrl(url);
            }, function (err) {
                log('StarlIntent.getInitialUrl() error (expected if class not found):', err);
            });

            StarlIntent.addShareListener(function (data) {
                log('StarlIntent.addShareListener fired:', data);
                if (data && data.url) {
                    _handled = false;
                    handleSharedUrl(data.url);
                }
            });
        } else {
            log('window.StarlIntent not available');
        }

    }, false);

})();

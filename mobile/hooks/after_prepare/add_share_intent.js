#!/usr/bin/env node
'use strict';

/**
 * after_prepare hook: patches MainActivity.java to expose shared YouTube URLs
 * to JavaScript via a @JavascriptInterface (_StarlBridge).
 *
 * Why a hook instead of a plugin?
 * Cordova plugin service registration (res/xml/config.xml) is unreliable
 * on this project - the fucking "class not found" error persists across "clean" rebuilds.
 * Patching MainActivity directly avoids the plugin manager entirely.
 */

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
	const platforms = context.opts.platforms || [];
	if (!platforms.includes('android')) return;

	const root = context.opts.projectRoot;
	const mainActivityPath = path.join(
		root,
		'platforms',
		'android',
		'app',
		'src',
		'main',
		'java',
		'com',
		'everm4iva',
		'starl',
		'MainActivity.java',
	);

	if (!fs.existsSync(mainActivityPath)) {
		console.warn('[add_share_intent] MainActivity.java not found at', mainActivityPath);
		return;
	}

	let src = fs.readFileSync(mainActivityPath, 'utf8');

	if (src.includes('_StarlBridge')) {
		console.log('[add_share_intent] already patched, skipping');
		return;
	}

	// add imports right after "import android.os.Bundle;"
	if (!src.includes('import android.content.Intent;')) {
		src = src.replace(
			'import android.os.Bundle;',
			'import android.os.Bundle;\nimport android.content.Intent;\nimport android.webkit.JavascriptInterface;',
		);
	}

	// capture the initial share intent before loadUrl(launchUrl)
	src = src.replace(
		'loadUrl(launchUrl);',
		'_starlShareUrl = _extractShareUrl(getIntent());\n        loadUrl(launchUrl);',
	);

	// inject the bridge code before the final closing brace of the class
	const injection = `
    // ---- _StarlBridge injected by hooks/after_prepare/add_share_intent.js ----

    private volatile String _starlShareUrl = null;

    /** pull the first YouTube/Spotify URL out of an ACTION_SEND text/plain intent.
     *  uses indexOf instead of split/regex to avoid Java source-level escape issues. */
    private String _extractShareUrl(Intent intent) {
        if (intent == null) return null;
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return null;
        if (!"text/plain".equals(intent.getType())) return null;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null) return null;
        int i = text.indexOf("http");
        while (i >= 0) {
            int j = i;
            while (j < text.length() && text.charAt(j) > ' ') j++;
            String word = text.substring(i, j);
            if (word.contains("youtube.com") || word.contains("youtu.be")
                    || word.contains("spotify.com")) return word;
            i = text.indexOf("http", j);
        }
        return null;
    }

    /** share handler while app is already running. */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String u = _extractShareUrl(intent);
        if (u != null) {
            _starlShareUrl = u;
            if (appView != null) {
                final String js = "javascript:window.starlHandleShareUrl&&window.starlHandleShareUrl('" + u + "')";
                runOnUiThread(() -> appView.loadUrl(js));
            }
        }
    }

    /** expose the pending share URL synchronously to JavaScript. */
    private class _StarlBridgeImpl {
        @JavascriptInterface
        public String getShareUrl() {
            String u = _starlShareUrl;
            _starlShareUrl = null;
            return u != null ? u : "";
        }
    }

    /** register _StarlBridge as a JavascriptInterface before the page loads. */
    @Override
    protected CordovaWebView makeWebView() {
        CordovaWebView wv = super.makeWebView();
        try {
            ((android.webkit.WebView) wv.getEngine().getView())
                .addJavascriptInterface(new _StarlBridgeImpl(), "_StarlBridge");
        } catch (Exception e) {
            android.util.Log.w("StarlBridge", "addJavascriptInterface failed: " + e.getMessage());
        }
        return wv;
    }

    // ---- end _StarlBridge ----
`;

	const lastBrace = src.lastIndexOf('}');
	src = src.substring(0, lastBrace) + injection + '\n}';

	fs.writeFileSync(mainActivityPath, src, 'utf8');
	console.log('[add_share_intent] patched MainActivity.java');
};

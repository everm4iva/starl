/**
 * Captures ACTION_SEND intents (YouTube/YouTube Music share) and delivers the
 * URL to JS via getInitialUrl() and addShareListener().
 *
 * two cases:
 *   1. App was launched by the share -> pendingUrl is set in pluginInitialize,
 *      JS reads it with getInitialUrl() after deviceready.
 *   2. App was already running -> onNewIntent fires, url is sent straight to
 *      the active addShareListener callback.
 */

package com.everm4iva.starl.intent;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.PluginResult;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class StarlIntent extends CordovaPlugin {

    private String pendingUrl = null;
    private CallbackContext shareListenerCallback = null;

    private static final String TAG = "StarlIntent";

    @Override
    protected void pluginInitialize() {
        Intent intent = cordova.getActivity().getIntent();
        Log.d(TAG, "pluginInitialize - action: " + (intent != null ? intent.getAction() : "null"));
        Log.d(TAG, "pluginInitialize - type: " + (intent != null ? intent.getType() : "null"));
        pendingUrl = extractUrlFromIntent(intent);
        Log.d(TAG, "pluginInitialize - pendingUrl: " + pendingUrl);
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        if ("getInitialUrl".equals(action)) {
            String url = pendingUrl;
            pendingUrl = null;
            Log.d(TAG, "getInitialUrl - returning: " + url);
            callbackContext.success(url != null ? url : "");
            return true;
        }
        if ("addShareListener".equals(action)) {
            shareListenerCallback = callbackContext;
            Log.d(TAG, "addShareListener - registered, pendingUrl: " + pendingUrl);
            if (pendingUrl != null) {
                deliverUrl(pendingUrl);
                pendingUrl = null;
            }
            return true;
        }
        return false;
    }

    @Override
    public void onNewIntent(Intent intent) {
        Log.d(TAG, "onNewIntent - action: " + (intent != null ? intent.getAction() : "null"));
        String url = extractUrlFromIntent(intent);
        Log.d(TAG, "onNewIntent - extracted url: " + url);
        if (url == null) return;
        if (shareListenerCallback != null) {
            deliverUrl(url);
        } else {
            pendingUrl = url;
        }
    }

    private void deliverUrl(String url) {
        if (shareListenerCallback == null) return;
        try {
            JSONObject data = new JSONObject();
            data.put("url", url);
            PluginResult result = new PluginResult(PluginResult.Status.OK, data);
            result.setKeepCallback(true);
            shareListenerCallback.sendPluginResult(result);
        } catch (JSONException e) {
            // ignore
        }
    }

    private String extractUrlFromIntent(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();

        if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(intent.getType())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            return extractYouTubeUrl(text);
        }

        if (Intent.ACTION_VIEW.equals(action)) {
            Uri data = intent.getData();
            if (data != null) {
                String url = data.toString();
                if (isYouTubeUrl(url)) return url;
            }
        }

        return null;
    }

    // pull the first YouTube-looking URL out of a shared text blob.
    // YouTube typically shares "title - https://youtu.be/ID" or just the URL...
    private String extractYouTubeUrl(String text) {
        if (text == null) return null;
        String trimmed = text.trim();
        // single bare URL
        if (trimmed.startsWith("http") && !trimmed.contains(" ") && isYouTubeUrl(trimmed)) {
            return trimmed;
        }
        // URL embedded in longer text
        for (String word : trimmed.split("\\s+")) {
            if (word.startsWith("http") && isYouTubeUrl(word)) {
                return word;
            }
        }
        return null;
    }

    private boolean isYouTubeUrl(String url) {
        if (url == null) return false;
        return url.contains("youtube.com") || url.contains("youtu.be");
    }
}

package com.everm4iva.starl.splash;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;

/**
 * StarlSplash
 *
 * the starl icon is shown on the Android 12+ splash screen via the
 * ic_cdv_splashscreen drawable that this plugin overrides (see plugin.xml).
 *
 * on the JS side, call StarlSplash.hide() once the web app is ready so the
 * splash does not linger longer than the content takes to paint.
 */
public class StarlSplash extends CordovaPlugin {

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) {
        if ("hide".equals(action)) {
            hideSplash();
            callbackContext.success();
            return true;
        }
        return false;
    }

    private void hideSplash() {
        final Activity act = this.cordova.getActivity();
        if (act == null) return;

        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    // android 12+ keeps the splash as a child of the content view
                    // until the first frame is drawn. Cordova removes it on its
                    // own, but client nudge it: request a layout pass so the
                    // splash's keep-on-screen condition is re-evaluated.
                    View content = act.findViewById(android.R.id.content);
                    if (content != null) {
                        content.requestLayout();
                        content.invalidate();
                    }
                } catch (Exception ignored) {}
            }
        });
    }
}

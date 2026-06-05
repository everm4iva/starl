package com.everm4iva.starl.statusbar;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import org.apache.cordova.CordovaPlugin;

public class StatusBarManager extends CordovaPlugin {
    @Override
    protected void pluginInitialize() {
        try {
            Activity act = this.cordova.getActivity();
            if (act == null) return;
            Window w = act.getWindow();
            if (w == null) return;

            // Let the app draw behind the status bar and make it transparent
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
                w.setStatusBarColor(Color.TRANSPARENT);

                View decor = w.getDecorView();
                int ui = decor.getSystemUiVisibility();
                // Ensure light-status-bar flag is cleared so icons are white
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    ui &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                }
                decor.setSystemUiVisibility(ui);
            }
        } catch (Exception ignored) {}
    }
}

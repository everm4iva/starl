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
        applyTransparentStatusBar();
    }

    @Override
    public void onResume(boolean multitasking) {
        super.onResume(multitasking);
        // some OEM ROMs / other plugins reset window flags; re-apply when client comes back.
        applyTransparentStatusBar();
    }

    private void applyTransparentStatusBar() {
        final Activity act = this.cordova.getActivity();
        if (act == null) return;

        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Window w = act.getWindow();
                    if (w == null) return;
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return;

                    // let the app draw behind the status bar and make it transparent.
                    w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                    w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
                    w.setStatusBarColor(Color.TRANSPARENT);

                    View decor = w.getDecorView();
                    int ui = decor.getSystemUiVisibility();

                    // lay the content out fullscreen so the WebView draws *behind* the
                    // status bar instead of leaving a solid window-background strip.
                    ui |= View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;

                    // ensure light-status-bar flag is cleared so icons stay white.
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        ui &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    }
                    decor.setSystemUiVisibility(ui);

                    // android 10+ draws a translucent contrast "scrim" behind a transparent status bar by default - that is the unwanted background. disabling it lets the app content show through.
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        w.setStatusBarContrastEnforced(false);
                    }
                } catch (Exception ignored) {}
            }
        });
    }
}

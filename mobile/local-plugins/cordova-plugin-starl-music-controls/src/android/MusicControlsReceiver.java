package com.everm4iva.starl.musiccontrols;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

public class MusicControlsReceiver extends BroadcastReceiver {
	@Override
	public void onReceive(Context context, Intent intent) {
		if (intent == null || intent.getAction() == null) return;
		// forward the notification action to the native foreground service so
		// play/pause works even when the WebView is backgrounded or gone.
		try {
			Intent serviceIntent = new Intent(context, MediaPlaybackService.class);
			serviceIntent.setAction(intent.getAction());
			ContextCompat.startForegroundService(context, serviceIntent);
		} catch (Exception ignored) {}

		// if the Cordova plugin is still alive, also forward the action to JS so
		// the WebView player state stays in sync when possible.
		if (MusicControls.getInstance() == null) {
			try {
				Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
				if (launchIntent != null) {
					launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
					context.startActivity(launchIntent);
				}
			} catch (Exception ignored) {}
			return;
		}

		MusicControls.dispatchAction(intent.getAction());
	}
}

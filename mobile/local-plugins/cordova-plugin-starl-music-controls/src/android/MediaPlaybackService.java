package com.everm4iva.starl.musiccontrols;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.IOException;

public class MediaPlaybackService extends Service {
	private static final String TAG = "MediaPlaybackService";
	private MediaPlayer player = null;
	private String currentUri = null;
	// without these, the CPU sleeps and Wi-Fi powers down when the screen locks
	// or battery saver kicks in, which stalls streaming/decoding and stops playback
	private PowerManager.WakeLock wakeLock = null;
	private WifiManager.WifiLock wifiLock = null;
	// AUDIOFOCUS_GAIN for the WebView audio - the media contract that keeps the OS from
	// denying/pausing a fresh background play() on auto-advance. see AudioFocusHelper
	private AudioFocusHelper audioFocus = null;

	// debounce lock release: a backgrounded queue auto-advance pauses the audio for a
	// split second between tracks. dropping the CPU/Wi-Fi locks that instant lets Doze
	// throttle the WebView right as the next track decodes -> stall -> the pause/play
	// stutter loop. so we delay the release and cancel it if playback resumes in time
	private static final long LOCK_RELEASE_DELAY_MS = 6000L;
	private final android.os.Handler lockHandler = new android.os.Handler(android.os.Looper.getMainLooper());
	private Runnable pendingLockRelease = null;

	@Override
	public void onCreate() {
		super.onCreate();
		audioFocus = new AudioFocusHelper(this);
	}

	@Override
	public int onStartCommand(Intent intent, int flags, int startId) {
		String action = intent == null ? null : intent.getAction();
		if (action == null) {
			action = MusicControls.ACTION_START_SERVICE;
		}

		try {
			if (MusicControls.ACTION_PLAY_URI.equals(action)) {
				String uri = intent.getStringExtra("uri");
				if (uri != null) {
					playUri(uri);
				} else if (player != null) {
					// resume
					if (!player.isPlaying()) {
						acquireLocks();
						player.start();
					}
					refreshNotification();
				}
				return START_STICKY;
			}

			if (MusicControls.ACTION_PLAY.equals(action)) {
				if (player != null && !player.isPlaying()) {
					acquireLocks();
					player.start();
				}
				refreshNotification();
				return START_STICKY;
			}

			if (MusicControls.ACTION_PAUSE.equals(action)) {
				if (player != null && player.isPlaying()) player.pause();
				// don't drop the locks the instant we see a pause - a between-tracks
				// auto-advance blips "paused" for under a second. schedule the release and
				// let a quick resume cancel it, so the CPU/Wi-Fi stay up across the gap.
				// a genuine sustained pause still releases after the delay (battery-friendly)
				scheduleLockRelease();
				refreshNotification();
				return START_STICKY;
			}

			if (MusicControls.ACTION_NEXT.equals(action) || MusicControls.ACTION_PREVIOUS.equals(action)) {
				// forward next/previous to the plugin (if available) so JS player can handle track change
				try {
					MusicControls.dispatchAction(action);
				} catch (Exception ignored) {}
				refreshNotification();
				return START_STICKY;
			}

			if (MusicControls.ACTION_STOP_NATIVE.equals(action)) {
				stopAndRelease();
				stopForeground(true);
				stopSelf();
				return START_NOT_STICKY;
			}

			if (MusicControls.ACTION_DESTROY.equals(action)) {
				// this arrives via startForegroundService (from MusicControlsReceiver on
				// notification swipe).
				// must call startForeground() before stopForeground() or Android 8+ kills the app for not showin within 5 seconds
				try { startForeground(7824, buildFallbackNotification()); } catch (Exception ignored) {}
				stopAndRelease();
				stopForeground(true);
				stopSelf();
				return START_NOT_STICKY;
			}

			if (MusicControls.ACTION_START_SERVICE.equals(action)) {
				// the service runs as a foreground service while the WebView audio is playing in the background. hold a partial wake lock + Wi-Fi lock so the CPU/Wi-Fi don't power down (doze / battery saver) and stall the WebView's decoding/streaming when the screen is off :(
				acquireLocks();
				refreshNotification();
				return START_STICKY;
			}
		} catch (Exception e) {
			Log.w(TAG, "onStartCommand error", e);
		}

		// default behavior: stop service
		stopForeground(true);
		stopSelf();
		return START_NOT_STICKY;
	}

	private void playUri(String uri) {
		try {
			if (player == null) {
				player = new MediaPlayer();
				player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
			} else {
				player.reset();
			}
			// keep the CPU awake for the duration of playback so the screen turning
			// off (lock) or Doze doesn't suspend decoding mid-track
			player.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
			acquireLocks();
			// re-set listeners after every reset() - reset() clears them
			player.setOnPreparedListener(mp -> {
				// refresh notification now that client tells what it is playing
				refreshNotification();
				mp.start();
			});
			player.setOnCompletionListener(mp -> {
				stopAndRelease();
				stopForeground(true);
				stopSelf();
			});
			currentUri = uri;
			player.setDataSource(uri);
			// show to foreground immediately so Android doesn't kill the service
			// before onPrepared fires (prepareAsync can take several seconds over network)
			startForeground(7824, MusicControls.getInstance() != null ? MusicControls.getInstance().buildNotification() : buildFallbackNotification());
			player.prepareAsync();
		} catch (IOException e) {
			Log.w(TAG, "Failed to play uri: " + uri, e);
			stopAndRelease();
		}
	}

	private void refreshNotification() {
		try {
			// prefer the notification already built by MusicControls.renderNotification()
			// on a background thread (which fetched artwork, etc.) rather than rebuilding
			// here on the main thread - avoids a second visual redraw and prevents
			// potentially blocking the main thread on a network artwork fetch
			Notification cached = MusicControls.getLastNotification();
			Notification notification = cached != null ? cached : buildFallbackNotification();
			startForeground(7824, notification);
		} catch (Exception e) {
			Log.w(TAG, "Failed to refresh notification", e);
		}
	}

	private void stopAndRelease() {
		try {
			if (player != null) {
				try { player.stop(); } catch (Exception ignored) {}
				try { player.release(); } catch (Exception ignored) {}
				player = null;
				currentUri = null;
			}
		} catch (Exception ignored) {}
		cancelPendingLockRelease();
		releaseLocks();
		// a real stop (completion / STOP / DESTROY) gives focus back - be a good citizen
		if (audioFocus != null) audioFocus.abandonFocus();
	}

	// schedule the wake/Wi-Fi locks to drop after a grace period. a resume (acquireLocks)
	// cancels it; a real sustained pause lets it fire. keeps the CPU/Wi-Fi steady across
	// the sub-second gap of a background auto-advance instead of flapping them off/on
	private void scheduleLockRelease() {
		cancelPendingLockRelease();
		pendingLockRelease = () -> {
			pendingLockRelease = null;
			releaseLocks();
		};
		lockHandler.postDelayed(pendingLockRelease, LOCK_RELEASE_DELAY_MS);
	}

	private void cancelPendingLockRelease() {
		if (pendingLockRelease != null) {
			lockHandler.removeCallbacks(pendingLockRelease);
			pendingLockRelease = null;
		}
	}

	private void acquireLocks() {
		// playback (re)started - kill any scheduled release so the gap between tracks
		// doesn't yank the locks out from under the decoder
		cancelPendingLockRelease();
		// grab audio focus too. held from first play until a real stop (NOT dropped on the
		// between-track pause gap), so the OS keeps letting the WebView audio play in the bg
		if (audioFocus != null) audioFocus.requestFocus();
		try {
			if (wakeLock == null) {
				PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
				if (pm != null) {
					wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "starl:playback");
					wakeLock.setReferenceCounted(false);
				}
			}
			if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
		} catch (Exception e) {
			Log.w(TAG, "Failed to acquire wake lock", e);
		}
		try {
			if (wifiLock == null) {
				WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
				if (wm != null) {
					int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
							? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
							: WifiManager.WIFI_MODE_FULL_HIGH_PERF;
					wifiLock = wm.createWifiLock(mode, "starl:wifi");
					wifiLock.setReferenceCounted(false);
				}
			}
			if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
		} catch (Exception e) {
			Log.w(TAG, "Failed to acquire wifi lock", e);
		}
	}

	private void releaseLocks() {
		try {
			if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
		} catch (Exception ignored) {}
		try {
			if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
		} catch (Exception ignored) {}
	}

	private Notification buildFallbackNotification() {
		// shown when the Cordova plugin isn't initialized yet (ex: Android restarted
		// the sticky service after killing the process). use the last-known track info
		// from prefs and build a proper MediaStyle notification so it looks consistent
		Context context = getApplicationContext();

		android.content.SharedPreferences prefs = context
				.getSharedPreferences("starl_last_track", android.content.Context.MODE_PRIVATE);
		String track = prefs.getString("track", "");
		String artist = prefs.getString("artist", "");
		String title = (track == null || track.isEmpty()) ? "Starl" : track;
		String text = (artist == null || artist.isEmpty()) ? "" : artist;

		// ensure the notification channel exists (plugin may not have created it yet)
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			android.app.NotificationManager nm =
					(android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
			if (nm != null && nm.getNotificationChannel("starl_media") == null) {
				android.app.NotificationChannel ch = new android.app.NotificationChannel(
						"starl_media", "Playback", android.app.NotificationManager.IMPORTANCE_LOW);
				ch.setDescription("Media playback controls");
				try { ch.setSound(null, null); } catch (Exception ignored) {}
				nm.createNotificationChannel(ch);
			}
		}

		// small icon: prefer bundled ic_stat_starl, fall back to system play icon
		int smallIcon = android.R.drawable.ic_media_play;
		try {
			int resId = context.getResources().getIdentifier("ic_stat_starl", "drawable", context.getPackageName());
			if (resId != 0) smallIcon = resId;
		} catch (Exception ignored) {}

		// content intent: open the app
		PendingIntent contentIntent = null;
		try {
			Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
			if (launchIntent != null) {
				launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
				int flags = PendingIntent.FLAG_UPDATE_CURRENT;
				if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
				contentIntent = PendingIntent.getActivity(context, 1, launchIntent, flags);
			}
		} catch (Exception ignored) {}

		NotificationCompat.Builder builder = new NotificationCompat.Builder(context, "starl_media")
				.setSmallIcon(smallIcon)
				.setContentTitle(title)
				.setContentText(text)
				.setOnlyAlertOnce(true)
				.setOngoing(true)
				.setSilent(true)
				.setShowWhen(false)
				.setCategory(NotificationCompat.CATEGORY_TRANSPORT)
				.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
				.setDeleteIntent(fallbackActionIntent(context, MusicControls.ACTION_DESTROY));
		if (contentIntent != null) builder.setContentIntent(contentIntent);

		builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_previous, "Prev",
				fallbackActionIntent(context, MusicControls.ACTION_PREVIOUS)));
		builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_play, "Play",
				fallbackActionIntent(context, MusicControls.ACTION_PLAY)));
		builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_next, "Next",
				fallbackActionIntent(context, MusicControls.ACTION_NEXT)));
		builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_menu_close_clear_cancel, "Close",
				fallbackActionIntent(context, MusicControls.ACTION_DESTROY)));

		MediaStyle style = new MediaStyle().setShowActionsInCompactView(0, 1, 2);
		builder.setStyle(style);

		return builder.build();
	}

	private PendingIntent fallbackActionIntent(Context context, String action) {
		Intent intent = new Intent(action);
		intent.setClass(context, MusicControlsReceiver.class);
		int flags = PendingIntent.FLAG_UPDATE_CURRENT;
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
		return PendingIntent.getBroadcast(context, action.hashCode(), intent, flags);
	}

	@Override
	public IBinder onBind(Intent intent) {
		return null;
	}

	@Override
	public void onDestroy() {
		stopAndRelease();
		stopForeground(true);
		super.onDestroy();
	}
}

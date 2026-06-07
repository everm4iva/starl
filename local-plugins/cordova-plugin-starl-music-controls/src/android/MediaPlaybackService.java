package com.everm4iva.starl.musiccontrols;

import android.app.Notification;
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

import java.io.IOException;

public class MediaPlaybackService extends Service {
	private static final String TAG = "MediaPlaybackService";
	private MediaPlayer player = null;
	private String currentUri = null;
	// without these, the CPU sleeps and Wi-Fi powers down when the screen locks
	// or battery saver kicks in, which stalls streaming/decoding and stops playback.
	private PowerManager.WakeLock wakeLock = null;
	private WifiManager.WifiLock wifiLock = null;

	@Override
	public void onCreate() {
		super.onCreate();
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
				// drop the locks while paused so client don't pin the CPU/Wi-Fi awake.
				releaseLocks();
				refreshNotification();
				return START_STICKY;
			}

			if (MusicControls.ACTION_NEXT.equals(action) || MusicControls.ACTION_PREVIOUS.equals(action)) {
				// forward next/previous to the plugin (if available) so JS player can handle track change.
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

			if (MusicControls.ACTION_START_SERVICE.equals(action)) {
				// the service runs as a foreground service while the WebView audio is playing in the background. Hold a partial wake lock + Wi-Fi lock so the CPU/Wi-Fi don't power down (Doze / battery saver) and stall the WebView's decoding/streaming when the screen is off.
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
			// off (lock) or Doze doesn't suspend decoding mid-track.
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
			// promote to foreground immediately so Android doesn't kill the service
			// before onPrepared fires (prepareAsync can take several seconds over network).
			startForeground(7824, MusicControls.getInstance() != null ? MusicControls.getInstance().buildNotification() : buildFallbackNotification());
			player.prepareAsync();
		} catch (IOException e) {
			Log.w(TAG, "Failed to play uri: " + uri, e);
			stopAndRelease();
		}
	}

	private void refreshNotification() {
		try {
			MusicControls plugin = MusicControls.getInstance();
			Notification notification = plugin != null ? plugin.buildNotification() : buildFallbackNotification();
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
		releaseLocks();
	}

	private void acquireLocks() {
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
		// minimal silent notification for foreground service when plugin metadata unavailable
		Notification n = new Notification.Builder(getApplicationContext(), "starl_media").setContentTitle("Starl").setContentText("Playing").setSmallIcon(android.R.drawable.ic_media_play).build();
		return n;
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

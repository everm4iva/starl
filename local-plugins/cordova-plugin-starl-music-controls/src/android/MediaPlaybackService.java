package com.everm4iva.starl.musiccontrols;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.IBinder;
import android.util.Log;

import java.io.IOException;

public class MediaPlaybackService extends Service {
	private static final String TAG = "MediaPlaybackService";
	private MediaPlayer player = null;
	private String currentUri = null;

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
					if (!player.isPlaying()) player.start();
					refreshNotification();
				}
				return START_STICKY;
			}

			if (MusicControls.ACTION_PLAY.equals(action)) {
				if (player != null && !player.isPlaying()) player.start();
				refreshNotification();
				return START_STICKY;
			}

			if (MusicControls.ACTION_PAUSE.equals(action)) {
				if (player != null && player.isPlaying()) player.pause();
				refreshNotification();
				return START_STICKY;
			}

			if (MusicControls.ACTION_NEXT.equals(action) || MusicControls.ACTION_PREVIOUS.equals(action)) {
				// Forward next/previous to the plugin (if available) so JS player can handle track change.
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
				player.setOnPreparedListener(mp -> {
					try {
						startForeground(7824, MusicControls.getInstance() != null ? MusicControls.getInstance().buildNotification() : buildFallbackNotification());
					} catch (Exception ignored) {}
					mp.start();
				});
				player.setOnCompletionListener(mp -> {
					// stop foreground when finished
					stopAndRelease();
					stopForeground(true);
					stopSelf();
				});
			} else {
				player.reset();
			}
			currentUri = uri;
			player.setDataSource(uri);
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

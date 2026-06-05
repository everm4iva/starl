package com.everm4iva.starl.musiccontrols;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicReference;

public class MusicControls extends CordovaPlugin {
	public static final String ACTION_PLAY = "com.everm4iva.starl.musiccontrols.ACTION_PLAY";
	public static final String ACTION_PAUSE = "com.everm4iva.starl.musiccontrols.ACTION_PAUSE";
	public static final String ACTION_NEXT = "com.everm4iva.starl.musiccontrols.ACTION_NEXT";
	public static final String ACTION_PREVIOUS = "com.everm4iva.starl.musiccontrols.ACTION_PREVIOUS";
	public static final String ACTION_DESTROY = "com.everm4iva.starl.musiccontrols.ACTION_DESTROY";
	public static final String ACTION_PLAY_URI = "com.everm4iva.starl.musiccontrols.ACTION_PLAY_URI";
	public static final String ACTION_STOP_NATIVE = "com.everm4iva.starl.musiccontrols.ACTION_STOP_NATIVE";

	private static final String CHANNEL_ID = "starl_media";
	private static final int NOTIFICATION_ID = 7824;
	static final String ACTION_START_SERVICE = "com.everm4iva.starl.musiccontrols.ACTION_START_SERVICE";

	private static final AtomicReference<MusicControls> INSTANCE = new AtomicReference<>(null);

	private CallbackContext subscribeCallback;

	private String track = "";
	private String artist = "";
	private String album = "";
	private String cover = "";
	private Bitmap coverBitmap;
	private int durationSeconds = 0;
	private int elapsedSeconds = 0;
	private boolean isPlaying = false;
	private boolean hasNext = true;
	private boolean hasPrev = true;
	private boolean hasClose = true;

	// throttle notification re-renders when JS spams updateElapsed
	private long lastNotifyAtMs = 0L;
	private int lastNotifiedElapsedSeconds = -1;
	private boolean lastNotifiedIsPlaying = false;

	private MediaSessionCompat mediaSession;
	private final MediaSessionCompat.Callback mediaSessionCallback = new MediaSessionCompat.Callback() {
		@Override
		public void onPlay() {
			isPlaying = true;
			emitToJs("music-controls-play", null);
			cordova.getThreadPool().execute(() -> {
				ensureMediaSession();
				updateMediaSession();
				maybeRenderNotification(true);
				updateForegroundServiceState();
			});
		}

		@Override
		public void onPause() {
			isPlaying = false;
			emitToJs("music-controls-pause", null);
			cordova.getThreadPool().execute(() -> {
				ensureMediaSession();
				updateMediaSession();
				maybeRenderNotification(true);
				updateForegroundServiceState();
			});
		}

		@Override
		public void onSkipToNext() {
			emitToJs("music-controls-next", null);
		}

		@Override
		public void onSkipToPrevious() {
			emitToJs("music-controls-previous", null);
		}

		@Override
		public void onSeekTo(long pos) {
			JSONObject extra = new JSONObject();
			try {
				extra.put("position", Math.max(0, Math.round(pos / 1000.0)));
			} catch (JSONException ignored) {}
			emitToJs("music-controls-seek-to", extra);
		}
	};

	@Override
	protected void pluginInitialize() {
		INSTANCE.set(this);
		ensureMediaSession();
		ensureChannel();
	}

	@Override
	public void onReset() {
		if (INSTANCE.get() == this) {
			INSTANCE.set(null);
		}
		subscribeCallback = null;
		stopForegroundService();
		if (mediaSession != null) {
			try {
				mediaSession.setActive(false);
				mediaSession.release();
			} catch (Exception ignored) {}
			mediaSession = null;
		}
	}

	static MusicControls getInstance() {
		return INSTANCE.get();
	}

	@Override
	public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
		switch (action) {
			case "create":
				JSONObject options = args.optJSONObject(0);
				if (options == null) options = new JSONObject();
				applyOptions(options);
				if (durationSeconds > 0 && elapsedSeconds >= durationSeconds) {
					elapsedSeconds = 0;
				}
				cordova.getThreadPool().execute(() -> {
					ensureMediaSession();
					updateMediaSession();
					maybeRenderNotification(true);
					updateForegroundServiceState();
					callbackContext.success();
				});
				return true;
			case "updateIsPlaying":
				JSONObject isPlayingObj = args.optJSONObject(0);
				if (isPlayingObj != null) {
					isPlaying = isPlayingObj.optBoolean("isPlaying", false);
					if (isPlayingObj.has("playing")) {
						isPlaying = isPlayingObj.optBoolean("playing", isPlaying);
					}
				}
				if (isPlaying && durationSeconds > 0 && elapsedSeconds >= durationSeconds) {
					elapsedSeconds = 0;
				}
				cordova.getThreadPool().execute(() -> {
					ensureMediaSession();
					updateMediaSession();
					maybeRenderNotification(true);
					updateForegroundServiceState();
					callbackContext.success();
				});
				return true;
			case "updateElapsed":
				JSONObject elapsedObj = args.optJSONObject(0);
				if (elapsedObj != null) {
					if (elapsedObj.has("elapsed")) {
						elapsedSeconds = Math.max(0, elapsedObj.optInt("elapsed", elapsedSeconds));
					}
					if (elapsedObj.has("duration")) {
						durationSeconds = Math.max(0, elapsedObj.optInt("duration", durationSeconds));
					}
					if (elapsedObj.has("isPlaying")) {
						isPlaying = elapsedObj.optBoolean("isPlaying", isPlaying);
					}
					if (elapsedObj.has("playing")) {
						isPlaying = elapsedObj.optBoolean("playing", isPlaying);
					}
				}
				if (isPlaying && durationSeconds > 0 && elapsedSeconds >= durationSeconds) {
					// common -> when a track ended and was restarted/looped without resetting elapsed
					elapsedSeconds = 0;
				}
				cordova.getThreadPool().execute(() -> {
					ensureMediaSession();
					updateMediaSession();
					maybeRenderNotification(false);
					updateForegroundServiceState();
					callbackContext.success();
				});
				return true;
			case "destroy":
				cordova.getThreadPool().execute(() -> {
					destroyNotification();
					stopForegroundService();
					if (mediaSession != null) {
						try {
							mediaSession.setActive(false);
							mediaSession.release();
						} catch (Exception ignored) {}
						mediaSession = null;
					}
					callbackContext.success();
				});
				return true;
			case "startNative": {
				String uri = null;
				if (args != null && args.length() > 0) {
					JSONObject o = args.optJSONObject(0);
					if (o != null) uri = o.optString("url", null);
					if (uri == null && args.optString(0, null) != null) uri = args.optString(0, null);
				}
				Context context = cordova.getActivity().getApplicationContext();
				Intent intent = new Intent(context, MediaPlaybackService.class);
				intent.setAction(ACTION_PLAY_URI);
				if (uri != null) intent.putExtra("uri", uri);
				try {
					ContextCompat.startForegroundService(context, intent);
					callbackContext.success();
				} catch (Exception e) {
					callbackContext.error(e.getMessage());
				}
				return true;
			}
			case "playNative": {
				Context context = cordova.getActivity().getApplicationContext();
				Intent intent = new Intent(context, MediaPlaybackService.class);
				intent.setAction(ACTION_PLAY);
				ContextCompat.startForegroundService(context, intent);
				callbackContext.success();
				return true;
			}
			case "pauseNative": {
				Context context = cordova.getActivity().getApplicationContext();
				Intent intent = new Intent(context, MediaPlaybackService.class);
				intent.setAction(ACTION_PAUSE);
				ContextCompat.startForegroundService(context, intent);
				callbackContext.success();
				return true;
			}
			case "stopNative": {
				Context context = cordova.getActivity().getApplicationContext();
				Intent intent = new Intent(context, MediaPlaybackService.class);
				intent.setAction(ACTION_STOP_NATIVE);
				context.stopService(intent);
				callbackContext.success();
				return true;
			}
			case "subscribe":
				subscribeCallback = callbackContext;
				PluginResult pr = new PluginResult(PluginResult.Status.NO_RESULT);
				pr.setKeepCallback(true);
				callbackContext.sendPluginResult(pr);
				return true;
			default:
				return false;
		}
	}

	private void applyOptions(JSONObject options) {
		String maybeTrack = options.optString("track", null);
		if (maybeTrack == null || maybeTrack.isEmpty()) {
			maybeTrack = options.optString("title", "");
		}
		track = maybeTrack;

		String maybeArtist = options.optString("artist", null);
		if (maybeArtist == null || maybeArtist.isEmpty()) {
			maybeArtist = options.optString("artistName", "");
		}
		artist = maybeArtist;

		album = options.optString("album", album);
		int newDuration = options.has("duration") ? options.optInt("duration", durationSeconds) : durationSeconds;
		durationSeconds = Math.max(0, newDuration);
		int newElapsed = options.has("elapsed") ? options.optInt("elapsed", elapsedSeconds) : elapsedSeconds;
		elapsedSeconds = Math.max(0, newElapsed);

		String newCover = options.optString("cover", options.optString("artwork", options.optString("artworkUrl", cover)));
		if (newCover == null) newCover = "";
		if (!newCover.equals(cover)) {
			cover = newCover;
			coverBitmap = null;
		}

		if (options.has("isPlaying")) {
			isPlaying = options.optBoolean("isPlaying", isPlaying);
		}
		if (options.has("playing")) {
			isPlaying = options.optBoolean("playing", isPlaying);
		}
		if (options.has("hasNext")) {
			hasNext = options.optBoolean("hasNext", hasNext);
		}
		if (options.has("hasPrev")) {
			hasPrev = options.optBoolean("hasPrev", hasPrev);
		}
		if (options.has("hasClose")) {
			hasClose = options.optBoolean("hasClose", hasClose);
		}
	}

	private void ensureMediaSession() {
		if (mediaSession != null) return;
		Context context = cordova.getActivity().getApplicationContext();
		mediaSession = new MediaSessionCompat(context, "starl");
		try {
			mediaSession.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
		} catch (Exception ignored) {}
		try {
			mediaSession.setSessionActivity(contentPendingIntent());
		} catch (Exception ignored) {}
		mediaSession.setCallback(mediaSessionCallback);
		mediaSession.setActive(true);
	}

	private void updateMediaSession() {
		if (mediaSession == null) return;
		MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
				.putString(MediaMetadataCompat.METADATA_KEY_TITLE, track)
				.putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
				.putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album);
		if (durationSeconds > 0) {
			meta.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (long) durationSeconds * 1000L);
		}
		Bitmap art = getCoverBitmapBestEffort();
		if (art != null) {
			meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
			meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, art);
		}
		mediaSession.setMetadata(meta.build());

		long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE;
		if (hasNext) actions |= PlaybackStateCompat.ACTION_SKIP_TO_NEXT;
		if (hasPrev) actions |= PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS;
		actions |= PlaybackStateCompat.ACTION_SEEK_TO;

		int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
		long safeElapsed = Math.max(0, elapsedSeconds);
		if (durationSeconds > 0) {
			safeElapsed = Math.min(safeElapsed, (long) durationSeconds);
		}
		long positionMs = safeElapsed * 1000L;
		float speed = isPlaying ? 1f : 0f;

		PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
				.setActions(actions)
				// used elapsedRealtime timebase so Android can advance the position correctly
				.setState(state, positionMs, speed, SystemClock.elapsedRealtime())
				.build();
		mediaSession.setPlaybackState(playbackState);
	}

	private void maybeRenderNotification(boolean force) {
		// update the notification UI if:
		// - forced (play/pause/create), or
		// - playing state changed, or
		// - process has a known duration and enough time has passed
		long now = SystemClock.elapsedRealtime();
		boolean playingChanged = lastNotifiedIsPlaying != isPlaying;
		boolean elapsedChanged = lastNotifiedElapsedSeconds != elapsedSeconds;
		boolean hasProgress = durationSeconds > 0;

		if (!force) {
			if (!playingChanged && (!hasProgress || !elapsedChanged)) {
				return;
			}
			// avoid spamming NotificationManager when JS updates every few hundred ms.
			if (now - lastNotifyAtMs < 1000) {
				return;
			}
		}

		lastNotifyAtMs = now;
		lastNotifiedElapsedSeconds = elapsedSeconds;
		lastNotifiedIsPlaying = isPlaying;
		renderNotification();
	}

	private void updateForegroundServiceState() {
		Context context = cordova.getActivity().getApplicationContext();
		if (isPlaying) {
			Intent intent = new Intent(context, MediaPlaybackService.class);
			intent.setAction(ACTION_START_SERVICE);
			ContextCompat.startForegroundService(context, intent);
		} else {
			stopForegroundService();
		}
	}

	private void emitToJs(String message, JSONObject extra) {
		if (subscribeCallback == null) return;
		JSONObject payload = new JSONObject();
		try {
			payload.put("message", message);
			if (extra != null) {
				JSONArray names = extra.names();
				if (names != null) {
					for (int i = 0; i < names.length(); i++) {
						String key = names.optString(i, null);
						if (key != null) {
							payload.put(key, extra.opt(key));
						}
					}
				}
			}
		} catch (JSONException ignored) {}

		PluginResult pr = new PluginResult(PluginResult.Status.OK, payload);
		pr.setKeepCallback(true);
		subscribeCallback.sendPluginResult(pr);
	}

	private Bitmap getCoverBitmapBestEffort() {
		if (coverBitmap != null) return coverBitmap;
		String c = cover == null ? "" : cover.trim();
		if (c.isEmpty()) return null;
		try {
			if (c.startsWith("data:image")) {
				int comma = c.indexOf(',');
				if (comma > 0 && comma + 1 < c.length()) {
					String b64 = c.substring(comma + 1);
					byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
					Bitmap bm = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
					coverBitmap = scaleBitmapIfNeeded(bm);
					return coverBitmap;
				}
			}
			if (c.startsWith("http://") || c.startsWith("https://")) {
				URL url = new URL(c);
				HttpURLConnection conn = (HttpURLConnection) url.openConnection();
				conn.setConnectTimeout(4000);
				conn.setReadTimeout(6000);
				conn.setInstanceFollowRedirects(true);
				conn.connect();
				try (InputStream is = conn.getInputStream()) {
					Bitmap bm = BitmapFactory.decodeStream(is);
					coverBitmap = scaleBitmapIfNeeded(bm);
					return coverBitmap;
				} finally {
					conn.disconnect();
				}
			}

			// try local/other URI types (content://, file://, android.resource://) and plain file paths
			Context context = cordova.getActivity().getApplicationContext();
			Uri uri = Uri.parse(c);
			String scheme = uri.getScheme();
			if (scheme == null || scheme.isEmpty()) {
				// treat as a file path
				File f = new File(c);
				if (!f.exists()) return null;
				try (InputStream is = new FileInputStream(f)) {
					Bitmap bm = BitmapFactory.decodeStream(is);
					coverBitmap = scaleBitmapIfNeeded(bm);
					return coverBitmap;
				}
			}
			if ("file".equalsIgnoreCase(scheme)) {
				File f = new File(uri.getPath() == null ? "" : uri.getPath());
				if (!f.exists()) return null;
				try (InputStream is = new FileInputStream(f)) {
					Bitmap bm = BitmapFactory.decodeStream(is);
					coverBitmap = scaleBitmapIfNeeded(bm);
					return coverBitmap;
				}
			}
			ContentResolver resolver = context.getContentResolver();
			try (InputStream is = resolver.openInputStream(uri)) {
				if (is == null) return null;
				Bitmap bm = BitmapFactory.decodeStream(is);
				coverBitmap = scaleBitmapIfNeeded(bm);
				return coverBitmap;
			}
		} catch (Exception ignored) {}
		return null;
	}

	private Bitmap scaleBitmapIfNeeded(Bitmap bm) {
		if (bm == null) return null;
		int max = 512;
		int w = bm.getWidth();
		int h = bm.getHeight();
		if (w <= 0 || h <= 0) return bm;
		if (w <= max && h <= max) return bm;
		float scale = Math.min((float) max / (float) w, (float) max / (float) h);
		int nw = Math.max(1, Math.round(w * scale));
		int nh = Math.max(1, Math.round(h * scale));
		return Bitmap.createScaledBitmap(bm, nw, nh, true);
	}

	private void ensureChannel() {
		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
		Context context = cordova.getActivity().getApplicationContext();
		NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
		if (nm == null) return;

		NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
		if (existing != null) return;

		NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
		channel.setDescription("Media playback controls");
		// Media notifications should be silent.
		try {
			channel.setSound(null, null);
		} catch (Exception ignored) {}
		nm.createNotificationChannel(channel);
	}

	private PendingIntent actionPendingIntent(String action) {
		Context context = cordova.getActivity().getApplicationContext();
		Intent intent = new Intent(action);
		intent.setClass(context, MusicControlsReceiver.class);

		int flags = PendingIntent.FLAG_UPDATE_CURRENT;
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
			flags |= PendingIntent.FLAG_IMMUTABLE;
		}
		return PendingIntent.getBroadcast(context, action.hashCode(), intent, flags);
	}

	private PendingIntent contentPendingIntent() {
		Context context = cordova.getActivity().getApplicationContext();
		Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
		if (launchIntent == null) {
			launchIntent = new Intent();
		}

		int flags = PendingIntent.FLAG_UPDATE_CURRENT;
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
			flags |= PendingIntent.FLAG_IMMUTABLE;
		}
		return PendingIntent.getActivity(context, 0, launchIntent, flags);
	}

	private int getSmallIconResId() {
		Context context = cordova.getActivity().getApplicationContext();
		ApplicationInfo info = context.getApplicationInfo();
		// prefer a bundled monochrome notification icon named ic_stat_starl if provided by the app/plugin
		try {
			int resId = context.getResources().getIdentifier("ic_stat_starl", "drawable", context.getPackageName());
			if (resId != 0) return resId;
		} catch (Exception ignored) {}
		// also try mipmap (adaptive icons / launcher icons)
		try {
			int resId = context.getResources().getIdentifier("ic_stat_starl", "mipmap", context.getPackageName());
			if (resId != 0) return resId;
		} catch (Exception ignored) {}

		// try common notification / launcher names as fallbacks
		String[] candidates = new String[]{"ic_notification", "notification_icon", "ic_stat_notify", "ic_launcher_foreground", "ic_launcher"};
		for (String name : candidates) {
			try {
				int r = context.getResources().getIdentifier(name, "mipmap", context.getPackageName());
				if (r != 0) return r;
				r = context.getResources().getIdentifier(name, "drawable", context.getPackageName());
				if (r != 0) return r;
			} catch (Exception ignored) {}
		}

		// fallback to app icon or a system media icon
		if (info != null && info.icon != 0) return info.icon;
		return android.R.drawable.ic_media_play;
	}

	Notification buildNotification() {
		Context context = cordova.getActivity().getApplicationContext();
		ensureChannel();
		ensureMediaSession();
		updateMediaSession();

		Bitmap art = getCoverBitmapBestEffort();

		String title = (track == null || track.isEmpty()) ? "Playing" : track;
		String byline;
		if (artist != null && !artist.isEmpty() && album != null && !album.isEmpty()) {
			byline = artist + " \u2022 " + album;
		} else if (artist != null && !artist.isEmpty()) {
			byline = artist;
		} else if (album != null && !album.isEmpty()) {
			byline = album;
		} else {
			byline = "";
		}

		NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
				.setSmallIcon(getSmallIconResId())
				.setContentTitle(title)
				.setContentText(byline)
				.setSubText(album == null ? "" : album)
				.setOnlyAlertOnce(true)
				// make it swipable when paused (still closable via action button)
				.setOngoing(isPlaying)
				.setSilent(true)
				.setShowWhen(false)
				.setCategory(NotificationCompat.CATEGORY_TRANSPORT)
				.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
				.setContentIntent(contentPendingIntent());
		if (hasClose) {
			builder.setDeleteIntent(actionPendingIntent(ACTION_DESTROY));
		}
		if (durationSeconds > 0) {
			int dur = Math.max(0, durationSeconds);
			int el = Math.max(0, Math.min(elapsedSeconds, dur));
			builder.setProgress(dur, el, false);
		}
		if (art != null) {
			builder.setLargeIcon(art);
		}

		int compactIndex = 0;
		int compactPlayPauseIndex = -1;
		int compactPrevIndex = -1;
		int compactNextIndex = -1;
		if (hasPrev) {
			builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_previous, "Prev", actionPendingIntent(ACTION_PREVIOUS)));
			compactPrevIndex = compactIndex++;
		}

		if (isPlaying) {
			builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_pause, "Pause", actionPendingIntent(ACTION_PAUSE)));
		} else {
			builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_play, "Play", actionPendingIntent(ACTION_PLAY)));
		}
		compactPlayPauseIndex = compactIndex++;

		if (hasNext) {
			builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_media_next, "Next", actionPendingIntent(ACTION_NEXT)));
			compactNextIndex = compactIndex++;
		}

		if (hasClose) {
			builder.addAction(new NotificationCompat.Action(android.R.drawable.ic_menu_close_clear_cancel, "Close", actionPendingIntent(ACTION_DESTROY)));
			compactIndex++;
		}

		MediaStyle style = new MediaStyle();
		if (mediaSession != null) {
			style.setMediaSession(mediaSession.getSessionToken());
		}
		// prefer showing (Prev, Play/Pause, Next) in compact if present, else just Play/Pause
		if (compactPrevIndex >= 0 && compactPlayPauseIndex >= 0 && compactNextIndex >= 0) {
			style.setShowActionsInCompactView(compactPrevIndex, compactPlayPauseIndex, compactNextIndex);
		} else if (compactPlayPauseIndex >= 0) {
			style.setShowActionsInCompactView(compactPlayPauseIndex);
		}
		builder.setStyle(style);

		return builder.build();
	}

	private void renderNotification() {
		Context context = cordova.getActivity().getApplicationContext();
		NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, buildNotification());
	}

	private void destroyNotification() {
		Context context = cordova.getActivity().getApplicationContext();
		NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
	}

	private void stopForegroundService() {
		Context context = cordova.getActivity().getApplicationContext();
		Intent intent = new Intent(context, MediaPlaybackService.class);
		context.stopService(intent);
	}

	public static void dispatchAction(String action) {
		MusicControls plugin = INSTANCE.get();
		if (plugin == null) return;
		plugin.onNativeAction(action);
	}

	private void onNativeAction(String action) {
		String message;
		switch (action) {
			case ACTION_PLAY:
				message = "music-controls-play";
				break;
			case ACTION_PAUSE:
				message = "music-controls-pause";
				break;
			case ACTION_NEXT:
				message = "music-controls-next";
				break;
			case ACTION_PREVIOUS:
				message = "music-controls-previous";
				break;
			case ACTION_DESTROY:
				message = "music-controls-destroy";
				break;
			default:
				message = action;
		}

		if (ACTION_DESTROY.equals(action)) {
			cordova.getThreadPool().execute(() -> {
				destroyNotification();
				if (mediaSession != null) {
					try {
						mediaSession.setActive(false);
						mediaSession.release();
					} catch (Exception ignored) {}
					mediaSession = null;
				}
			});
		} else if (ACTION_PLAY.equals(action)) {
			isPlaying = true;
			// also drive JS for older notification-action taps
			emitToJs("music-controls-play", null);
			cordova.getThreadPool().execute(() -> {
				ensureMediaSession();
				updateMediaSession();
				maybeRenderNotification(true);
				updateForegroundServiceState();
			});
		} else if (ACTION_PAUSE.equals(action)) {
			isPlaying = false;
			emitToJs("music-controls-pause", null);
			cordova.getThreadPool().execute(() -> {
				ensureMediaSession();
				updateMediaSession();
				maybeRenderNotification(true);
				updateForegroundServiceState();
			});
		}

		emitToJs(message, null);
	}
}

package com.everm4iva.starl.musiccontrols;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;


/* Android AudioFocus for the WebView audio.
* The idea here WAS to also hold AUDIOFOCUS_GAIN so the OS treats that
 * WebView audio as a first-class media player (better background survival).
 * Turns out that backfires: the WebView (Chromium's AudioFocusDelegate) already
 * requests focus by itself, so grabbing it here too gives one app two focus owners.
 *
 * Android hands focus to one at a time, so the two just kept stealing it back and
 * forth - each steal pausing whoever lost - which showed up as the player doing
 * "play, stop, play, stop" on every tap. So requestFocus() is now a deliberate
 * no-op and we let the WebView own focus. ugh..
*/

class AudioFocusHelper {
	private static final String TAG = "StarlAudioFocus";

	private final AudioManager audioManager;
	private final Handler handler = new Handler(Looper.getMainLooper());

	// audioFocusRequest is the O+ way to request/abandon; keep it so abandon matches request
	private AudioFocusRequest focusRequest = null;
	private boolean holdingFocus = false;
	// true when WE paused because focus was lost transiently, so a later GAIN can resume us.
	// a permanent loss (another player took over) clears this - we don't fight back
	private boolean resumeOnFocusGain = false;

	private final AudioManager.OnAudioFocusChangeListener focusListener = focusChange -> {
		switch (focusChange) {
			case AudioManager.AUDIOFOCUS_GAIN:
				Log.i(TAG, "focus GAIN (resumeOnGain=" + resumeOnFocusGain + ")");
				if (resumeOnFocusGain) {
					resumeOnFocusGain = false;
					relay(MusicControls.ACTION_PLAY);
				}
				break;
			case AudioManager.AUDIOFOCUS_LOSS:
				// permanent loss - another app owns audio now. pause and let go
				Log.i(TAG, "focus LOSS (permanent)");
				resumeOnFocusGain = false;
				relay(MusicControls.ACTION_PAUSE);
				abandonFocus();
				break;
			case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
			case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
				// a call / notification / quick interruption. pause now, resume on gain
				Log.i(TAG, "focus LOSS (transient)");
				resumeOnFocusGain = true;
				relay(MusicControls.ACTION_PAUSE);
				break;
			default:
				break;
		}
	};

	AudioFocusHelper(Context context) {
		this.audioManager = (AudioManager) context.getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
	}

	// NO-OP on purpose. The WebView <audio> element ALREADY holds Android audio focus on its
	// own (Chromium's AudioFocusDelegate - you can see it in logcat). If we ALSO grab
	// AUDIOFOCUS_GAIN here, one app ends up with two focus owners and Android only lets one win
	boolean requestFocus() {
		return true;
	}

	// give focus back. called on real stop/destroy, not on the between-track pause gap
	void abandonFocus() {
		if (audioManager == null || !holdingFocus) return;
		try {
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
				if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
			} else {
				audioManager.abandonAudioFocus(focusListener);
			}
		} catch (Exception e) {
			Log.w(TAG, "abandonFocus failed", e);
		}
		holdingFocus = false;
		resumeOnFocusGain = false;
		Log.i(TAG, "abandonFocus");
	}

	// push a play/pause action to the JS player (WebView). stays quiet if the plugin is gone
	private void relay(String action) {
		try {
			MusicControls.dispatchAction(action);
		} catch (Exception ignored) {}
	}
}

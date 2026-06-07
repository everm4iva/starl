/**
 * ☆=========================================☆
 * Runtime notifications handler - MusicControls message routing
 * Parses and routes incoming messages from the Android lock-screen/notification
 * player (cordova-plugin-starl-music-controls) to the correct playback action.
 * Loaded before runtime-notifications.js which subscribes to these handlers.
 *
 * --- What this file does? ---
 * - parseNativeMusicControlMessage(raw): normalizes raw event payloads to objects
 * - handleNativeMusicControlMessage(raw): routes play/pause/next/prev/seek/destroy
 *
 * --- Dictionary / Terms / Extra details ---
 * - nativePlaybackActive (runtime.js global): true when WebView is backgrounded
 * - trackToPlayItem (engine-player.js global): converts queue track to player format
 * ☆=========================================☆
 */

function parseNativeMusicControlMessage(raw) {
	if (!raw) {
		return {message: ''};
	}
	if (typeof raw === 'string') {
		try {
			return JSON.parse(raw);
		} catch (error) {
			return {message: raw};
		}
	}
	return raw;
}

function handleNativeMusicControlMessage(raw) {
	const payload = parseNativeMusicControlMessage(raw);
	const message = String(payload.message || payload.action || payload.event || '').toLowerCase();

	if (message === 'music-controls-play') {
		if (nativePlaybackActive) {
			try {
				window.MusicControls.playNative(
					() => {},
					() => {},
				);
			} catch (error) {}
			setPlayIconState(true);
			updateStoredState({isPlaying: true});
			try {
				window.MusicControls.updateIsPlaying(
					true,
					() => {},
					() => {},
				);
			} catch (error) {}
		} else {
			audio
				.play()
				.then(() => {
					setPlayIconState(true);
					updateStoredState({isPlaying: true});
					try {
						window.MusicControls.updateIsPlaying(
							true,
							() => {},
							() => {},
						);
					} catch (error) {}
				})
				.catch(() => {});
		}
		return;
	}

	if (message === 'music-controls-pause') {
		if (nativePlaybackActive) {
			try {
				window.MusicControls.pauseNative(
					() => {},
					() => {},
				);
			} catch (error) {}
			setPlayIconState(false);
			updateStoredState({isPlaying: false});
			try {
				window.MusicControls.updateIsPlaying(
					false,
					() => {},
					() => {},
				);
			} catch (error) {}
		} else {
			try {
				audio.pause();
			} catch (error) {}
			setPlayIconState(false);
			updateStoredState({isPlaying: false});
			try {
				window.MusicControls.updateIsPlaying(
					false,
					() => {},
					() => {},
				);
			} catch (error) {}
		}
		return;
	}

	if (message === 'music-controls-media-button' || message === 'music-controls-headset-unplugged') {
		if (audio.paused) {
			handleNativeMusicControlMessage({message: 'music-controls-play'});
		} else {
			handleNativeMusicControlMessage({message: 'music-controls-pause'});
		}
		return;
	}

	if (message === 'music-controls-next') {
		const queueApi = window.starlPlaybackQueue;
		if (queueApi && queueApi.getQueueLength() > 1) {
			const next = queueApi.nextTrack();
			if (next && window.starlPlayer && typeof trackToPlayItem === 'function') {
				window.starlPlayer.playFromSearch(trackToPlayItem(next), {keepPlayerState: true});
			}
		}
		return;
	}

	if (message === 'music-controls-previous') {
		const queueApi = window.starlPlaybackQueue;
		if (queueApi && queueApi.getQueueLength() > 1) {
			const prev = queueApi.previousTrack();
			if (prev && window.starlPlayer && typeof trackToPlayItem === 'function') {
				window.starlPlayer.playFromSearch(trackToPlayItem(prev), {keepPlayerState: true});
			}
		}
		return;
	}

	if (message === 'music-controls-seek-to') {
		const position = Number(payload.position);
		if (Number.isFinite(position)) {
			try {
				audio.currentTime = position;
				updateStoredState({position});
			} catch (error) {}
		}
		return;
	}

	if (message === 'music-controls-destroy' || message === 'music-controls-close') {
		try {
			window.MusicControls.destroy(
				() => {},
				() => {},
			);
		} catch (error) {}
		return;
	}
}

/**
 * ☆=========================================☆
 * Runtime notifications handler - MusicControls message routing
 * Parses and routes incoming messages from the Android lock-screen/notification
 * player (cordova-plugin-starl-music-controls) to the correct playback action
 * Loaded before runtime-notifications.js which subscribes to these handlers
 *
 * --- What this file does? ---
 * - parseNativeMusicControlMessage(raw): normalizes raw event payloads to objects
 * - handleNativeMusicControlMessage(raw): routes play/pause/next/prev/seek/destroy
 *
 * --- Dictionary / Terms / Extra details ---
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

// while offline, smart-queue jumps straight to the next/prev CACHED track instead of
// the plain adjacent one (mirrors queue-player.js's smartQueueHandledSkip). without this
// the lock-screen/notification skip buttons would land on an uncached, unplayable track.
async function smartQueueHandledNativeSkip(direction) {
	const sq = window.starlSmartQueue;
	if (!sq || typeof sq.skip !== 'function') return false;
	try {
		return await sq.skip(direction);
	} catch (error) {
		return false;
	}
}

function handleNativeMusicControlMessage(raw) {
	const payload = parseNativeMusicControlMessage(raw);
	const message = String(payload.message || payload.action || payload.event || '').toLowerCase();

	if (message === 'music-controls-play') {
		audio
			.play()
			.then(() => {
				window.starlPlaybackState.shouldBePlaying = true;
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
		return;
	}

	if (message === 'music-controls-pause') {
		try {
			audio.pause();
		} catch (error) {}
		window.starlPlaybackState.shouldBePlaying = false;
		setPlayIconState(false);
		updateStoredState({isPlaying: false});
		try {
			window.MusicControls.updateIsPlaying(
				false,
				() => {},
				() => {},
			);
		} catch (error) {}
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
			if (window.starlPlaybackState) window.starlPlaybackState.lastNavDirection = 1;
			smartQueueHandledNativeSkip(1).then((handled) => {
				if (handled) return;
				const next = queueApi.nextTrack();
				if (next && window.starlPlayer && typeof trackToPlayItem === 'function') {
					window.starlPlayer.playFromSearch(trackToPlayItem(next), {keepPlayerState: true});
				}
			});
		}
		return;
	}

	if (message === 'music-controls-previous') {
		const queueApi = window.starlPlaybackQueue;
		if (queueApi && queueApi.getQueueLength() > 1) {
			if (window.starlPlaybackState) window.starlPlaybackState.lastNavDirection = -1;
			smartQueueHandledNativeSkip(-1).then((handled) => {
				if (handled) return;
				const prev = queueApi.previousTrack();
				if (prev && window.starlPlayer && typeof trackToPlayItem === 'function') {
					window.starlPlayer.playFromSearch(trackToPlayItem(prev), {keepPlayerState: true});
				}
			});
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

	if (message === 'music-controls-open-player') {
		if (typeof setPlayerOpen === 'function') {
			setPlayerOpen(true);
		}
		return;
	}
}

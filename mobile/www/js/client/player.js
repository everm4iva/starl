/**
 * ☆=========================================☆
 * Player - player card open/close and drag gestures
 * Controls the main player card (full-screen) and the mini player strip.
 * Decides when the player is open, minimized, or hidden entirely.
 *
 * --- What this file does? ---
 * - setPlayerOpen(): shows or hides the main player card and mini player
 * - attachDragHandler(): swipe-down on the cover/track-info minimizes the player
 * - Mini player tap opens the player; swipe left/right skips tracks; swipe down clears
 * - Boots auth, fires 'starl-auth-ready', then restores last player state
 *
 * --- Dictionary / Terms / Extra details ---
 * - All real playback logic lives in the playback/ modules
 * - "clean" CSS class on .main-player = freshly initialized, no track loaded yet
 * ☆=========================================☆
 */

/* ☆======= Element refs =======☆ */

const openPlayerButton = document.getElementById('open-player');
const closePlayerButton = document.getElementById('close-player');
const mainPlayer = document.querySelector('.main-player');
const miniPlayer = document.querySelector('.mini-player');
const bottomBg = document.querySelector('.bottom-bg');
const bottomTimeElapsed = document.querySelector('.bottom-timeelapsed');
const bottomTimeTotal = document.querySelector('.bottom-timetotal');
const bottomNav = document.querySelector('.bottom');
const tabContainer = document.querySelector('.tab-container');

function setPlayerOpen(isOpen) {
	if (!mainPlayer || !miniPlayer || !bottomBg || !bottomTimeElapsed || !bottomTimeTotal || !tabContainer) {
		return;
	}

	const hasTrack = Boolean(window.starlPlaybackState.currentStreamUrl || window.starlPlaybackState.currentTrackKey);
	if (!hasTrack && !isOpen) {
		mainPlayer.classList.add('hidden');
		miniPlayer.classList.add('hidden');
		bottomBg.classList.add('hidden');
		bottomTimeElapsed.classList.add('hidden');
		bottomTimeTotal.classList.add('hidden');
		if (bottomNav) {
			bottomNav.classList.remove('hidden');
			bottomNav.classList.add('no-mini');
			bottomNav.classList.remove('player-overlay');
		}
		tabContainer.classList.remove('hidden');
		return;
	}

	mainPlayer.classList.toggle('hidden', !isOpen);
	miniPlayer.classList.remove('hidden');
	bottomBg.classList.remove('hidden');
	bottomTimeElapsed.classList.remove('hidden');
	bottomTimeTotal.classList.remove('hidden');
	tabContainer.classList.toggle('hidden', isOpen);

	// remove the no-mini class when a track exists / mini-player may be visible
	if (bottomNav) {
		bottomNav.classList.toggle('no-mini', !hasTrack);
		bottomNav.classList.toggle('player-overlay', Boolean(isOpen));
	}
}

(async () => {
	const auth = window.starlAuth;
	if (auth && typeof auth.ensureAuth === 'function') {
		const token = await auth.ensureAuth();
		if (!token) return; // redirected to login
	}
	window.dispatchEvent(new CustomEvent('starl-auth-ready'));
	restorePlayerState();
	fetchUserProvider().then(() => {});
})();

if (openPlayerButton) {
	openPlayerButton.addEventListener('click', () => setPlayerOpen(true));
}

if (closePlayerButton) {
	closePlayerButton.addEventListener('click', () => setPlayerOpen(false));
}

if (miniPlayer) {
	miniPlayer.addEventListener('click', (event) => {
		if (event.target && event.target.closest('.mini-player-controls, .mini-player-btn')) {
			return;
		}
		setPlayerOpen(true);
	});
}

/* ☆======= Swipe-down drag to minimize =======☆ */

// reusable swipe-down drag handler for minimizing the player
function attachDragHandler(targetEl, player) {
	if (!targetEl || !player) return;
	let startY = 0;
	let currentY = 0;
	let dragging = false;
	let raf = null;

	const thresholdPx = 120; // minimum px to trigger minimize
	const thresholdRatio = 0.15; // or fraction of viewport height

	function setTransform(dy) {
		const capped = Math.max(0, dy);
		const pct = Math.min(1, capped / (window.innerHeight || 800));
		player.style.transform = `translateY(${capped}px)`;
		player.style.opacity = String(Math.max(0, 1 - pct * 0.7));

		const coverEl = player.querySelector('.mp-cover');
		if (coverEl) {
			coverEl.style.transform = `translateY(${Math.round(capped / 3)}px) scale(${1 - pct * 0.03})`;
			coverEl.style.transition = 'none';
		}
		const trackInfoEl = player.querySelector('.mp-track-info');
		if (trackInfoEl) {
			trackInfoEl.style.transform = `translateY(${Math.round(capped / 6)}px)`;
			trackInfoEl.style.transition = 'none';
		}
	}

	function handleStart(e) {
		const t = e.touches ? e.touches[0] : e;
		// if user started the touch/click on an interactive control, don't begin a drag
		try {
			const interactive =
				e.target &&
				e.target.closest &&
				e.target.closest(
					'.img-button, .mp-btn, .mini-player-btn, .mp-add-btn, .mp-track-actions, .mp-add-btn-text, .mp-track-actions .img-button, .mp-additional, .mp-scrollupindicator',
				);
			if (interactive) return;
		} catch (err) {}
		startY = t.clientY;
		currentY = startY;
		dragging = true;
		// disable transitions while dragging
		player.style.transition = 'none';
	}

	function handleMove(e) {
		if (!dragging) return;
		const t = e.touches ? e.touches[0] : e;
		currentY = t.clientY;
		if (!raf) {
			raf = requestAnimationFrame(() => {
				raf = null;
				const dy = Math.max(0, currentY - startY);
				setTransform(dy);
			});
		}
		e.preventDefault();
	}

	function handleEnd() {
		if (!dragging) return;
		dragging = false;
		if (raf) {
			cancelAnimationFrame(raf);
			raf = null;
		}
		const dy = Math.max(0, currentY - startY);
		const shouldClose = dy > thresholdPx || dy > window.innerHeight * thresholdRatio;
		// restore transitions for smooth snap
		player.style.transition = 'transform 260ms cubic-bezier(.22,.9,.31,1), opacity 260ms ease';

		const coverEl = player.querySelector('.mp-cover');
		const trackInfoEl = player.querySelector('.mp-track-info');

		if (coverEl) coverEl.style.transition = 'transform 260ms cubic-bezier(.22,.9,.31,1)';
		if (trackInfoEl) trackInfoEl.style.transition = 'transform 260ms cubic-bezier(.22,.9,.31,1)';

		if (shouldClose) {
			// animate out then close
			player.style.transform = `translateY(100%)`;
			player.style.opacity = '0';
			if (coverEl) coverEl.style.transform = 'translateY(100%) scale(0.96)';
			if (trackInfoEl) trackInfoEl.style.transform = 'translateY(100%)';
			setTimeout(() => {
				setPlayerOpen(false);
				// reset inline styles after closing
				player.style.transform = '';
				player.style.opacity = '';
				player.style.transition = '';
				if (coverEl) {
					coverEl.style.transform = '';
					coverEl.style.transition = '';
				}
				if (trackInfoEl) {
					trackInfoEl.style.transform = '';
					trackInfoEl.style.transition = '';
				}
			}, 280);
		} else {
			// revert
			player.style.transform = '';
			player.style.opacity = '';
			if (coverEl) coverEl.style.transform = '';
			if (trackInfoEl) trackInfoEl.style.transform = '';
			// clear transition after a tick to keep future JS changes smooth
			setTimeout(() => {
				player.style.transition = '';
				if (coverEl) coverEl.style.transition = '';
				if (trackInfoEl) trackInfoEl.style.transition = '';
			}, 300);
		}
	}

	targetEl.addEventListener('touchstart', handleStart, {passive: true});
	targetEl.addEventListener('touchmove', handleMove, {passive: false});
	targetEl.addEventListener('touchend', handleEnd, {passive: true});
	targetEl.addEventListener('touchcancel', handleEnd, {passive: true});

	// also support mouse drag for desktop testing
	let mouseDown = false;
	targetEl.addEventListener('mousedown', (e) => {
		mouseDown = true;
		handleStart(e);
	});
	window.addEventListener('mousemove', (e) => {
		if (!mouseDown) return;
		handleMove(e);
	});
	window.addEventListener('mouseup', () => {
		if (!mouseDown) return;
		mouseDown = false;
		handleEnd();
	});
}

const mpCover = document.querySelector('.mp-cover');
const mpTrackInfo = document.querySelector('.mp-track-info');
const mpBgEl = document.querySelector('.mp-bg');
if (mpCover && mainPlayer) attachDragHandler(mpCover, mainPlayer);
if (mpTrackInfo && mainPlayer) attachDragHandler(mpTrackInfo, mainPlayer);
if (mpBgEl && mainPlayer) attachDragHandler(mpBgEl, mainPlayer);

/* ☆======= Mini player gestures =======☆ */

// swipe left/right to skip, swipe up to open player, swipe down to clear
if (miniPlayer) {
	(function attachMiniGestures(root) {
		let startX = 0;
		let startY = 0;
		let startTime = 0;
		const threshold = 50; // px

		root.addEventListener(
			'touchstart',
			(ev) => {
				const t = ev.touches && ev.touches[0];
				if (!t) return;
				startX = t.clientX;
				startY = t.clientY;
				startTime = Date.now();
			},
			{passive: true},
		);

		root.addEventListener(
			'touchend',
			(ev) => {
				const t = (ev.changedTouches && ev.changedTouches[0]) || {};
				const dx = (t.clientX || 0) - startX;
				const dy = (t.clientY || 0) - startY;
				const dt = Date.now() - startTime;
				// require a minimum swipe distance and reasonable speed
				if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
					// horizontal swipe
					if (dx < 0) {
						// swipe left -> previous
						try {
							const prev = root.querySelector('.mini-player-btn.icon.skip-previous');
							if (prev) prev.click();
							else if (window.starlPlayer && typeof window.starlPlayer.playPrevious === 'function')
								window.starlPlayer.playPrevious();
						} catch (e) {}
					} else {
						// swipe right -> next
						try {
							const next = root.querySelector('.mini-player-btn.icon.skip-next');
							if (next) next.click();
							else if (window.starlPlayer && typeof window.starlPlayer.playNext === 'function')
								window.starlPlayer.playNext();
						} catch (e) {}
					}
				} else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > threshold) {
					// vertical swipe
					if (dy < 0) {
						// swipe up -> open player
						setPlayerOpen(true);
					} else {
						// swipe down -> stop & clear current track
						try {
							clearCurrentTrack();
						} catch (e) {}
					}
				}
			},
			{passive: true},
		);
	})(miniPlayer);
}

if (repeatButton) {
	repeatButton.addEventListener('click', () => {
		// cycles off/song/queue per the user's loopMode (see runtime.js cycleLoopButton)
		cycleLoopButton();
	});
}

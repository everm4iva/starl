/**
 * ☆=========================================☆
 * Gestures - swipe detection helpers
 * Shared touch gesture detection used by playlist headers and other UI elements.
 * Detects left/right swipes and calls the appropriate callback.
 *
 * --- What this file does? ---
 * - setupPlaylistHeaderSwipe(): wires a right-swipe on a header to go back
 * - setupSwipeElement(): wires both left and right swipe handlers on any element
 * - setupSwipeToRemove(): drag-following swipe-left-to-reveal-delete on a row
 * - isValidSwipe(): checks distance and speed to confirm it's a real swipe
 *
 * --- Dictionary / Terms / Extra details ---
 * - A swipe is valid if it's >50px and completes within 500ms
 * - Vertical movement >30px cancels the swipe (user is scrolling)
 * ☆=========================================☆
 */

(function () {
	const SWIPE_THRESHOLD_PX = 50;
	const SWIPE_TIME_THRESHOLD_MS = 500;

	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;
	let activeSwipeElement = null;

	/* ☆======= Swipe detection =======☆ */

	function getSwipeDistance(startX, endX) {
		return Math.abs(endX - startX);
	}

	function getSwipeDuration(startTime, endTime) {
		return Math.abs(endTime - startTime);
	}

	function isValidSwipe(startX, endX, startTime, endTime) {
		const distance = getSwipeDistance(startX, endX);
		const duration = getSwipeDuration(startTime, endTime);

		return distance > SWIPE_THRESHOLD_PX && duration < SWIPE_TIME_THRESHOLD_MS;
	}

	function getSwipeDirection(startX, endX) {
		if (endX < startX) {
			return 'left';
		}
		if (endX > startX) {
			return 'right';
		}
		return 'none';
	}

	/* ☆======= Touch event handlers =======☆ */

	function handleTouchStart(e, element) {
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
		touchStartTime = Date.now();
		activeSwipeElement = element;
	}

	function handleTouchEnd(e, element, onSwipeCallback) {
		if (!activeSwipeElement) {
			return;
		}

		const touchEndX = e.changedTouches[0].clientX;
		const touchEndY = e.changedTouches[0].clientY;
		const touchEndTime = Date.now();

		const verticalDiff = Math.abs(touchEndY - touchStartY);
		if (verticalDiff > 30) {
			activeSwipeElement = null;
			return;
		}

		if (isValidSwipe(touchStartX, touchEndX, touchStartTime, touchEndTime)) {
			const direction = getSwipeDirection(touchStartX, touchEndX);
			if (typeof onSwipeCallback === 'function') {
				onSwipeCallback(direction);
			}
		}

		activeSwipeElement = null;
	}

	/* ☆======= Setup helpers =======☆ */

	function setupPlaylistHeaderSwipe(headerElement, backCallback) {
		if (!headerElement) {
			return;
		}

		// use capture phase so it intercept the touch before any child element
		// can absorb/steal or stop it (ex: artist-cover, artist-name, playlist-cover)
		headerElement.addEventListener(
			'touchstart',
			(e) => {
				handleTouchStart(e, headerElement);
			},
			{passive: true, capture: true},
		);

		headerElement.addEventListener(
			'touchend',
			(e) => {
				handleTouchEnd(e, headerElement, (direction) => {
					if (direction === 'right' && typeof backCallback === 'function') {
						backCallback();
					}
				});
			},
			{capture: true},
		);
	}

	function setupSwipeElement(element, handlers) {
		if (!element) {
			return;
		}

		element.addEventListener('touchstart', (e) => {
			handleTouchStart(e, element);
		});

		element.addEventListener('touchend', (e) => {
			handleTouchEnd(e, element, (direction) => {
				if (direction === 'left' && handlers.onSwipeLeft && typeof handlers.onSwipeLeft === 'function') {
					handlers.onSwipeLeft();
				}
				if (direction === 'right' && handlers.onSwipeRight && typeof handlers.onSwipeRight === 'function') {
					handlers.onSwipeRight();
				}
			});
		});
	}

	/* ☆======= Swipe-to-remove (drag-following reveal) =======☆ */

	const REMOVE_REVEAL_PX = 80;
	const REMOVE_COMMIT_RATIO = 1.1;

	function setupSwipeToRemove(rowElement, contentElement, onRemove) {
		if (!rowElement || !contentElement) {
			return;
		}

		let startX = 0;
		let startY = 0;
		let currentX = 0;
		let dragging = false;
		let canceled = false;

		rowElement.addEventListener(
			'touchstart',
			(e) => {
				startX = e.touches[0].clientX;
				startY = e.touches[0].clientY;
				currentX = 0;
				dragging = true;
				canceled = false;
				contentElement.style.transition = 'none';
			},
			{passive: true},
		);

		rowElement.addEventListener(
			'touchmove',
			(e) => {
				if (!dragging) {
					return;
				}
				const dx = e.touches[0].clientX - startX;
				const dy = e.touches[0].clientY - startY;
				if (!canceled && Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(dx)) {
					canceled = true;
				}
				if (canceled) {
					return;
				}
				currentX = Math.min(0, dx);
				const clamped = Math.max(currentX, -REMOVE_REVEAL_PX * 1.4);
				contentElement.style.transform = 'translateX(' + clamped + 'px)';
				rowElement.classList.toggle('swipe-active', clamped < 0);
				rowElement.classList.toggle('swipe-armed', Math.abs(clamped) > REMOVE_REVEAL_PX * REMOVE_COMMIT_RATIO);
			},
			{passive: true},
		);

		rowElement.addEventListener('touchend', () => {
			dragging = false;
			contentElement.style.transition = '';
			const commit = !canceled && Math.abs(currentX) > REMOVE_REVEAL_PX * REMOVE_COMMIT_RATIO;
			rowElement.classList.remove('swipe-armed');
			if (!commit) {
				rowElement.classList.remove('swipe-active');
			}
			if (commit) {
				rowElement.classList.add('swipe-removing');
				contentElement.style.transform = 'translateX(-100%)';
				rowElement.addEventListener(
					'transitionend',
					() => {
						if (typeof onRemove === 'function') {
							onRemove();
						}
					},
					{once: true},
				);
			} else {
				contentElement.style.transform = '';
			}
			currentX = 0;
		});
	}

	/* ☆======= Public API =======☆ */

	window.starlGestures = {
		setupPlaylistHeaderSwipe,
		setupSwipeElement,
		setupSwipeToRemove,
		getSwipeDirection,
		isValidSwipe,
	};
})();

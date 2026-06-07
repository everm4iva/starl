/**
 * ☆=========================================☆
 * Gestures - swipe detection helpers
 * Shared touch gesture detection used by playlist headers and other UI elements.
 * Detects left/right swipes and calls the appropriate callback.
 *
 * --- What this file does? ---
 * - setupPlaylistHeaderSwipe(): wires a right-swipe on a header to go back
 * - setupSwipeElement(): wires both left and right swipe handlers on any element
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

		headerElement.addEventListener('touchstart', (e) => {
			handleTouchStart(e, headerElement);
		});

		headerElement.addEventListener('touchend', (e) => {
			handleTouchEnd(e, headerElement, (direction) => {
				if (direction === 'right' && typeof backCallback === 'function') {
					backCallback();
				}
			});
		});
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

	/* ☆======= Public API =======☆ */

	window.starlGestures = {setupPlaylistHeaderSwipe, setupSwipeElement, getSwipeDirection, isValidSwipe};
})();

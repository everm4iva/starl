/**
 * ☆=========================================☆
 * Back button - Android system back action handling
 * Makes the system back button close the topmost open UI layer instead of
 * exiting the app (which is Cordova's default with no listener).
 *
 * --- What this file does? ---
 * - Keeps a priority-ordered list of dismissible "layers" (context menu,
 *   bottom sheet, modals, overlays, maximized player, non-home tab)
 * - On a back press, closes the first open layer it finds, top to bottom
 * - When nothing is open, falls back to "press back again to exit"
 * - Debounces repeated backbutton events so one press = one action
 *
 * --- Dictionary / Terms / Extra details ---
 * - Self-contained: it only reads the DOM and existing global APIs
 *   (window.starlBottomSheet, window.starlArtistPage, ...), never the reverse
 * - "layer" = one dismissible piece of UI; order = visual stacking
 * ☆=========================================☆
 */
(function () {
	'use strict';

	/* ☆======= Visibility guard =======☆ */

	// true only if the element is really on screen. the maximized player keeps
	// the .main-player node in the DOM and animates it up from the bottom,
	// so we need to check more than just presence of the node or a .hidden class.
	function isActuallyVisible(el) {
		if (!el || el.classList.contains('hidden')) return false;
		var cs = window.getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden') return false;
		if (parseFloat(cs.opacity) === 0) return false;
		var rect = el.getBoundingClientRect();
		// off-screen (slid down) or collapsed.
		if (rect.height === 0 || rect.top >= window.innerHeight) return false;
		return true;
	}

	/* ☆======= Dismissible layers (top to bottom) =======☆ */

	// each handler returns true if it consumed the back press (something was
	// open and got dismissed). first to return true wins.
	var layers = [
		// 1. track/album context menu (created "ad-hoc" with class .context-menu),
		// plus the little Recommend popup + the Configure page's per-item menu.
		function contextMenu() {
			var menu = document.querySelector('.context-menu, .rec-menu, .cfg-item-menu');
			if (!menu) return false;
			menu.remove();
			return true;
		},

		// 2. bottom sheet (album/artist/track actions).
		function bottomSheet() {
			var sheet = document.querySelector('.bottom-sheet.is-open');
			if (!sheet) return false;
			if (window.starlBottomSheet && typeof window.starlBottomSheet.close === 'function') {
				window.starlBottomSheet.close();
				return true;
			}
			return false;
		},

		// 3. playlist settings modal.
		function playlistSettings() {
			var modal = document.querySelector('.playlist-settings-modal');
			if (!modal || modal.classList.contains('hidden')) return false;
			if (window.starlPlaylistSettings && typeof window.starlPlaylistSettings.closeSettingsModal === 'function') {
				window.starlPlaylistSettings.closeSettingsModal();
				return true;
			}
			return false;
		},

		// 4. inside-playlist overlay.
		function insidePlaylist() {
			var overlay = document.querySelector('.inside-playlist');
			if (!overlay || overlay.classList.contains('hidden')) return false;
			if (window.starlInsidePlaylist && typeof window.starlInsidePlaylist.close === 'function') {
				window.starlInsidePlaylist.close();
				return true;
			}
			return false;
		},

		// 5. artist/album page overlay.
		// it keeps its own navigation stack
		// (artists list -> artist -> album), so defer to its goBack via the
		// exposed close: client calls the dedicated back if present, else close.
		function artistPage() {
			var overlay = document.querySelector('.artist-page');
			if (!overlay || overlay.classList.contains('hidden')) return false;
			var api = window.starlArtistPage;
			if (api && typeof api.goBack === 'function') {
				api.goBack();
				return true;
			}
			if (api && typeof api.close === 'function') {
				api.close();
				return true;
			}
			return false;
		},

		// 6. manage-storage page. it has an internal sub-view (Total size), so defer
		// to goBack which pops that first, then closes the page.
		function storagePage() {
			var overlay = document.querySelector('.storage-page');
			if (!overlay || overlay.classList.contains('hidden')) return false;
			var api = window.starlStoragePage;
			if (api && typeof api.goBack === 'function') {
				api.goBack();
				return true;
			}
			return false;
		},

		// 7. Configure content full-page overlay (General / Removed / Recommending).
		function configureContentPage() {
			if (window.starlConfigureContent && typeof window.starlConfigureContent.closeTop === 'function') {
				return window.starlConfigureContent.closeTop();
			}
			return false;
		},

		// 8. Customize MIX / Customize Home full-page overlays.
		function recommendationPage() {
			if (window.starlRecommendationPage && typeof window.starlRecommendationPage.closeTop === 'function') {
				return window.starlRecommendationPage.closeTop();
			}
			return false;
		},

		// 8. maximized player -> minimize back to the mini player.
		function maximizedPlayer() {
			var player = document.querySelector('.main-player');
			if (!isActuallyVisible(player)) return false;
			// reuse the existing close-player button so client hits the exact same state transition the UI already uses.
			var closeBtn = document.getElementById('close-player');
			if (closeBtn) {
				closeBtn.click();
				return true;
			}
			return false;
		},

		// 9. not on the Home tab -> go to Home instead of exiting.
		function nonHomeTab() {
			var activePanel = document.querySelector('.tab[data-tab]:not(.is-hidden)');
			if (!activePanel || activePanel.dataset.tab === 'home') return false;
			var homeBtn = document.querySelector('.tabs-btn[data-tab="home"]');
			if (homeBtn) {
				homeBtn.click();
				return true;
			}
			return false;
		},
	];

	/* ☆======= Exit fallback (double-press) =======☆ */

	// double-press-to-exit so a stray back press doesn't drop the user out.
	var EXIT_WINDOW_MS = 2000;
	var lastBackPress = 0;

	function exitApp() {
		var now = Date.now();
		if (now - lastBackPress < EXIT_WINDOW_MS) {
			if (navigator.app && typeof navigator.app.exitApp === 'function') {
				navigator.app.exitApp();
			}
			return;
		}
		lastBackPress = now;
		showExitToast();
	}

	function showExitToast() {
		// prefer the app's own toast if available; fall back to a tiny tiny inline one.
		if (window.starlLayout && typeof window.starlLayout.showToast === 'function') {
			window.starlLayout.showToast('Press back again to exit');
			return;
		}
		var existing = document.getElementById('back-exit-toast');
		if (existing) return;
		var t = document.createElement('div');
		t.id = 'back-exit-toast';
		t.textContent = 'Press back again to exit';
		t.style.cssText =
			'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);' +
			'background:rgba(0,0,0,0.85);color:#fff;padding:10px 18px;border-radius:20px;' +
			'font-size:14px;z-index:99999;pointer-events:none;opacity:0;transition:opacity .15s;';
		document.body.appendChild(t);
		requestAnimationFrame(function () {
			t.style.opacity = '1';
		});
		setTimeout(function () {
			t.style.opacity = '0';
			setTimeout(function () {
				t.remove();
			}, 200);
		}, EXIT_WINDOW_MS - 200);
	}

	/* ☆======= Back press handler + wiring =======☆ */

	// a single physical back press can fire 'backbutton' more than once (key
	// down/up, or Cordova re-dispatch).
	// without this, one press could close a layer AND then switch tabs.
	var DEBOUNCE_MS = 350;
	var lastHandled = 0;

	function onBackButton(e) {
		if (e && typeof e.preventDefault === 'function') e.preventDefault();
		var now = Date.now();
		if (now - lastHandled < DEBOUNCE_MS) return;
		lastHandled = now;
		for (var i = 0; i < layers.length; i++) {
			try {
				if (layers[i]()) return;
			} catch (err) {
				// a broken layer check must not block the rest of the chain.- poetic lol
			}
		}
		exitApp();
	}

	document.addEventListener(
		'deviceready',
		function () {
			document.addEventListener('backbutton', onBackButton, false);
		},
		false,
	);
})();

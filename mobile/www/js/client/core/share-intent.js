/**
 * ☆=========================================☆
 * Share intent - handle music links shared to starl from other apps
 * When a YouTube / YouTube Music / Spotify link is shared to starl (via the
 * Android "Share with starl" sheet), we DON'T play it blindly anymore - we pop
 * an import chooser so the user decides what to do with it:
 *
 *   - single track  -> Play now (new queue) / Add to queue / Play next
 *   - a playlist     -> Import as playlist / Play now / Add to queue
 *
 * The shared URL arrives via three native paths (priority order):
 *   1. window._StarlBridge.getShareUrl() - @JavascriptInterface injected by
 *      hooks/after_prepare/add_share_intent.js into MainActivity
 *   2. window.starlHandleShareUrl(url) - called by MainActivity.onNewIntent
 *      when the app is already running
 *   3. StarlIntent cordova.exec (original plugin, kept as a fallback)
 *
 * --- Dictionary / Terms / Extra details ---
 * - "new queue" = replace the playback queue with this and play (playWithQueue)
 * - playlist tracks resolve through starlImportPlaylist / starlSpotifyImport
 * - single Spotify tracks aren't supported (no per-track scrape endpoint) - we
 *   nudge the user to share a Spotify *playlist* instead
 * ☆=========================================☆
 */
(function () {
	/* ☆======= Helpers =======☆ */

	function log() {
		var args = Array.prototype.slice.call(arguments);
		args.unshift('[share-intent]');
		console.log.apply(console, args);
	}

	function toast(msg) {
		log('toast:', msg);
		if (window.starlLayout && typeof window.starlLayout.showToast === 'function') {
			window.starlLayout.showToast(msg);
		}
	}

	function isYouTube(url) {
		return /youtube\.com|youtu\.be/i.test(url);
	}

	function isSpotify(url) {
		return /open\.spotify\.com|spotify:/i.test(url);
	}

	// figure out what kind of link this is so we can offer the right actions.
	function classify(url) {
		if (isSpotify(url)) {
			if (/playlist[:/]/i.test(url)) return 'spotify-playlist';
			if (/(track[:/]|album[:/])/i.test(url)) return 'spotify-track';
			return 'spotify-playlist'; // bare open.spotify links -> assume playlist
		}
		if (isYouTube(url)) {
			// a YouTube playlist link carries list=...; a watch/youtu.be link is a single track
			return /[?&]list=/i.test(url) ? 'yt-playlist' : 'yt-track';
		}
		return 'unknown';
	}

	// a minimal queue track for a single shared link; metadata fills in on play.
	function minimalTrack(url, meta) {
		meta = meta || {};
		return {
			title: meta.title || 'Shared track',
			artist: meta.artist || '',
			album: '',
			imageUrl: meta.imageUrl || '',
			thumbnail: meta.imageUrl || '',
			sourceUrl: url,
			streamUrl: '',
			url: url,
			trackKey: url,
			duration: 0,
		};
	}

	// best-effort title/artist/thumb for a YouTube link via the public, no-auth
	// oEmbed endpoint - so a queued share shows a real name, not "Shared track".
	function resolveYtMeta(url) {
		return fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url))
			.then(function (r) {
				return r.ok ? r.json() : null;
			})
			.then(function (d) {
				if (!d) return null;
				return {title: d.title || '', artist: d.author_name || '', imageUrl: d.thumbnail_url || ''};
			})
			.catch(function () {
				return null;
			});
	}

	/* ☆======= Action wiring =======☆ */

	var queueApi = function () {
		return window.starlPlaybackQueue;
	};
	var player = function () {
		return window.starlPlayer;
	};

	function playNowTrack(url) {
		var p = player();
		if (p && typeof p.playFromSearch === 'function') {
			p.playFromSearch({url: url, sourceUrl: url, trackKey: url});
		}
	}

	function addTrackToQueue(url, next) {
		var q = queueApi();
		if (!q) {
			toast('starl: queue unavailable');
			return;
		}
		var add = function (meta) {
			var track = minimalTrack(url, meta);
			if (next && typeof q.insertAfterCurrent === 'function') {
				q.insertAfterCurrent(track);
				toast('starl: playing next');
			} else if (typeof q.addToEnd === 'function') {
				q.addToEnd(track);
				toast('starl: added to queue');
			}
		};
		// grab a real name in the background, but don't block the user on it
		if (isYouTube(url)) {
			resolveYtMeta(url).then(function (meta) {
				add(meta);
			});
		} else {
			add(null);
		}
	}

	function playNowPlaylist(ref) {
		var ip = window.starlImportPlaylist;
		if (!ip || typeof ip.resolve !== 'function') {
			toast('starl: import unavailable');
			return;
		}
		toast('starl: loading playlist…');
		ip.resolve(ref)
			.then(function (data) {
				var tracks = (data && data.tracks) || [];
				if (!tracks.length) {
					toast('starl: playlist is empty');
					return;
				}
				var p = player();
				if (p && typeof p.playWithQueue === 'function') {
					p.playWithQueue(tracks, 0, {type: 'shared-playlist', title: data.title});
				}
			})
			.catch(function (err) {
				toast('starl: ' + ((err && err.message) || 'could not load playlist'));
			});
	}

	function addPlaylistToQueue(ref) {
		var ip = window.starlImportPlaylist;
		if (!ip || typeof ip.resolve !== 'function') {
			toast('starl: import unavailable');
			return;
		}
		toast('starl: loading playlist…');
		ip.resolve(ref)
			.then(function (data) {
				var tracks = (data && data.tracks) || [];
				if (!tracks.length) {
					toast('starl: playlist is empty');
					return;
				}
				var q = queueApi();
				if (q && typeof q.addToEnd === 'function') {
					tracks.forEach(function (t) {
						q.addToEnd(t);
					});
					toast('starl: added ' + tracks.length + ' tracks to queue');
				}
			})
			.catch(function (err) {
				toast('starl: ' + ((err && err.message) || 'could not load playlist'));
			});
	}

	function importYtPlaylist(ref) {
		var ip = window.starlImportPlaylist;
		if (ip && typeof ip.openPreviewFromItem === 'function') {
			ip.openPreviewFromItem({url: ref});
		} else {
			toast('starl: import unavailable');
		}
	}

	function importSpotifyPlaylist(ref) {
		var si = window.starlSpotifyImport;
		if (si && typeof si.importFromLink === 'function') {
			toast('starl: reading Spotify playlist…');
			si.importFromLink(ref).catch(function (err) {
				toast('starl: ' + ((err && err.message) || 'Spotify import failed'));
			});
		} else {
			toast('starl: Spotify import unavailable');
		}
	}

	/* ☆======= Chooser sheet =======☆ */

	function actionRow(label, iconClass, handler) {
		var row = document.createElement('div');
		row.className = 'bsc-action ipl-action';
		var icon = document.createElement('div');
		icon.className = 'bsc-action-icon ' + iconClass;
		var text = document.createElement('span');
		text.textContent = label;
		row.appendChild(icon);
		row.appendChild(text);
		row.addEventListener('click', handler);
		return row;
	}

	function openChooser(url, kind) {
		var bs = window.starlBottomSheet;
		if (!bs || typeof bs.open !== 'function') {
			// no sheet available (shouldn't happen) - fall back to the old behaviour
			playNowTrack(url);
			return;
		}

		bs.open({
			render: function (body) {
				var heading = document.createElement('div');
				heading.className = 'bsc-settings-header';
				heading.textContent = 'Shared to starl';
				body.appendChild(heading);

				var hint = document.createElement('div');
				hint.className = 'ipl-hint';
				hint.textContent = isSpotify(url) ? 'Spotify link' : 'YouTube link';
				hint.textContent += ' · ' + (kind.indexOf('playlist') !== -1 ? 'playlist' : 'track');
				body.appendChild(hint);

				if (kind === 'yt-track') {
					body.appendChild(
						actionRow('Play now', 'ipl-icon-play', function () {
							bs.close();
							playNowTrack(url);
						}),
					);
					body.appendChild(
						actionRow('Add to queue', 'ipl-icon-queue', function () {
							bs.close();
							addTrackToQueue(url, false);
						}),
					);
					body.appendChild(
						actionRow('Play next', 'ipl-icon-next', function () {
							bs.close();
							addTrackToQueue(url, true);
						}),
					);
				} else if (kind === 'yt-playlist') {
					body.appendChild(
						actionRow('Import as playlist', 'ipl-icon-import', function () {
							bs.close();
							importYtPlaylist(url);
						}),
					);
					body.appendChild(
						actionRow('Play now', 'ipl-icon-play', function () {
							bs.close();
							playNowPlaylist(url);
						}),
					);
					body.appendChild(
						actionRow('Add to queue', 'ipl-icon-queue', function () {
							bs.close();
							addPlaylistToQueue(url);
						}),
					);
				} else if (kind === 'spotify-playlist') {
					body.appendChild(
						actionRow('Import as playlist', 'ipl-icon-import', function () {
							bs.close();
							importSpotifyPlaylist(url);
						}),
					);
					var note = document.createElement('div');
					note.className = 'ipl-hint';
					note.textContent = 'Spotify tracks are matched to YouTube so starl can play them.';
					body.appendChild(note);
				}
			},
		});
	}

	/* ☆======= Entry point =======☆ */

	var _handled = false; // guard against multiple native paths firing for one share

	function handleSharedUrl(url) {
		if (!url || typeof url !== 'string') {
			log('handleSharedUrl: empty url, ignoring');
			return;
		}
		url = url.trim();
		log('handleSharedUrl received:', url);

		var kind = classify(url);
		if (kind === 'unknown') {
			log('not a supported music URL, ignoring');
			toast('starl: not a YouTube or Spotify link');
			return;
		}
		if (kind === 'spotify-track') {
			log('single Spotify track - unsupported, nudging to playlist');
			toast('starl: share a Spotify playlist to import (single tracks aren’t supported yet)');
			return;
		}

		if (_handled) {
			log('already handled a share this session, skipping duplicate');
			return;
		}
		_handled = true;

		// the sheet + import/queue modules may not be wired the instant a cold-start
		// share arrives; wait briefly for them before opening the chooser.
		var attempts = 0;
		(function tryOpen() {
			attempts++;
			if (window.starlBottomSheet && window.starlPlayer) {
				openChooser(url, kind);
				return;
			}
			if (attempts < 30) {
				setTimeout(tryOpen, 200);
			} else {
				log('ERROR: UI not ready after', attempts, 'attempts');
				toast('starl: not ready, try sharing again');
				_handled = false;
			}
		})();
	}

	/* ☆======= Path 2: MainActivity.onNewIntent calls this directly =======☆ */

	window.starlHandleShareUrl = function (url) {
		log('starlHandleShareUrl (from Java onNewIntent):', url);
		_handled = false; // a fresh share should always re-open the chooser
		handleSharedUrl(url);
	};

	/* ☆======= Paths 1 & 3: deviceready =======☆ */

	document.addEventListener(
		'deviceready',
		function () {
			log('deviceready fired');
			log('  window._StarlBridge:', typeof window._StarlBridge);
			log('  window.StarlIntent:', typeof window.StarlIntent);

			/* --- path 1: @JavascriptInterface bridge (default) --- */
			if (window._StarlBridge && typeof window._StarlBridge.getShareUrl === 'function') {
				try {
					var bridgeUrl = window._StarlBridge.getShareUrl();
					log('_StarlBridge.getShareUrl() returned:', JSON.stringify(bridgeUrl));
					if (bridgeUrl) handleSharedUrl(bridgeUrl);
				} catch (e) {
					log('_StarlBridge.getShareUrl() threw:', e);
				}
			} else {
				log('_StarlBridge not available (hook may not have run yet)');
			}

			/* --- path 3: cordova.exec plugin (fallback) --- */
			if (window.StarlIntent) {
				window.StarlIntent.getInitialUrl(
					function (url) {
						log('StarlIntent.getInitialUrl() returned:', JSON.stringify(url));
						if (url) handleSharedUrl(url);
					},
					function (err) {
						log('StarlIntent.getInitialUrl() error (expected if class not found):', err);
					},
				);

				window.StarlIntent.addShareListener(function (data) {
					log('StarlIntent.addShareListener fired:', data);
					if (data && data.url) {
						_handled = false;
						handleSharedUrl(data.url);
					}
				});
			} else {
				log('window.StarlIntent not available');
			}
		},
		false,
	);
})();

/**
 * ☆=========================================☆
 * Playlist UI - view mode, cover grids, drag-drop reorder
 * Handles how playlists look (tile or list) and how track lists can be reordered.
 *
 * --- What this file does? ---
 * - renderPlaylistCard(): builds one playlist card in tile or list form
 * - generatePlaylistCover(): draws the 2x2 (or smaller) artwork grid on a playlist
 * - toggleViewMode(): switches between 'tiles' and 'list', persists the choice
 * - enterReorderMode() / exitReorderMode(): enables drag-drop within a track list
 *
 * --- Dictionary / Terms / Extra details ---
 * - "cover grid" = up to 4 track images arranged in a square mosaic
 * - View mode is saved to localStorage and restored on next load
 * ☆=========================================☆
 */

(function () {
	const VIEWMODE_KEY = 'starl_playlist_viewmode';
	const VIEWMODES = ['tiles', 'list'];

	let currentViewMode = 'tiles';
	let reorderMode = false;

	// ----- View mode -----

	function setViewMode(mode) {
		if (!VIEWMODES.includes(mode)) {
			return;
		}
		currentViewMode = mode;
		try {
			localStorage.setItem(VIEWMODE_KEY, mode);
		} catch (error) {}
	}

	function getViewMode() {
		return currentViewMode;
	}

	function loadSavedViewMode() {
		try {
			const saved = localStorage.getItem(VIEWMODE_KEY);
			if (saved && VIEWMODES.includes(saved)) {
				currentViewMode = saved;
			}
		} catch (error) {}
	}

	// ----- Playlist covers -----

	function createPlaylistCover(tracks, size = 200) {
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return null;
		}

		const trackImages = Array.isArray(tracks) ? tracks.slice(0, 4) : [];
		const cellSize = size / 2;

		ctx.fillStyle = '#111';
		ctx.fillRect(0, 0, size, size);

		const positions = [
			{x: 0, y: 0},
			{x: cellSize, y: 0},
			{x: 0, y: cellSize},
			{x: cellSize, y: cellSize},
		];

		trackImages.forEach((track, index) => {
			if (index >= 4 || !track) {
				return;
			}

			const pos = positions[index];
			const imageUrl = String(track.imageUrl || '').trim();

			if (imageUrl) {
				const img = new Image();
				img.crossOrigin = 'anonymous';
				img.onload = () => {
					ctx.drawImage(img, pos.x, pos.y, cellSize, cellSize);
				};
				img.onerror = () => {
					ctx.fillStyle = '#333';
					ctx.fillRect(pos.x, pos.y, cellSize, cellSize);
				};
				img.src = imageUrl;
			} else {
				ctx.fillStyle = '#333';
				ctx.fillRect(pos.x, pos.y, cellSize, cellSize);
			}
		});

		return canvas.toDataURL();
	}

	function generatePlaylistCoverDataUrl(tracks) {
		const canvas = document.createElement('canvas');
		canvas.width = 200;
		canvas.height = 200;

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return null;
		}

		const trackImages = Array.isArray(tracks) ? tracks.slice(0, 4) : [];
		const cellSize = 100;

		ctx.fillStyle = '#111111';
		ctx.fillRect(0, 0, 200, 200);

		const positions = [
			{x: 0, y: 0},
			{x: 100, y: 0},
			{x: 0, y: 100},
			{x: 100, y: 100},
		];

		let loadedCount = 0;

		const loadImage = (imageUrl, x, y) => {
			return new Promise((resolve) => {
				const img = new Image();
				img.crossOrigin = 'anonymous';

				const drawFallback = () => {
					ctx.fillStyle = '#333333';
					ctx.fillRect(x, y, cellSize, cellSize);
					loadedCount++;
					resolve();
				};

				img.onload = () => {
					ctx.drawImage(img, x, y, cellSize, cellSize);
					loadedCount++;
					resolve();
				};

				img.onerror = drawFallback;
				img.src = imageUrl;

				setTimeout(drawFallback, 2000);
			});
		};

		const promises = trackImages.slice(0, 4).map((track, index) => {
			const pos = positions[index];
			const imageUrl = String(track && track.imageUrl ? track.imageUrl : '').trim();
			if (!imageUrl) {
				ctx.fillStyle = '#333333';
				ctx.fillRect(pos.x, pos.y, cellSize, cellSize);
				return Promise.resolve();
			}
			return loadImage(imageUrl, pos.x, pos.y);
		});

		Promise.all(promises)
			.then(() => {
				return canvas.toDataURL();
			})
			.catch(() => {
				return canvas.toDataURL();
			});

		return canvas.toDataURL();
	}

	// ----- Reorder mode -----

	function setReorderMode(enabled) {
		reorderMode = Boolean(enabled);
	}

	function isReorderMode() {
		return reorderMode;
	}

	// ----- Playlist item rendering -----

	function createPlaylistTile(playlist) {
		const div = document.createElement('div');
		div.className = 'playlist-tile';
		div.dataset.playlistId = String(playlist.id || '');

		const cover = document.createElement('div');
		cover.className = 'playlist-tile-cover';

		const coverUrl = generatePlaylistCoverDataUrl(Array.isArray(playlist.tracks) ? playlist.tracks : []);
		if (coverUrl) {
			cover.style.backgroundImage = 'url(' + coverUrl + ')';
		}

		const info = document.createElement('div');
		info.className = 'playlist-tile-info';

		const title = document.createElement('div');
		title.className = 'playlist-tile-title';
		title.textContent = String(playlist.title || 'Untitled');

		const meta = document.createElement('div');
		meta.className = 'playlist-tile-meta';
		const trackCount = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0;
		meta.textContent = String(trackCount) + ' songs';

		info.appendChild(title);
		info.appendChild(meta);

		div.appendChild(cover);
		div.appendChild(info);

		return div;
	}

	function createPlaylistListItem(playlist) {
		const li = document.createElement('li');
		li.className = 'playlist-list-item';
		li.dataset.playlistId = String(playlist.id || '');

		const cover = document.createElement('div');
		cover.className = 'playlist-list-item-cover';

		const coverUrl = generatePlaylistCoverDataUrl(Array.isArray(playlist.tracks) ? playlist.tracks : []);
		if (coverUrl) {
			cover.style.backgroundImage = 'url(' + coverUrl + ')';
		}

		const content = document.createElement('div');
		content.className = 'playlist-list-item-content';

		const title = document.createElement('div');
		title.className = 'playlist-list-item-title';
		title.textContent = String(playlist.title || 'Untitled');

		const meta = document.createElement('div');
		meta.className = 'playlist-list-item-meta';
		const trackCount = Array.isArray(playlist.tracks) ? playlist.tracks.length : 0;
		meta.textContent = String(trackCount) + ' songs';

		content.appendChild(title);
		content.appendChild(meta);

		li.appendChild(cover);
		li.appendChild(content);

		return li;
	}

	function createTrackRow(track, index, options = {}) {
		const li = document.createElement('li');
		li.className = 'track-row';
		li.dataset.trackIndex = String(index);
		li.dataset.trackKey = String(track && track.trackKey ? track.trackKey : '');

		if (options.draggable) {
			li.draggable = true;
		}

		const cover = document.createElement('div');
		cover.className = 'track-row-cover';
		const imageUrl = String(track && track.imageUrl ? track.imageUrl : '').trim();
		if (imageUrl) {
			cover.style.backgroundImage = 'url(' + imageUrl + ')';
		}

		const info = document.createElement('div');
		info.className = 'track-row-info';

		const title = document.createElement('div');
		title.className = 'track-row-title';
		title.textContent = String(track && track.title ? track.title : 'Untitled');

		const artist = document.createElement('div');
		artist.className = 'track-row-artist';
		artist.textContent = String(track && track.artist ? track.artist : 'Unknown');

		info.appendChild(title);
		info.appendChild(artist);

		const duration = document.createElement('div');
		duration.className = 'track-row-duration';
		const mins = Math.floor((track && track.duration ? track.duration : 0) / 60);
		const secs = Math.round(((track && track.duration ? track.duration : 0) % 60) * 100) / 100;
		duration.textContent = String(mins) + ':' + String(secs).padStart(2, '0');

		li.appendChild(cover);
		li.appendChild(info);
		li.appendChild(duration);

		// alias keys so offline-availability can match cached tracks stored under
		// sourceUrl/streamUrl rather than trackKey
		li.dataset.cacheKeys = [track && track.sourceUrl, track && track.streamUrl].filter(Boolean).join('\n');
		if (window.starlNowPlaying) {
			window.starlNowPlaying.markTrackRow(li, li.dataset.trackKey);
		}

		return li;
	}

	// ----- Duration utilities -----

	function formatDuration(seconds) {
		const totalSeconds = Math.floor(Number(seconds) || 0);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);

		if (hours > 0) {
			return String(hours) + 'h ' + String(minutes) + 'm';
		}
		return String(minutes) + 'm';
	}

	function getTotalDuration(tracks) {
		if (!Array.isArray(tracks)) {
			return 0;
		}
		return tracks.reduce((sum, track) => sum + (Number(track && track.duration ? track.duration : 0) || 0), 0);
	}

	// ----- Public API -----

	window.starlPlaylistUI = {
		setViewMode,
		getViewMode,
		loadSavedViewMode,
		createPlaylistCover,
		generatePlaylistCoverDataUrl,
		setReorderMode,
		isReorderMode,
		createPlaylistTile,
		createPlaylistListItem,
		createTrackRow,
		formatDuration,
		getTotalDuration,
	};
})();

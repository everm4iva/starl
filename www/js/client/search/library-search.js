/*
Library global search
-> searches across history, favorites, playlists, artists, and albums.
-> matches track titles, artist names, album names, and playlist titles.
-> provides result filtering and aggregation.
*/

(function () {
	const MAX_RESULTS_PER_TYPE = 20;

	// ----- Search API providers -----

	function getHistory() {
		if (window.starlListeningHistory && typeof window.starlListeningHistory.getHistory === 'function') {
			return window.starlListeningHistory.getHistory();
		}
		return [];
	}

	function getFavorites() {
		if (window.starlFavorites && typeof window.starlFavorites.listEntries === 'function') {
			return window.starlFavorites.listEntries();
		}
		if (window.starlFavorites && typeof window.starlFavorites.list === 'function') {
			const map = window.starlFavorites.list();
			return Object.values(map || {});
		}
		return [];
	}

	function getPlaylists() {
		if (window.starlPlaylists && typeof window.starlPlaylists.listEntries === 'function') {
			return window.starlPlaylists.listEntries();
		}
		if (window.starlPlaylists && typeof window.starlPlaylists.list === 'function') {
			return window.starlPlaylists.list();
		}
		return [];
	}

	// ----- Search logic -----

	function normalizeQuery(query) {
		return String(query || '')
			.trim()
			.toLowerCase();
	}

	function matchesQuery(text, query) {
		return normalizeQuery(text).includes(normalizeQuery(query));
	}

	function searchTracks(query) {
		const normalizedQuery = normalizeQuery(query);
		const results = [];
		const seen = new Set();

		const allTracks = [];

		getHistory().forEach((track) => {
			allTracks.push({...track, source: 'history'});
		});

		getFavorites().forEach((track) => {
			allTracks.push({...track, source: 'favorites'});
		});

		getPlaylists().forEach((playlist) => {
			const tracks = Array.isArray(playlist && playlist.tracks ? playlist.tracks : []) ? playlist.tracks : [];
			tracks.forEach((track) => {
				allTracks.push({...track, source: 'playlist:' + (playlist.title || 'playlist')});
			});
		});

		allTracks.forEach((track) => {
			const trackKey = String(track && track.trackKey ? track.trackKey : '').trim();
			if (seen.has(trackKey)) {
				return;
			}

			const title = String(track && track.title ? track.title : '').trim();
			const artist = String(track && track.artist ? track.artist : '').trim();
			const album = String(track && track.album ? track.album : '').trim();

			if (
				matchesQuery(title, normalizedQuery) ||
				matchesQuery(artist, normalizedQuery) ||
				matchesQuery(album, normalizedQuery)
			) {
				seen.add(trackKey);
				results.push({
					type: 'track',
					trackKey: trackKey,
					title: title,
					artist: artist,
					album: album,
					imageUrl: String(track && track.imageUrl ? track.imageUrl : '').trim(),
					duration: Number(track && track.duration ? track.duration : 0) || 0,
					source: track.source || 'history',
				});
			}
		});

		return results.slice(0, MAX_RESULTS_PER_TYPE);
	}

	function searchArtists(query) {
		const normalizedQuery = normalizeQuery(query);
		const results = [];
		const artistNames = new Set();

		const allTracks = [];

		getHistory().forEach((track) => {
			allTracks.push(track);
		});

		getFavorites().forEach((track) => {
			allTracks.push(track);
		});

		getPlaylists().forEach((playlist) => {
			const tracks = Array.isArray(playlist && playlist.tracks ? playlist.tracks : []) ? playlist.tracks : [];
			tracks.forEach((track) => {
				allTracks.push(track);
			});
		});

		allTracks.forEach((track) => {
			const artist = String(track && track.artist ? track.artist : '').trim();
			if (!artist || artistNames.has(artist)) {
				return;
			}

			if (matchesQuery(artist, normalizedQuery)) {
				artistNames.add(artist);
				const artistTracks = allTracks.filter((t) => String(t && t.artist ? t.artist : '').trim() === artist);

				results.push({
					type: 'artist',
					name: artist,
					trackCount: artistTracks.length,
					imageUrl: String(
						(artistTracks[0] && artistTracks[0].imageUrl ? artistTracks[0].imageUrl : '') || '',
					).trim(),
				});
			}
		});

		return results.slice(0, MAX_RESULTS_PER_TYPE);
	}

	function searchAlbums(query) {
		const normalizedQuery = normalizeQuery(query);
		const results = [];
		const albumNames = new Set();

		const allTracks = [];

		getHistory().forEach((track) => {
			allTracks.push(track);
		});

		getFavorites().forEach((track) => {
			allTracks.push(track);
		});

		getPlaylists().forEach((playlist) => {
			const tracks = Array.isArray(playlist && playlist.tracks ? playlist.tracks : []) ? playlist.tracks : [];
			tracks.forEach((track) => {
				allTracks.push(track);
			});
		});

		allTracks.forEach((track) => {
			const album = String(track && track.album ? track.album : '').trim();
			if (!album || albumNames.has(album)) {
				return;
			}

			if (matchesQuery(album, normalizedQuery)) {
				albumNames.add(album);
				const albumTracks = allTracks.filter((t) => String(t && t.album ? t.album : '').trim() === album);

				results.push({
					type: 'album',
					name: album,
					trackCount: albumTracks.length,
					artist: String((albumTracks[0] && albumTracks[0].artist ? albumTracks[0].artist : '') || '').trim(),
					imageUrl: String(
						(albumTracks[0] && albumTracks[0].imageUrl ? albumTracks[0].imageUrl : '') || '',
					).trim(),
				});
			}
		});

		return results.slice(0, MAX_RESULTS_PER_TYPE);
	}

	function searchPlaylists(query) {
		const normalizedQuery = normalizeQuery(query);
		const results = [];

		getPlaylists().forEach((playlist) => {
			const title = String(playlist && playlist.title ? playlist.title : '').trim();
			if (matchesQuery(title, normalizedQuery)) {
				const tracks = Array.isArray(playlist && playlist.tracks ? playlist.tracks : []) ? playlist.tracks : [];

				results.push({
					type: 'playlist',
					id: String(playlist && playlist.id ? playlist.id : '').trim(),
					title: title,
					trackCount: tracks.length,
					imageUrl: String((tracks[0] && tracks[0].imageUrl ? tracks[0].imageUrl : '') || '').trim(),
				});
			}
		});

		return results.slice(0, MAX_RESULTS_PER_TYPE);
	}

	function search(query) {
		if (!query || !String(query || '').trim()) {
			return {tracks: [], artists: [], albums: [], playlists: [], total: 0};
		}

		return {
			tracks: searchTracks(query),
			artists: searchArtists(query),
			albums: searchAlbums(query),
			playlists: searchPlaylists(query),
			total: 0,
		};
	}

	// ----- Result rendering helpers -----

	function createSearchResultItem(result) {
		const div = document.createElement('div');
		div.className = 'library-search-result-item';
		div.dataset.type = String(result && result.type ? result.type : 'unknown');

		if (result.type === 'track') {
			const cover = document.createElement('div');
			cover.className = 'library-search-result-cover';
			if (result.imageUrl) {
				cover.style.backgroundImage = 'url(' + result.imageUrl + ')';
			}

			const info = document.createElement('div');
			info.className = 'library-search-result-info';

			const title = document.createElement('div');
			title.className = 'library-search-result-title';
			title.textContent = String(result.title || 'Untitled');

			const meta = document.createElement('div');
			meta.className = 'library-search-result-meta';
			meta.textContent = String(result.artist || 'Unknown') + ' · ' + String(result.album || '');

			info.appendChild(title);
			info.appendChild(meta);

			div.appendChild(cover);
			div.appendChild(info);
		} else if (result.type === 'artist') {
			const cover = document.createElement('div');
			cover.className = 'library-search-result-cover';
			if (result.imageUrl) {
				cover.style.backgroundImage = 'url(' + result.imageUrl + ')';
			}

			const info = document.createElement('div');
			info.className = 'library-search-result-info';

			const name = document.createElement('div');
			name.className = 'library-search-result-title';
			name.textContent = String(result.name || 'Unknown');

			const meta = document.createElement('div');
			meta.className = 'library-search-result-meta';
			meta.textContent = String(result.trackCount || 0) + ' songs';

			info.appendChild(name);
			info.appendChild(meta);

			div.appendChild(cover);
			div.appendChild(info);
		} else if (result.type === 'album') {
			const cover = document.createElement('div');
			cover.className = 'library-search-result-cover';
			if (result.imageUrl) {
				cover.style.backgroundImage = 'url(' + result.imageUrl + ')';
			}

			const info = document.createElement('div');
			info.className = 'library-search-result-info';

			const name = document.createElement('div');
			name.className = 'library-search-result-title';
			name.textContent = String(result.name || 'Unknown');

			const meta = document.createElement('div');
			meta.className = 'library-search-result-meta';
			meta.textContent = String(result.artist || 'Unknown') + ' · ' + String(result.trackCount || 0) + ' songs';

			info.appendChild(name);
			info.appendChild(meta);

			div.appendChild(cover);
			div.appendChild(info);
		} else if (result.type === 'playlist') {
			const cover = document.createElement('div');
			cover.className = 'library-search-result-cover';
			if (result.imageUrl) {
				cover.style.backgroundImage = 'url(' + result.imageUrl + ')';
			}

			const info = document.createElement('div');
			info.className = 'library-search-result-info';

			const title = document.createElement('div');
			title.className = 'library-search-result-title';
			title.textContent = String(result.title || 'Untitled');

			const meta = document.createElement('div');
			meta.className = 'library-search-result-meta';
			meta.textContent = String(result.trackCount || 0) + ' songs';

			info.appendChild(title);
			info.appendChild(meta);

			div.appendChild(cover);
			div.appendChild(info);
		}

		return div;
	}

	// ----- Public API -----

	window.starlLibrarySearch = {
		search,
		searchTracks,
		searchArtists,
		searchAlbums,
		searchPlaylists,
		createSearchResultItem,
	};
})();

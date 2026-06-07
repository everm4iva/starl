/**
 * ☆=========================================☆
 * Playlist settings - name edit and cover selection modal
 * The settings modal for a user-created playlist: rename it and pick which
 * track covers appear on the playlist thumbnail.
 *
 * --- What this file does? ---
 * - openSettingsModal(playlistId): creates and shows the modal
 * - closeSettingsModal(): hides the modal
 * - Saves name changes and cover track selections back to the playlist
 * - Fires 'starl-playlist-settings-saved' after a successful save
 * ☆=========================================☆
 */

(function () {
	let activePlaylistId = '';
	let settingsModalEl = null;
	let nameInputEl = null;
	let coverGridEl = null;
	let saveButtonEl = null;
	let cancelButtonEl = null;

	// ----- Helpers -----

	function getPlaylistsApi() {
		return window.starlPlaylists || null;
	}

	function findPlaylist(playlistId) {
		const api = getPlaylistsApi();
		if (!api || typeof api.getPlaylist !== 'function') {
			return null;
		}
		return api.getPlaylist(String(playlistId || '').trim());
	}

	function updatePlaylistTitle(playlistId, newTitle) {
		const api = getPlaylistsApi();
		if (!api || typeof api.updatePlaylistTitle !== 'function') {
			return false;
		}
		return api.updatePlaylistTitle(String(playlistId || '').trim(), String(newTitle || '').trim());
	}

	function updatePlaylistCover(playlistId, coverTrackIndices) {
		const api = getPlaylistsApi();
		if (!api || typeof api.updatePlaylistCover !== 'function') {
			return false;
		}
		return api.updatePlaylistCover(String(playlistId || '').trim(), coverTrackIndices);
	}

	// ----- Modal creation -----

	function createSettingsModal() {
		const modal = document.createElement('div');
		modal.className = 'playlist-settings-modal';
		modal.id = 'playlist-settings-modal';

		const backdrop = document.createElement('div');
		backdrop.className = 'playlist-settings-backdrop';
		backdrop.addEventListener('click', (e) => {
			if (e.target === backdrop) {
				closeSettingsModal();
			}
		});

		const content = document.createElement('div');
		content.className = 'playlist-settings-content';

		const header = document.createElement('div');
		header.className = 'playlist-settings-header';

		const title = document.createElement('h2');
		title.className = 'playlist-settings-title';
		title.textContent = 'Playlist settings';

		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'playlist-settings-close-btn';
		closeBtn.textContent = 'Close';
		closeBtn.addEventListener('click', closeSettingsModal);

		header.appendChild(title);
		header.appendChild(closeBtn);

		const section1 = document.createElement('div');
		section1.className = 'playlist-settings-section';

		const labelName = document.createElement('label');
		labelName.className = 'playlist-settings-label';
		labelName.textContent = 'Playlist name';

		nameInputEl = document.createElement('input');
		nameInputEl.type = 'text';
		nameInputEl.className = 'playlist-settings-name-input';
		nameInputEl.placeholder = 'Enter playlist name';
		nameInputEl.maxLength = '100';

		section1.appendChild(labelName);
		section1.appendChild(nameInputEl);

		const section2 = document.createElement('div');
		section2.className = 'playlist-settings-section';

		const labelCover = document.createElement('label');
		labelCover.className = 'playlist-settings-label';
		labelCover.textContent = 'Playlist cover (select up to 4 tracks)';

		coverGridEl = document.createElement('div');
		coverGridEl.className = 'playlist-settings-cover-grid';

		section2.appendChild(labelCover);
		section2.appendChild(coverGridEl);

		const footer = document.createElement('div');
		footer.className = 'playlist-settings-footer';

		cancelButtonEl = document.createElement('button');
		cancelButtonEl.type = 'button';
		cancelButtonEl.className = 'playlist-settings-button playlist-settings-button-cancel';
		cancelButtonEl.textContent = 'Cancel';
		cancelButtonEl.addEventListener('click', closeSettingsModal);

		saveButtonEl = document.createElement('button');
		saveButtonEl.type = 'button';
		saveButtonEl.className = 'playlist-settings-button playlist-settings-button-save';
		saveButtonEl.textContent = 'Save';
		saveButtonEl.addEventListener('click', savePlaylistSettings);

		footer.appendChild(cancelButtonEl);
		footer.appendChild(saveButtonEl);

		content.appendChild(header);
		content.appendChild(section1);
		content.appendChild(section2);
		content.appendChild(footer);

		backdrop.appendChild(content);
		modal.appendChild(backdrop);

		return modal;
	}

	function createCoverTrackOption(track, trackIndex) {
		const div = document.createElement('div');
		div.className = 'playlist-settings-track-option';
		div.dataset.trackIndex = String(trackIndex);

		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'playlist-settings-track-checkbox';
		checkbox.dataset.trackIndex = String(trackIndex);

		const cover = document.createElement('div');
		cover.className = 'playlist-settings-track-cover';
		const imageUrl = String(track && track.imageUrl ? track.imageUrl : '').trim();
		if (imageUrl) {
			cover.style.backgroundImage = 'url(' + imageUrl + ')';
		}

		const label = document.createElement('label');
		label.className = 'playlist-settings-track-label';
		label.appendChild(checkbox);
		label.appendChild(cover);

		div.appendChild(label);

		checkbox.addEventListener('change', () => {
			const checked = coverGridEl.querySelectorAll('.playlist-settings-track-checkbox:checked');
			if (checked.length > 4) {
				checkbox.checked = false;
			}
		});

		return div;
	}

	function populateCoverGrid(playlist) {
		if (!coverGridEl) {
			return;
		}

		coverGridEl.innerHTML = '';

		const tracks = Array.isArray(playlist && playlist.tracks ? playlist.tracks : []) ? playlist.tracks : [];
		tracks.slice(0, 12).forEach((track, index) => {
			const option = createCoverTrackOption(track, index);
			coverGridEl.appendChild(option);
		});
	}

	// ----- Modal management -----

	function openSettingsModal(playlistId) {
		activePlaylistId = String(playlistId || '').trim();
		const playlist = findPlaylist(activePlaylistId);

		if (!playlist) {
			console.warn('Playlist not found', activePlaylistId);
			return;
		}

		if (!settingsModalEl) {
			settingsModalEl = createSettingsModal();
		}

		nameInputEl.value = String(playlist && playlist.title ? playlist.title : '').trim();
		populateCoverGrid(playlist);

		if (!settingsModalEl.parentElement) {
			document.body.appendChild(settingsModalEl);
		}

		settingsModalEl.classList.remove('hidden');
	}

	function closeSettingsModal() {
		if (settingsModalEl) {
			settingsModalEl.classList.add('hidden');
		}
		activePlaylistId = '';
	}

	function savePlaylistSettings() {
		if (!activePlaylistId) {
			return;
		}

		const newTitle = nameInputEl.value.trim();
		if (newTitle) {
			updatePlaylistTitle(activePlaylistId, newTitle);
		}

		const selectedCheckboxes = coverGridEl.querySelectorAll('.playlist-settings-track-checkbox:checked');
		const coverIndices = Array.from(selectedCheckboxes).map((cb) => Number(cb.dataset.trackIndex));

		if (coverIndices.length > 0) {
			updatePlaylistCover(activePlaylistId, coverIndices);
		}

		closeSettingsModal();

		try {
			window.dispatchEvent(
				new CustomEvent('starl-playlist-settings-saved', {detail: {playlistId: activePlaylistId}}),
			);
		} catch (error) {}
	}

	// ----- Public API -----

	window.starlPlaylistSettings = {openSettingsModal, closeSettingsModal};
})();

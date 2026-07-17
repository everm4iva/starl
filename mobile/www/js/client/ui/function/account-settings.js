/**
 * ☆=========================================☆
 * Account settings - editable profile name and picture
 * Lets the user rename themselves and upload a profile picture from the
 * account tab's edit button. Works offline: edits apply locally right away
 * and sync to the server in the background, retried once a connection
 * comes back.
 *
 * --- What this file does? ---
 * - Wires .pf-actions .pf-btn.edit to a small "Edit name / Edit picture" menu
 * - openNameModal(): inline modal to rename, validated client-side
 * - Picture upload: validates size/dimensions/aspect, then uploads
 * - Caches the active name/picture in localStorage so it works offline
 * - Queues unsynced edits and retries them on reconnect
 *
 * --- Dictionary / Terms / Extra details ---
 * - "pending" = a local edit not yet confirmed saved on the server
 * ☆=========================================☆
 */

(function () {
	const STORAGE_KEY = 'starl_account_settings';
	const API_ROOT = '/account/settings';
	const RECONNECT_INTERVAL_MS = 60 * 1000;
	const NAME_MAX_LENGTH = 19;
	const NAME_PATTERN = /^[A-Za-z0-9 .*@|]+$/;
	const MAX_PICTURE_BYTES = 2 * 1024 * 1024; // 2MB
	const MAX_PICTURE_DIMENSION = 1000; // 1000x1000px

	let settings = loadLocal();
	let menuEl = null;
	let modalEl = null;
	let nameInputEl = null;
	let errorEl = null;
	let fileInputEl = null;
	let syncing = false;

	/* ☆======= Local helpers (shadow globals for IIFE scope) =======☆ */

	function getApiBase() {
		if (typeof window.getApiBase === 'function') {
			return window.getApiBase();
		}
		return window.STARL_API_BASE;
	}

	function getAccessToken() {
		if (typeof window.getAccessToken === 'function') {
			return window.getAccessToken();
		}
		return localStorage.getItem('starl_access_token');
	}

	/* ☆======= Local cache =======☆ */

	function loadLocal() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === 'object') {
					return parsed;
				}
			}
		} catch (error) {}
		return {name: '', pictureDataUrl: '', hasServerPicture: false, pendingName: null, pendingPictureDataUrl: null};
	}

	function saveLocal() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
		} catch (error) {}
	}

	function applyToUi() {
		const root = document.documentElement.style;
		const escapeCss = (v) =>
			String(v || '')
				.replace(/\\/g, '\\\\')
				.replace(/'/g, "\\'");
		if (settings.name) {
			root.setProperty('--user-profile-name', "'" + escapeCss(settings.name) + "'");
		}
		if (settings.pictureDataUrl) {
			root.setProperty('--user-profile-pic', 'url("' + settings.pictureDataUrl + '")');
		}
	}

	/* ☆======= Validation =======☆ */

	function validateName(rawName) {
		const cleaned = String(rawName || '').trim();
		if (!cleaned) {
			return {ok: false, error: 'Name cannot be empty.'};
		}
		if (cleaned.length > NAME_MAX_LENGTH) {
			return {ok: false, error: 'Name must be at most ' + NAME_MAX_LENGTH + ' characters.'};
		}
		if (!NAME_PATTERN.test(cleaned)) {
			return {ok: false, error: "Only letters, numbers, spaces, '.', '*', '@' and '|' are allowed."};
		}
		return {ok: true, value: cleaned};
	}

	function validatePictureFile(file) {
		return new Promise((resolve) => {
			if (!file || !/^image\//.test(file.type)) {
				resolve({ok: false, error: 'Please choose an image file.'});
				return;
			}
			if (file.size > MAX_PICTURE_BYTES) {
				resolve({ok: false, error: 'Picture must be under 2MB.'});
				return;
			}
			const objectUrl = URL.createObjectURL(file);
			const img = new Image();
			img.onload = () => {
				URL.revokeObjectURL(objectUrl);
				if (img.naturalWidth !== img.naturalHeight) {
					resolve({ok: false, error: 'Picture must have a 1:1 aspect ratio.'});
					return;
				}
				if (img.naturalWidth > MAX_PICTURE_DIMENSION) {
					resolve({
						ok: false,
						error: 'Picture must be at most ' + MAX_PICTURE_DIMENSION + 'x' + MAX_PICTURE_DIMENSION + '.',
					});
					return;
				}
				resolve({ok: true});
			};
			img.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				resolve({ok: false, error: 'Could not read that image.'});
			};
			img.src = objectUrl;
		});
	}

	/* ☆======= File <-> data URL =======☆ */

	function fileToDataUrl(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result || ''));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	function dataUrlToBlob(dataUrl) {
		return fetch(dataUrl).then((res) => res.blob());
	}

	/* ☆======= Server sync =======☆ */

	async function pushName(name) {
		const token = getAccessToken();
		if (!token || !navigator.onLine) {
			return false;
		}
		try {
			const response = await fetch(getApiBase() + API_ROOT, {
				method: 'PUT',
				headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
				body: JSON.stringify({name}),
			});
			if (!response.ok) {
				return false;
			}
			return true;
		} catch (error) {
			return false;
		}
	}

	async function pushPicture(blob) {
		const token = getAccessToken();
		if (!token || !navigator.onLine) {
			return false;
		}
		try {
			const form = new FormData();
			form.append('file', blob, 'profile.jpg');
			const response = await fetch(getApiBase() + API_ROOT + '/picture', {
				method: 'POST',
				headers: {'Authorization': 'Bearer ' + token},
				body: form,
			});
			return response.ok;
		} catch (error) {
			return false;
		}
	}

	async function fetchPictureAsDataUrl(userId, token) {
		try {
			const response = await fetch(getApiBase() + API_ROOT + '/picture/' + encodeURIComponent(userId), {
				headers: {'Authorization': 'Bearer ' + token},
			});
			if (!response.ok) {
				return '';
			}
			const blob = await response.blob();
			return await fileToDataUrl(blob);
		} catch (error) {
			return '';
		}
	}

	async function trySync() {
		if (syncing || !navigator.onLine) {
			return;
		}
		syncing = true;
		try {
			if (settings.pendingName) {
				const saved = await pushName(settings.pendingName);
				if (saved) {
					settings.pendingName = null;
					saveLocal();
				}
			}
			if (settings.pendingPictureDataUrl) {
				const blob = await dataUrlToBlob(settings.pendingPictureDataUrl);
				const saved = await pushPicture(blob);
				if (saved) {
					settings.hasServerPicture = true;
					settings.pendingPictureDataUrl = null;
					saveLocal();
				}
			}
		} finally {
			syncing = false;
		}
	}

	async function refreshFromServer() {
		const token = getAccessToken();
		if (!token) {
			return;
		}
		try {
			const response = await fetch(getApiBase() + API_ROOT, {headers: {'Authorization': 'Bearer ' + token}});
			if (!response.ok) {
				return;
			}
			const data = await response.json();
			const userId = (function () {
				try {
					const parts = token.split('.');
					return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || '';
				} catch (error) {
					return '';
				}
			})();

			if (!settings.pendingName && data.name) {
				settings.name = data.name;
			}
			if (!settings.pendingPictureDataUrl) {
				if (data.picture_url && !settings.pictureDataUrl && userId) {
					settings.pictureDataUrl = await fetchPictureAsDataUrl(userId, token);
				} else if (!data.picture_url) {
					settings.pictureDataUrl = '';
				}
				settings.hasServerPicture = Boolean(data.picture_url);
			}
			saveLocal();
			applyToUi();
		} catch (error) {}
		await trySync();
	}

	/* ☆======= Public edit actions =======☆ */

	function setName(rawName) {
		const result = validateName(rawName);
		if (!result.ok) {
			return result;
		}
		settings.name = result.value;
		settings.pendingName = result.value;
		saveLocal();
		applyToUi();
		pushName(result.value).then((saved) => {
			if (saved) {
				settings.pendingName = null;
				saveLocal();
			}
		});
		return {ok: true};
	}

	async function setPicture(file) {
		const validation = await validatePictureFile(file);
		if (!validation.ok) {
			return validation;
		}
		const dataUrl = await fileToDataUrl(file);
		settings.pictureDataUrl = dataUrl;
		settings.pendingPictureDataUrl = dataUrl;
		saveLocal();
		applyToUi();
		pushPicture(file).then((saved) => {
			if (saved) {
				settings.hasServerPicture = true;
				settings.pendingPictureDataUrl = null;
				saveLocal();
			}
		});
		return {ok: true};
	}

	/* ☆======= Edit menu (reuses .context-menu styling) =======☆ */

	function closeMenu() {
		if (menuEl) {
			menuEl.remove();
		}
		menuEl = null;
	}

	function createMenuButton(label, handler) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'context-menu-button';
		button.textContent = label;
		button.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			closeMenu();
			handler();
		});
		return button;
	}

	function openEditMenu(anchorElement) {
		closeMenu();
		const menu = document.createElement('div');
		menu.className = 'context-menu';
		menu.appendChild(createMenuButton('Edit name', () => openNameModal()));
		menu.appendChild(createMenuButton('Edit picture', () => fileInputEl.click()));

		document.body.appendChild(menu);
		menuEl = menu;

		const rect = anchorElement.getBoundingClientRect();
		menu.style.position = 'fixed';
		menu.style.top = String(rect.bottom + 5) + 'px';
		menu.style.left = String(Math.max(0, rect.right - menu.offsetWidth)) + 'px';

		window.addEventListener('click', closeMenu, {once: true});
	}

	/* ☆======= Name modal =======☆ */

	function createNameModal() {
		const modal = document.createElement('div');
		modal.className = 'account-settings-modal hidden';

		const backdrop = document.createElement('div');
		backdrop.className = 'account-settings-backdrop';
		backdrop.addEventListener('click', (e) => {
			if (e.target === backdrop) closeNameModal();
		});

		const content = document.createElement('div');
		content.className = 'account-settings-content';

		const header = document.createElement('div');
		header.className = 'account-settings-header';
		const title = document.createElement('h2');
		title.className = 'account-settings-title';
		title.textContent = 'Edit name';
		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'account-settings-close-btn';
		closeBtn.textContent = 'Close';
		closeBtn.addEventListener('click', closeNameModal);
		header.appendChild(title);
		header.appendChild(closeBtn);

		const section = document.createElement('div');
		section.className = 'account-settings-section';
		const label = document.createElement('label');
		label.className = 'account-settings-label';
		label.textContent = 'Display name';

		nameInputEl = document.createElement('input');
		nameInputEl.type = 'text';
		nameInputEl.className = 'account-settings-name-input';
		nameInputEl.maxLength = NAME_MAX_LENGTH;
		nameInputEl.placeholder = 'Enter your name';

		errorEl = document.createElement('div');
		errorEl.className = 'account-settings-error hidden';

		section.appendChild(label);
		section.appendChild(nameInputEl);
		section.appendChild(errorEl);

		const footer = document.createElement('div');
		footer.className = 'account-settings-footer';
		const cancelBtn = document.createElement('button');
		cancelBtn.type = 'button';
		cancelBtn.className = 'account-settings-button account-settings-button-cancel';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.addEventListener('click', closeNameModal);
		const saveBtn = document.createElement('button');
		saveBtn.type = 'button';
		saveBtn.className = 'account-settings-button account-settings-button-save';
		saveBtn.textContent = 'Save';
		saveBtn.addEventListener('click', saveNameFromModal);
		footer.appendChild(cancelBtn);
		footer.appendChild(saveBtn);

		content.appendChild(header);
		content.appendChild(section);
		content.appendChild(footer);
		backdrop.appendChild(content);
		modal.appendChild(backdrop);
		return modal;
	}

	function openNameModal() {
		if (!modalEl) {
			modalEl = createNameModal();
			document.body.appendChild(modalEl);
		}
		nameInputEl.value = settings.name || '';
		errorEl.classList.add('hidden');
		modalEl.classList.remove('hidden');
	}

	function closeNameModal() {
		if (modalEl) {
			modalEl.classList.add('hidden');
		}
	}

	function saveNameFromModal() {
		const result = setName(nameInputEl.value);
		if (!result.ok) {
			errorEl.textContent = result.error;
			errorEl.classList.remove('hidden');
			return;
		}
		closeNameModal();
	}

	/* ☆======= Boot =======☆ */

	function wireEditButton() {
		const editButton = document.getElementById('edit-profile');
		if (!editButton) {
			return;
		}
		editButton.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			openEditMenu(editButton);
		});

		fileInputEl = document.createElement('input');
		fileInputEl.type = 'file';
		fileInputEl.accept = 'image/*';
		fileInputEl.className = 'hidden';
		fileInputEl.addEventListener('change', async () => {
			const file = fileInputEl.files && fileInputEl.files[0];
			fileInputEl.value = '';
			if (!file) return;
			const result = await setPicture(file);
			if (!result.ok) {
				alert(result.error);
			}
		});
		document.body.appendChild(fileInputEl);
	}

	function init() {
		applyToUi();
		wireEditButton();
		refreshFromServer();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, {once: true});
	} else {
		init();
	}

	window.addEventListener('online', trySync);
	setInterval(() => {
		if (navigator.onLine) trySync();
	}, RECONNECT_INTERVAL_MS);

	window.addEventListener('load', () => setTimeout(applyToUi, 1500));
	window.addEventListener('starl-server-connection-state', (event) => {
		if (event && event.detail && event.detail.online) {
			setTimeout(applyToUi, 500);
		}
	});

	window.starlAccountSettings = {setName, setPicture, refreshFromServer};
})();

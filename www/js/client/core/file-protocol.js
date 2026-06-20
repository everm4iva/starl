/**
 * ☆=========================================☆
 * File protocol - where saved files land on the device
 * The union that decides where generated files get written on the client. - like a cult or smth
 * First use-case is the account export, but new "targets" can register later.
 *
 * --- What this file does? ---
 * - Registers save "targets" (each has an id, label and chosen location)
 * - Lists the folders the device offers (external, documents, internal)
 * - Remembers the user's chosen folder per target in localStorage
 * - saveJsonForTarget(): writes JSON via the Cordova file API, or falls back
 *   to a normal browser download when that API is missing or fails
 *
 * --- Dictionary / Terms / Extra details ---
 * - "target" = a named kind of file user saves (ex: account-export)
 * - "location" = a real device folder the target writes into
 * - "strategy" = how user actually saves: 'cordova-file' or 'browser-download'
 * ☆=========================================☆
 */

(function () {
	const targets = new Map();
	const PREFERENCES_KEY = 'starl_file_protocol_preferences';
	const locationPreferences = loadLocationPreferences();

	/* ☆======= Saved folder preferences =======☆ */

	function loadLocationPreferences() {
		try {
			const raw = localStorage.getItem(PREFERENCES_KEY);
			if (!raw) {
				return {};
			}
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed;
			}
		} catch (error) {}
		return {};
	}

	function persistLocationPreferences() {
		try {
			localStorage.setItem(PREFERENCES_KEY, JSON.stringify(locationPreferences));
		} catch (error) {}
	}

	function normalizeTargetId(value) {
		return String(value || '')
			.trim()
			.toLowerCase();
	}

	function hasCordovaFileApi() {
		return Boolean(
			window.cordova &&
			window.cordova.file &&
			typeof window.resolveLocalFileSystemURL === 'function' &&
			typeof window.Blob === 'function',
		);
	}

	/* ☆======= Device folders / locations =======☆ */

	function getAvailableLocations() {
		const cfile = window.cordova && window.cordova.file ? window.cordova.file : null;
		const options = [{id: 'auto', label: 'Automatic (recommended)', directory: ''}];

		if (!cfile) {
			return options;
		}

		if (cfile.externalDataDirectory) {
			options.push({
				id: 'external-data',
				label: 'External app storage',
				directory: String(cfile.externalDataDirectory),
			});
		}
		if (cfile.documentsDirectory) {
			options.push({id: 'documents', label: 'Documents folder', directory: String(cfile.documentsDirectory)});
		}
		if (cfile.dataDirectory) {
			options.push({id: 'internal-data', label: 'Internal app storage', directory: String(cfile.dataDirectory)});
		}

		return options;
	}

	function getLocationById(locationId) {
		const id = String(locationId || 'auto').trim() || 'auto';
		const available = getAvailableLocations();
		const direct = available.find((option) => option.id === id);
		if (direct) {
			return direct;
		}
		return available[0];
	}

	function resolveDirectoryForTarget(target) {
		const cfile = window.cordova && window.cordova.file ? window.cordova.file : null;
		const fallbacks = [
			(cfile && cfile.externalDataDirectory) || '',
			(cfile && cfile.documentsDirectory) || '',
			(cfile && cfile.dataDirectory) || '',
		].filter(Boolean);

		const preferredLocation = getLocationById(target && target.location ? target.location : 'auto');
		if (preferredLocation.directory) {
			return preferredLocation.directory;
		}

		const customDir = target && target.directory ? String(target.directory).trim() : '';
		if (customDir) {
			return customDir;
		}
		return fallbacks[0] || '';
	}

	/* ☆======= Targets (named kinds of saved files) =======☆ */

	function registerTarget(config) {
		const id = normalizeTargetId(config && config.id);
		if (!id) {
			return false;
		}
		const preferredLocation = String(locationPreferences[id] || 'auto').trim() || 'auto';
		targets.set(id, {
			id,
			label: String((config && config.label) || id),
			directory: String((config && config.directory) || ''),
			description: String((config && config.description) || ''),
			location: preferredLocation,
		});
		return true;
	}

	function getTarget(targetId) {
		return targets.get(normalizeTargetId(targetId)) || null;
	}

	function describeTarget(targetId) {
		const target = getTarget(targetId);
		if (!target) {
			return null;
		}
		const location = getLocationById(target.location);
		const directory = resolveDirectoryForTarget(target);
		const strategy = hasCordovaFileApi() && directory ? 'cordova-file' : 'browser-download';
		return {
			id: target.id,
			label: target.label,
			description: target.description,
			directory,
			strategy,
			locationId: location.id,
			locationLabel: location.label,
			availableLocations: getAvailableLocations(),
		};
	}

	function setTargetLocation(targetId, locationId) {
		const target = getTarget(targetId);
		if (!target) {
			return null;
		}
		const selected = getLocationById(locationId);
		target.location = selected.id;
		locationPreferences[target.id] = selected.id;
		persistLocationPreferences();
		return describeTarget(targetId);
	}

	function getTargetLocation(targetId) {
		const target = getTarget(targetId);
		if (!target) {
			return null;
		}
		return getLocationById(target.location);
	}

	/* ☆======= Writing files to disk =======☆ */

	function downloadBlob(filename, blob) {
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		return {ok: true, strategy: 'browser-download', path: filename};
	}

	function resolveDirectoryEntry(path) {
		return new Promise((resolve, reject) => {
			window.resolveLocalFileSystemURL(path, resolve, reject);
		});
	}

	function getOrCreateSubdirectory(parentDirectoryEntry, name) {
		return new Promise((resolve, reject) => {
			parentDirectoryEntry.getDirectory(name, {create: true}, resolve, reject);
		});
	}

	function writeFileEntry(directoryEntry, filename, blob) {
		return new Promise((resolve, reject) => {
			directoryEntry.getFile(
				filename,
				{create: true},
				(fileEntry) => {
					fileEntry.createWriter((writer) => {
						writer.onwriteend = () => resolve(fileEntry);
						writer.onerror = () => reject(writer.error || new Error('File write failed'));
						writer.write(blob);
					}, reject);
				},
				reject,
			);
		});
	}

	async function writeBlobToCordovaPath(target, filename, blob) {
		const selectedLocation = getLocationById(target && target.location);
		const basePath = resolveDirectoryForTarget(target);
		if (!basePath) {
			throw new Error('No writable folder available for this target.');
		}

		const rootDir = await resolveDirectoryEntry(basePath);
		const exportsDir = await getOrCreateSubdirectory(rootDir, 'exports');
		const fileEntry = await writeFileEntry(exportsDir, filename, blob);
		const path = String(fileEntry.nativeURL || fileEntry.toURL() || filename);
		return {
			ok: true,
			strategy: 'cordova-file',
			path,
			locationId: selectedLocation.id,
			locationLabel: selectedLocation.label,
		};
	}

	async function saveJsonForTarget(targetId, filename, value) {
		const target = getTarget(targetId);
		if (!target) {
			throw new Error('Unknown target: ' + targetId);
		}

		const safeFilename = String(filename || 'export.json').replace(/[\\/:*?"<>|]+/g, '_');
		const blob = new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'});

		if (!hasCordovaFileApi()) {
			return downloadBlob(safeFilename, blob);
		}

		try {
			return await writeBlobToCordovaPath(target, safeFilename, blob);
		} catch (error) {
			// browser-style fallback keeps export working if file APIs fail on a specific device.
			return downloadBlob(safeFilename, blob);
		}
	}

	function listTargets() {
		return Array.from(targets.values()).map((target) => ({...target}));
	}

	/* ☆======= Built-in targets + public API =======☆ */

	registerTarget({
		id: 'account-export',
		label: 'Account export file',
		description: 'JSON exports generated from account settings.',
	});

	window.starlFileProtocol = {
		registerTarget,
		getTarget,
		describeTarget,
		setTargetLocation,
		getTargetLocation,
		getAvailableLocations,
		saveJsonForTarget,
		listTargets,
	};
})();

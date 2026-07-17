/**
 * ☆=========================================☆
 * File export - save text/JSON to a file the user picks the home for
 * One tiny door for "download this as a file". On the phone it goes through the
 * native StarlStorage save picker (Storage Access Framework -> choose where it
 * lands); in a plain browser it falls back to a Blob + <a download> click.
 *
 * --- What this file does? ---
 * - saveText(filename, mimeType, text): save any string; resolves true / false(cancel)
 * - saveJson(nameBase, obj): pretty-print an object and save it as <nameBase>.json
 * - safeName(str): squish a title into a friendly, filesystem-safe file name
 *
 * --- Dictionary / Terms / Extra details ---
 * - native path: window.StarlStorage.saveTextFile (see cordova-plugin-starl-storage)
 * - a 'cancelled' error from the native picker is a normal back-out, not a failure
 * ☆=========================================☆
 */

(function () {
	function toast(msg, kind) {
		if (typeof window.showToast === 'function') window.showToast(msg, kind);
		else if (window.starlLayout && typeof window.starlLayout.showToast === 'function')
			window.starlLayout.showToast(msg, kind);
	}

	// turn "My  Cool Playlist!!" into "my-cool-playlist" - safe for any filesystem.
	function safeName(str) {
		return (
			String(str || '')
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 60) || 'export'
		);
	}

	function hasNativeSave() {
		return !!(window.StarlStorage && typeof window.StarlStorage.saveTextFile === 'function');
	}

	// browser-only fallback: build a blob and click a hidden download link.
	function browserDownload(filename, mimeType, text) {
		return new Promise((resolve) => {
			try {
				const blob = new Blob([text], {type: mimeType || 'application/json'});
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = filename;
				document.body.appendChild(a);
				a.click();
				setTimeout(() => {
					document.body.removeChild(a);
					URL.revokeObjectURL(url);
				}, 1000);
				resolve(true);
			} catch (e) {
				resolve(false);
			}
		});
	}

	// save `text` under `filename`. Resolves true on save, false on cancel/fail (already toasted).
	function saveText(filename, mimeType, text) {
		const name = filename || 'export.json';
		const mime = mimeType || 'application/json';
		if (hasNativeSave()) {
			return new Promise((resolve) => {
				window.StarlStorage.saveTextFile(
					name,
					mime,
					text,
					() => {
						toast('Saved ' + name, 'success');
						resolve(true);
					},
					(err) => {
						// backing out of the picker isn't an error worth shouting about.
						if (String(err) !== 'cancelled') toast('Could not save file.', 'danger');
						resolve(false);
					},
				);
			});
		}
		return browserDownload(name, mime, text).then((ok) => {
			if (ok) toast('Downloaded ' + name, 'success');
			else toast('Could not save file.', 'danger');
			return ok;
		});
	}

	// pretty-print an object and save it as <nameBase>.json.
	function saveJson(nameBase, obj) {
		let text;
		try {
			text = JSON.stringify(obj, null, 2);
		} catch (e) {
			toast('Could not build that file.', 'danger');
			return Promise.resolve(false);
		}
		return saveText(safeName(nameBase) + '.json', 'application/json', text);
	}

	window.starlFileExport = {saveText, saveJson, safeName};
})();

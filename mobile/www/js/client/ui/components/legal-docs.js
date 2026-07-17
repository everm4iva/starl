/**
 * ☆=========================================☆
 * Legal docs - "See License" / "See Privacy & Data Protection" viewer
 * Wires the two About-app rows to a bottom sheet that fetches the raw doc file,
 * runs it through the mini-markdown converter, and shows the result as styled HTML.
 *
 * --- What this file does? ---
 * - On click: fetch the doc (cached after first load), convert md -> html, show it
 * - Renders into a custom-class container (.md-content) so styling is scoped
 * - Falls back to a friendly message if a file can't be read
 *
 * --- Dictionary / Terms / Extra details ---
 * - Docs live in www/legal/ so they ship inside the app bundle and fetch works
 * - privacy&data.md has an '&' in the name -> URL-encoded as %26 when fetched
 * - Depends on window.starlMarkdown (mini-markdown.js) and window.starlBottomSheet
 * ☆=========================================☆
 */

(function () {
	// row id -> {title, url}. url is relative to index.html (the app root)
	const DOCS = {
		'about-license': {title: 'License', url: 'legal/LICENSE'},
		'about-privacy': {title: 'Privacy & Data Protection', url: 'legal/privacy%26data.md'},
	};

	const cache = {};

	async function loadDoc(url) {
		if (cache[url]) return cache[url];
		const res = await fetch(url, {cache: 'no-store'});
		if (!res.ok) throw new Error(url + ' ' + res.status);
		cache[url] = await res.text();
		return cache[url];
	}

	function renderDoc(body, title, text) {
		const heading = document.createElement('div');
		heading.className = 'bsc-settings-header';
		heading.textContent = title;
		body.appendChild(heading);

		// the custom-class element the markdown gets rendered into (styled in root.css)
		const content = document.createElement('div');
		content.className = 'md-content';
		if (window.starlMarkdown && typeof window.starlMarkdown.render === 'function') {
			window.starlMarkdown.render(content, text);
		} else {
			// converter missing - show the raw text rather than nothing
			const pre = document.createElement('pre');
			pre.className = 'md-pre';
			pre.textContent = text;
			content.appendChild(pre);
		}
		body.appendChild(content);
	}

	function renderStatus(body, message) {
		const msg = document.createElement('div');
		msg.className = 'ipl-status';
		msg.textContent = message;
		body.appendChild(msg);
	}

	async function openDoc(doc) {
		const bs = window.starlBottomSheet;
		if (!bs) return;
		bs.open({render: (body) => renderStatus(body, 'Loading ' + doc.title + '…')});
		try {
			const text = await loadDoc(doc.url);
			bs.open({render: (body) => renderDoc(body, doc.title, text)});
		} catch (e) {
			bs.open({render: (body) => renderStatus(body, doc.title + ' is unavailable.')});
		}
	}

	function init() {
		Object.keys(DOCS).forEach((id) => {
			const item = document.getElementById(id);
			if (item) item.addEventListener('click', () => openDoc(DOCS[id]));
		});
	}

	if (document.readyState !== 'loading') init();
	else document.addEventListener('DOMContentLoaded', init, {once: true});
})();

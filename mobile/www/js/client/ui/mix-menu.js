/**
 * ☆=========================================☆
 * Mix menu - the little "Create MIX" chooser sheet
 * Opened from the track context menu. Asks what to seed the mix from, then hands
 * off to the mix engine (mix-engine.js), which builds the queue and starts playing.
 *
 * --- What this file does? ---
 * - open(track): shows a sheet with "Based on current track" and "Based on queue"
 * - Tapping an option closes the sheet and asks starlMix to build that kind of mix
 *
 * --- Dictionary / Terms / Extra details ---
 * - "current track" here = the track whose context menu you opened (not always the
 *   one playing) - the mix is seeded from that song
 * ☆=========================================☆
 */

(function () {
	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function open(track) {
		const bs = window.starlBottomSheet;
		const mix = window.starlMix;
		if (!bs || !mix) return;

		bs.open({
			render(body) {
				body.appendChild(el('div', 'bsc-settings-header', 'Create MIX'));
				const list = el('div', 'rec-option-list');

				const options = [
					{
						label: 'Based on current track',
						note: 'A fresh mix seeded by this song.',
						run: () => mix.fromTrack(track),
					},
					{
						label: 'Based on queue',
						note: 'A blended mix built from everything in your queue right now.',
						run: () => mix.fromQueue(),
					},
				];

				options.forEach((opt) => {
					const row = el('div', 'rec-option-row');
					row.appendChild(el('div', 'rec-option-label', opt.label));
					row.appendChild(el('div', 'rec-option-note', opt.note));
					row.addEventListener('click', () => {
						bs.close();
						setTimeout(opt.run, 50);
					});
					list.appendChild(row);
				});

				body.appendChild(list);
			},
		});
	}

	window.starlMixMenu = {open};
})();

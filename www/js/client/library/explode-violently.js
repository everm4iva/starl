/**
 * ☆=========================================☆
 * Explode violently - shatters any DOM element into tiny colored shards.
 * Purely cosmetic; used by the artist-list pinch gesture and by every
 * "remove from X" context-menu action so deletions feel satisfying.
 *
 * --- What this file does? ---
 * - explodeViolently(el, opts): samples colors from el (or its cover image),
 *   bursts shard particles outward from el's screen position, then fades el out
 * - bindPinch(el, onExplode): two-finger spread gesture that triggers the above
 * ☆=========================================☆
 */

// WARNING: this just doesn't work in my os for some reason, if you believe it doesn't run for you, report issue in the repo.

(function () {
	const DEFAULTS = {
		shardCount: 18,
		force: 1, // multiplier on how far shards fly
		spin: 540, // max degrees of rotation per shard
		duration: 520, // ms for the shard flight animation
		fadeDuration: 180, // ms for the source element's own fade/shrink
		coverSelector: '.ap-card-cover, .lsr-cover, .ap-track-cover, .bsc-track-cover, .slt-item-bg',
		colors: null, // explicit palette override; skips image sampling
		onDone: null,
	};

	/* ☆======= Color sampling =======☆ */

	function extractBgUrl(el) {
		const bg = el && el.style && el.style.backgroundImage;
		const match = bg && bg.match(/url\(["']?(.*?)["']?\)/);
		return match && match[1];
	}

	function sampleColors(el, coverSelector) {
		const fallback = ['#ffffff', '#cccccc', '#999999'];
		const coverEl = (el.matches && el.matches(coverSelector) && el) || el.querySelector(coverSelector);
		const url = coverEl && extractBgUrl(coverEl);
		if (!url) return Promise.resolve({colors: fallback, image: null});
		return new Promise((resolve) => {
			// never let a stalled/blocked image load hang the whole explosion -
			// fall back to plain color shards (still using the real image as background)
			// if nothing happens within a short window.
			const timer = setTimeout(() => resolve({colors: fallback, image: url}), 400);
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => {
				clearTimeout(timer);
				try {
					const size = 8;
					const canvas = document.createElement('canvas');
					canvas.width = size;
					canvas.height = size;
					const ctx = canvas.getContext('2d');
					ctx.drawImage(img, 0, 0, size, size);
					const data = ctx.getImageData(0, 0, size, size).data;
					const colors = [];
					for (let i = 0; i < data.length; i += 4 * 7) {
						colors.push('rgb(' + data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ')');
					}
					resolve({colors: colors.length ? colors : fallback, image: url});
				} catch (e) {
					resolve({colors: fallback, image: url});
				}
			};
			img.onerror = () => {
				clearTimeout(timer);
				resolve({colors: fallback, image: null});
			};
			img.src = url;
		});
	}

	/* ☆======= Jagged shard polygons =======☆
	 * a handful of irregular concave/convex clip-path shapes so shards read as
	 * broken glass/shrapnel rather than uniform squares. */ // thanks claude!
	const SHARD_CLIPS = [
		'polygon(50% 0%, 100% 38%, 82% 100%, 15% 92%, 0% 35%)',
		'polygon(20% 0%, 100% 15%, 90% 70%, 55% 100%, 0% 60%)',
		'polygon(0% 10%, 60% 0%, 100% 45%, 70% 100%, 10% 85%)',
		'polygon(35% 0%, 100% 25%, 85% 90%, 30% 100%, 0% 55%)',
		'polygon(10% 0%, 90% 8%, 100% 80%, 45% 100%, 0% 70%)',
		'polygon(0% 0%, 70% 0%, 100% 60%, 60% 100%, 0% 65%)',
	];

	/* ☆======= Particle burst =======☆ */

	function burst(el, colors, image, opts) {
		const rect = el.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const radius = Math.max(rect.width, rect.height) / 2;
		const layer = document.createElement('div');
		layer.style.position = 'fixed';
		layer.style.left = '0';
		layer.style.top = '0';
		layer.style.width = '100%';
		layer.style.height = '100%';
		layer.style.pointerEvents = 'none';
		layer.style.zIndex = '9999';
		document.body.appendChild(layer);

		// image fragments: bigger shards near the center, each clipped to a jagged
		// polygon and background-positioned to show the chunk of artwork it "broke off" heheh
		const imageShardCount = image ? Math.ceil(opts.shardCount * 0.55) : 0;

		for (let i = 0; i < opts.shardCount; i++) {
			const isImageShard = i < imageShardCount;
			const shard = document.createElement('div');
			const size = isImageShard ? 16 + Math.random() * 16 : 4 + Math.random() * 7;
			const angle = (i / opts.shardCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
			const dist = radius * opts.force * (1.4 + Math.random() * 1.8);
			const startX = cx + (Math.random() - 0.5) * radius;
			const startY = cy + (Math.random() - 0.5) * radius;
			const dx = Math.cos(angle) * dist;
			const dy = Math.sin(angle) * dist;
			const spin = (Math.random() - 0.5) * 2 * opts.spin;
			const clip = SHARD_CLIPS[Math.floor(Math.random() * SHARD_CLIPS.length)];
			shard.style.position = 'absolute';
			shard.style.left = startX + 'px';
			shard.style.top = startY + 'px';
			shard.style.width = size + 'px';
			shard.style.height = size + 'px';
			shard.style.clipPath = clip;
			shard.style.opacity = '1';
			shard.style.transform = 'translate(-50%, -50%) rotate(0deg) scale(1)';
			shard.style.transition =
				'transform ' + opts.duration + 'ms cubic-bezier(.2,.8,.2,1), opacity ' + opts.duration + 'ms ease-out';

			if (isImageShard) {
				// sample a chunk of the cover roughly from the direction the shard flies,
				// so the fragments read as torn-off pieces of the original artwork. //claude nerding out this file is another scene.
				const sampleX = 50 + Math.cos(angle) * 30;
				const sampleY = 50 + Math.sin(angle) * 30;
				shard.style.backgroundImage = 'url("' + image + '")';
				shard.style.backgroundSize = rect.width * 2.2 + 'px ' + rect.height * 2.2 + 'px';
				shard.style.backgroundPosition = sampleX + '% ' + sampleY + '%';
				shard.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.15)';
			} else {
				shard.style.background = colors[i % colors.length];
			}

			layer.appendChild(shard);
			requestAnimationFrame(() => {
				shard.style.transform =
					'translate(' + (dx - size / 2) + 'px, ' + (dy - size / 2) + 'px) rotate(' + spin + 'deg) scale(0.25)';
				shard.style.opacity = '0';
			});
		}

		setTimeout(() => layer.remove(), opts.duration + 100);
	}

	/* ☆======= Public: explodeViolently =======☆ */

	function explodeViolently(el, options) {
		if (!el) return Promise.resolve();
		const opts = Object.assign({}, DEFAULTS, options);
		const samplePromise = opts.colors
			? Promise.resolve({colors: opts.colors, image: null})
			: sampleColors(el, opts.coverSelector);
		return samplePromise
			.catch(() => ({colors: ['#ffffff', '#cccccc', '#999999'], image: null}))
			.then(({colors, image}) => {
				// the shard burst is purely cosmetic - never let it throwing/misbehaving
				// stop the element from fading out and the real removal (onDone) from running.
				try {
					burst(el, colors, image, opts);
				} catch (e) {
					/* ignore - cosmetic only */
				}
				el.style.transition =
					'opacity ' + opts.fadeDuration + 'ms ease-out, transform ' + opts.fadeDuration + 'ms ease-out';
				el.style.opacity = '0';
				el.style.transform = 'scale(0.8)';
				return new Promise((resolve) => {
					setTimeout(() => {
						if (typeof opts.onDone === 'function') opts.onDone();
						resolve();
					}, opts.fadeDuration);
				});
			});
	}

	/* ☆======= Pinch gesture binding =======☆ */

	const SPREAD_THRESHOLD = 1.6; // distance ratio (current/start) needed to trigger

	function bindPinch(el, onExplode) {
		if (!el || el._pinchExplodeBound) return;
		el._pinchExplodeBound = true;
		const pointers = new Map();
		let startDist = 0;
		let triggered = false;

		function dist() {
			const pts = Array.from(pointers.values());
			if (pts.length < 2) return 0;
			const [a, b] = pts;
			return Math.hypot(a.x - b.x, a.y - b.y);
		}

		function reset() {
			pointers.clear();
			startDist = 0;
			triggered = false;
		}

		el.addEventListener('pointerdown', (e) => {
			pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
			if (pointers.size === 2) startDist = dist();
		});

		el.addEventListener('pointermove', (e) => {
			if (!pointers.has(e.pointerId)) return;
			pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
			if (pointers.size === 2 && startDist > 0 && !triggered) {
				const ratio = dist() / startDist;
				if (ratio >= SPREAD_THRESHOLD) {
					triggered = true;
					explodeViolently(el, {onDone: onExplode});
				}
			}
		});

		['pointerup', 'pointercancel'].forEach((ev) =>
			el.addEventListener(ev, (e) => {
				pointers.delete(e.pointerId);
				if (pointers.size < 2) reset();
			}),
		);
	}

	window.starlExplodeViolently = explodeViolently;
	window.starlPinchExplode = {bind: bindPinch};
})();

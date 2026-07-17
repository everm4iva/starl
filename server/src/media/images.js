/*
 * ☆ Image caching
 * -> downloads a thumbnail once and keeps a high + low variant on disk, content-addressed
 *    by source URL. ytimg/googleusercontent URLs are upgraded to a big variant for "high"
 *    and downgraded to a small one for "low". sharp does the resize (the "Pillow" package equivalent, since nodejs doesn't have Pillow..)
 * -> port of cache_image_async from cache.py; image meta sidecar keeps the same shape.
 */

import fs from 'node:fs';
import path from 'node:path';
import {IMAGE_DIR} from '../config.js';
import {makeCacheId} from './audio-id.js';
import {getImageMeta, setImageMeta, getImagePath, getImageVariantPath} from './cache.js';
import {requireNative} from '../lib/native-require.js';

const sharp = requireNative('sharp');

const LOW_MAX = 320;

function upgradeImageUrl(url) {
	let u = url;
	const low = u.toLowerCase();
	if (low.includes('ytimg.com') && !low.includes('maxresdefault')) {
		u = u
			.replace('/sddefault', '/maxresdefault')
			.replace('/hqdefault', '/maxresdefault')
			.replace('/mqdefault', '/maxresdefault')
			.replace('/default', '/maxresdefault');
	}
	if (low.includes('googleusercontent.com')) {
		u = u
			.replace('=s96-c', '=s1000-c')
			.replace('=s128-c', '=s1000-c')
			.replace('=s256-c', '=s1000-c')
			.replace(/=w\d+-h\d+/, '=w1000-h1000')
			.replace(/-w\d+-h\d+-/, '-w1000-h1000-');
	}
	return u;
}

function downgradeImageUrl(url) {
	let u = url;
	const low = u.toLowerCase();
	if (low.includes('ytimg.com')) {
		u = u
			.replace('/maxresdefault', '/mqdefault')
			.replace('/sddefault', '/mqdefault')
			.replace('/hqdefault', '/mqdefault')
			.replace('/default', '/mqdefault');
	}
	if (low.includes('googleusercontent.com')) {
		u = u
			.replace('=s1000-c', '=s96-c')
			.replace('=s512-c', '=s96-c')
			.replace('=w1000-h1000', '=w256-h256')
			.replace('-w1000-h1000-', '-w256-h256-');
	}
	return u;
}

function guessExt(url, contentType) {
	if (contentType) {
		const ct = contentType.split(';', 1)[0].trim().toLowerCase();
		const map = {
			'image/jpeg': 'jpg',
			'image/jpg': 'jpg',
			'image/png': 'png',
			'image/webp': 'webp',
			'image/gif': 'gif',
			'image/bmp': 'bmp',
			'image/avif': 'avif',
		};
		if (map[ct]) return map[ct];
	}
	const suffix = path.extname(new URL(url, 'https://x/').pathname).slice(1).toLowerCase();
	if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(suffix)) return suffix;
	return 'jpg';
}

async function downloadVariant(url, token) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 8000);
	try {
		const res = await fetch(url, {
			headers: token ? {Authorization: `Bearer ${token}`} : undefined,
			redirect: 'follow',
			signal: controller.signal,
		});
		if (!res.ok) {
			const err = new Error(`upstream image ${res.status}`);
			err.statusCode = res.status;
			throw err;
		}
		const buf = Buffer.from(await res.arrayBuffer());
		return [buf, res.headers.get('content-type')];
	} finally {
		clearTimeout(timer);
	}
}

async function writeLowVariant(sourcePath, lowPath, ext) {
	fs.mkdirSync(path.dirname(lowPath), {recursive: true});
	try {
		const img = sharp(sourcePath, {animated: true});
		const meta = await img.metadata();
		if (meta.pages && meta.pages > 1) {
			// animated (gif/webp): don't resize, just copy.
			fs.copyFileSync(sourcePath, lowPath);
			return;
		}
		let pipeline = sharp(sourcePath).resize(LOW_MAX, LOW_MAX, {fit: 'inside', withoutEnlargement: true});
		const e = ext.toLowerCase();
		if (e === 'jpg' || e === 'jpeg') pipeline = pipeline.jpeg({quality: 74});
		else if (e === 'webp') pipeline = pipeline.webp({quality: 74});
		else if (e === 'png') pipeline = pipeline.png();
		await pipeline.toFile(lowPath);
	} catch {
		fs.copyFileSync(sourcePath, lowPath);
	}
}

export async function cacheImage(url, token = null) {
	if (!url) return null;
	const imageId = makeCacheId(url);
	const meta = getImageMeta(imageId) || {};

	// already cached: make sure the low variant exists, then return
	if (meta.path && fs.existsSync(meta.path)) {
		if (meta.low_path && fs.existsSync(meta.low_path)) return imageId;
		try {
			const ext = meta.ext || path.extname(meta.path).slice(1) || 'jpg';
			const lowPath = getImageVariantPath(imageId, 'low', ext);
			await writeLowVariant(meta.path, lowPath, ext);
			meta.low_path = lowPath;
			meta.variants = meta.variants || {};
			meta.variants.low = {path: lowPath, content_type: meta.content_type};
			setImageMeta(imageId, meta);
		} catch {
			/* best effort, sweating */
		}
		return imageId;
	}

	let highSourceUrl = upgradeImageUrl(url);
	let lowSourceUrl = downgradeImageUrl(highSourceUrl);

	let highBytes;
	let highContentType;
	try {
		[highBytes, highContentType] = await downloadVariant(highSourceUrl, token);
	} catch (err) {
		if (highSourceUrl !== url) {
			highSourceUrl = url;
			lowSourceUrl = downgradeImageUrl(url);
			[highBytes, highContentType] = await downloadVariant(highSourceUrl, token);
		} else {
			throw err;
		}
	}

	const ext = guessExt(highSourceUrl, highContentType);
	const highPath = getImagePath(imageId, ext);
	fs.mkdirSync(path.dirname(highPath), {recursive: true});
	fs.writeFileSync(highPath, highBytes);

	const lowPath = getImageVariantPath(imageId, 'low', ext);
	let contentType = highContentType;
	if (lowSourceUrl !== highSourceUrl) {
		try {
			const [lowBytes, lowCt] = await downloadVariant(lowSourceUrl, token);
			fs.writeFileSync(lowPath, lowBytes);
			contentType = lowCt || highContentType;
		} catch {
			await writeLowVariant(highPath, lowPath, ext);
		}
	} else {
		await writeLowVariant(highPath, lowPath, ext);
	}

	setImageMeta(imageId, {
		url,
		source_url: highSourceUrl,
		path: highPath,
		high_path: highPath,
		low_path: lowPath,
		variants: {high: {path: highPath, content_type: contentType}, low: {path: lowPath, content_type: contentType}},
		ext,
		content_type: contentType,
	});
	return imageId;
}

export {IMAGE_DIR};

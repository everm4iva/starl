/*
 * ☆ Streaming proxy - the latency win, now seekable

 * -> streams the resolved CDN audio to the client AND writes it to the cache in one pass, so
 *    first-play starts immediately (no download-then-stream stall).
 *
 * -> the download is DECOUPLED from the client connection: it runs as a background "fill" that
 *    completes even if the requesting client disconnects. That's what makes seeking work - a
 *    seek makes the browser drop the current request and open a new ranged one, which used to
 *    abort (and bin) the very download the seek needed. Now the fill keeps going and the new
 *    request is served from the growing file.
 *
 * -> the response honours HTTP Range against the growing temp file: it serves the bytes already
 *    on disk and tails the rest as the fill writes them, advertising Accept-Ranges + the real
 *    total so the <audio> element knows it can seek. A finished file is served via sendFile
 *    (also range-capable).
 *
 * -> googlevideo DASH URLs (itag 251 / c=ANDROID_VR) throttle a single connection and cut it off
 *    after a few MB, so the fill pulls the file sequentially by byte range, re-requesting from the
 *    cutoff until the whole file is delivered.
 *
 * -> a YouTube CDN URL is single-use, so one download per track is enforced by an in-process map
 *    plus the cross-process FileLock: extra listeners attach to the running fill (or wait for the
 *    cached file from another process) instead of opening a second connection. The fill removes
 *    its .part on failure — no partial leaks.
 *
 *  in a non-nerd way: this is a "download once, serve many" proxy that lets the first client start
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import {AUDIO_DIR} from '../config.js';
import {FileLock} from '../lib/file-lock.js';
import {
	getAudioPath,
	getAudioLockPath,
	getAudioStatus,
	getPrewarmAudio,
	evictPrewarmAudio,
	markAudioPending,
	markAudioReady,
	markAudioFailed,
	getAudioMeta,
	setAudioMeta,
	AUDIO_STATUS_FAILED,
} from './cache.js';
import {cacheImage} from './images.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitForCachedFile(finalPath, audioId, timeoutMs = 90000, pollMs = 250) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (fs.existsSync(finalPath)) return true;
		if (getAudioStatus(audioId) === AUDIO_STATUS_FAILED) return false;
		if (Date.now() >= deadline) return fs.existsSync(finalPath);
		await delay(pollMs);
	}
}

async function finalizeCachedStream(tempPath, finalPath, attempts = 6) {
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			fs.renameSync(tempPath, finalPath);
			return true;
		} catch (err) {
			if (err.code === 'ENOENT') return false;
			if (attempt === attempts - 1) return false;
			await delay(100 * (attempt + 1));
		}
	}
	return false;
}

function totalFromContentRange(header) {
	// "bytes start-end/total"
	const m = header && header.match(/\/(\d+)\s*$/);
	return m ? Number(m[1]) : null;
}

// "googlevideo" domain throttles an open-ended GET to ~playback speed, but bursts a *bounded* range
// at full speed - so we pull the file in fixed-size chunks (the same trick yt-dlp uses)
const CHUNK_BYTES = 2 * 1024 * 1024;
// the fill has no client connection to abort it, so a hard stall cap stops a dead source from
// looping forever instead of relying on a client disconnect to break out
const MAX_STALLS = 40;

function serveCachedFile(res, finalPath) {
	return new Promise((resolve) => {
		res.sendFile(finalPath, {headers: {'Content-Type': 'audio/mpeg'}}, () => resolve());
	});
}

// in-process registry of running background fills, keyed by "audioId". Combined with the
// cross-process lock file it answers "is a download already in flight for this id?"
const activeDownloads = new Map();

/*
 * Really long note about the Download class:
 * A single background download of one track. Runs to completion independently of any client
 * connection. Tracks how many bytes are on disk (`downloaded`) and the total (`total`, known as
 * soon as the first upstream response headers arrive), and lets response handlers await more
 * bytes via waitForBytes(). `ready` resolves once `total` is known (or the fill ended), which is
 * when a response can start sending proper Range headers.
 *
 * in a non-nerd way: this is a "download once, serve many" proxy that lets the first client
 * start playing immediately and lets later clients seek to any part of the track without re-downloading it.
 */
class Download {
	constructor(audioId, src) {
		this.audioId = audioId;
		this.src = src;
		this.finalPath = getAudioPath(audioId);
		this.tempPath = `${this.finalPath}.${crypto.randomUUID().replace(/-/g, '')}.part`;
		this.flock = new FileLock(getAudioLockPath(audioId));
		this.fileHandle = null;

		this.total = null; // total file size in bytes, once known
		this.downloaded = 0; // bytes written to the temp file so far
		this.done = false; // fully downloaded + finalized (serve from finalPath)
		this.failed = false; // gave up - serve what we have "/error"
		this.lockLost = false; // another process owns the download; fall back to waitForCachedFile

		this._readyResolve = null;
		this.ready = new Promise((resolve) => {
			this._readyResolve = resolve;
		});
		this._readySettled = false;
		this._byteWaiters = [];
	}

	_settleReady() {
		if (this._readySettled) return;
		this._readySettled = true;
		this._readyResolve();
	}

	// wake everyone waiting on more bytes (progress, completion or failure)
	_notifyBytes() {
		const waiters = this._byteWaiters;
		this._byteWaiters = [];
		waiters.forEach((resolve) => resolve());
	}

	setTotal(total) {
		this.total = Number.isFinite(total) ? total : null;
		this._settleReady();
	}

	// resolves once at least `needed` bytes are on disk, or the fill finished/failed
	waitForBytes(needed) {
		if (this.downloaded >= needed || this.done || this.failed) return Promise.resolve();
		return new Promise((resolve) => this._byteWaiters.push(resolve));
	}

	// pull the whole file from `src` in bounded byte-range chunks, writing each piece to the temp
	// file and advancing `downloaded`. re-requests from the cutoff when the source drops a
	// connection mid-file. returns true once the full length is delivered, because :3
	async fill() {
		let position = 0;
		let stalls = 0;
		for (;;) {
			const end =
				this.total != null ? Math.min(position + CHUNK_BYTES - 1, this.total - 1) : position + CHUNK_BYTES - 1;
			let resp;
			try {
				resp = await fetch(this.src, {headers: {Range: `bytes=${position}-${end}`}, redirect: 'follow'});
			} catch (err) {
				if (++stalls > MAX_STALLS) throw err;
				await delay(200); // transient - retry the same chunk
				continue;
			}
			if (resp.status !== 200 && resp.status !== 206) throw new Error(`upstream ${resp.status}`);

			if (this.total === null) {
				let total = totalFromContentRange(resp.headers.get('content-range'));
				if (total === null && resp.status === 200) {
					const cl = resp.headers.get('content-length');
					total = cl ? Number(cl) : null;
				}
				// publish the total (or null) so waiting responses can begin; null = un-rangeable source.
				this.setTotal(total);
			}

			let got = 0;
			try {
				for await (const chunk of resp.body) {
					// wait for the write callback (data flushed to the fd) before advancing `downloaded`,
					// so a response reading the temp file on a separate fd can actually see these bytes.
					await new Promise((resolve, reject) => {
						this.fileHandle.write(chunk, (err) => (err ? reject(err) : resolve()));
					});
					position += chunk.length;
					got += chunk.length;
					this.downloaded = position;
					this._notifyBytes();
				}
			} catch (err) {
				if (got === 0) {
					if (++stalls > MAX_STALLS) throw err; // no progress - genuine failure
				} else {
					stalls = 0;
				}
				continue; // partial chunk: re-request from the new position
			}

			if (this.total === null) return true; // unknown length, single pass - assume complete
			if (position >= this.total) return true; // delivered the whole file
			if (got === 0 && ++stalls > MAX_STALLS) throw new Error('stalled with no progress');
			if (got > 0) stalls = 0;
		}
	}

	async run() {
		try {
			const got = await this.flock.acquireAsync(90, 100, () => fs.existsSync(this.finalPath));

			if (fs.existsSync(this.finalPath)) {
				// someone (another process, or a race) already produced the file - serve that.
				try {
					this.total = fs.statSync(this.finalPath).size;
				} catch {
					this.total = null;
				}
				this.downloaded = this.total || 0;
				this.done = true;
				return;
			}
			if (!got) {
				// another process holds the lock and is downloading - responses fall back to waiting.
				this.lockLost = true;
				return;
			}

			markAudioPending(this.audioId);
			fs.mkdirSync(AUDIO_DIR, {recursive: true});
			this.fileHandle = fs.createWriteStream(this.tempPath);

			let wroteOk = false;
			try {
				wroteOk = await this.fill();
			} catch {
				evictPrewarmAudio(this.audioId); // upstream failure - don't leave a partial behind
			} finally {
				await new Promise((r) => this.fileHandle.end(r));
			}

			let finalized = false;
			if (wroteOk && !fs.existsSync(this.finalPath)) {
				finalized = await finalizeCachedStream(this.tempPath, this.finalPath);
			} else if (fs.existsSync(this.finalPath)) {
				finalized = true; // another writer beat us to it
			}
			if (!finalized) {
				try {
					fs.unlinkSync(this.tempPath);
				} catch {
					/* "ok" - dry answer just like that */
				}
			}

			if (!finalized) {
				if (!wroteOk) markAudioFailed(this.audioId);
				this.failed = true;
				return;
			}

			this.done = true;
			const prewarm = getPrewarmAudio(this.audioId);
			const meta = markAudioReady(this.audioId, {audio_id: this.audioId, path: this.finalPath});
			const thumb = prewarm?.meta?.thumbnail || meta.thumbnail;
			if (thumb) {
				cacheImage(thumb)
					.then((imageId) => {
						if (imageId) {
							const m = getAudioMeta(this.audioId) || {};
							m.image_id = imageId;
							setAudioMeta(this.audioId, m);
						}
					})
					.catch(() => {
						/* background, best effort, it's trying to be exausted */
					});
			}
		} catch {
			this.failed = true;
			try {
				fs.unlinkSync(this.tempPath);
			} catch {
				/* ok - another dry answer */
			}
			markAudioFailed(this.audioId);
		} finally {
			try {
				this.flock.release();
			} catch {
				/* ok - what the fuck is happening?! This is crazy */
			}
			this._settleReady(); // unblock anyone waiting on `ready`
			this._notifyBytes(); // and anyone waiting on bytes
			activeDownloads.delete(this.audioId);
		}
	}
}

function getOrStartDownload(audioId, src) {
	let dl = activeDownloads.get(audioId);
	if (dl) return dl;
	dl = new Download(audioId, src);
	activeDownloads.set(audioId, dl);
	dl.run(); // fire-and-forget: decoupled from this (or any) client connection
	return dl;
}

// stream a byte slice [start, end] of `path` to the client without ending the response, honouring
// backpressure and stopping early if the client disconnected. Resolves when the slice is sent.
function streamFileSlice(res, path, start, end, isClientGone) {
	return new Promise((resolve, reject) => {
		const rs = fs.createReadStream(path, {start, end});
		let settled = false;
		const finish = (err) => {
			if (settled) return;
			settled = true;
			try {
				rs.destroy();
			} catch {
				/* okay - way better...*/
			}
			if (err) reject(err);
			else resolve();
		};
		rs.on('error', finish);
		rs.on('end', () => finish());
		rs.on('data', (chunk) => {
			if (isClientGone()) {
				finish();
				return;
			}
			if (!res.write(chunk)) {
				rs.pause();
				res.once('drain', () => {
					if (!settled) rs.resume();
				});
			}
		});
	});
}

// serve a (possibly still-downloading) file with full Range support, tailing the fill as it grows
async function serveRange(req, res, dl) {
	const total = dl.total;
	const rangeHeader = req.headers.range;
	let start = 0;
	let end = total - 1;
	let status = 200;

	if (rangeHeader) {
		const m = /^bytes=(\d+)-(\d*)/.exec(rangeHeader);
		if (m) {
			start = Number(m[1]);
			if (m[2] !== '') end = Math.min(Number(m[2]), total - 1);
			if (!Number.isFinite(start) || start < 0 || start >= total) {
				res.status(416).setHeader('Content-Range', `bytes */${total}`);
				res.end();
				return;
			}
			status = 206;
		}
	}

	res.status(status);
	res.setHeader('Content-Type', 'audio/mpeg');
	res.setHeader('Accept-Ranges', 'bytes');
	res.setHeader('Content-Length', String(end - start + 1));
	if (status === 206) res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);

	let clientGone = false;
	const isClientGone = () => clientGone;
	res.on('close', () => {
		clientGone = true;
		dl._notifyBytes();
	});

	let pos = start;
	while (pos <= end && !clientGone) {
		if (pos >= dl.downloaded && !dl.done && !dl.failed) {
			await dl.waitForBytes(pos + 1);
			continue;
		}
		if (dl.failed && pos >= dl.downloaded) break;
		const available = dl.done ? total : dl.downloaded;
		const sliceEnd = Math.min(end, available - 1);
		if (sliceEnd < pos) {
			if (dl.done || dl.failed) break;
			continue;
		}
		const path = dl.done ? dl.finalPath : dl.tempPath;
		try {
			await streamFileSlice(res, path, pos, sliceEnd, isClientGone);
		} catch {
			// the temp file was just renamed to final under us - retry the same slice from final
			if (dl.done && fs.existsSync(dl.finalPath)) continue;
			break;
		}
		pos = sliceEnd + 1;
	}
	if (!res.writableEnded) res.end();
}

async function serveFromDownload(req, res, dl) {
	await dl.ready;

	// produced by this or another writer in the meantime - sendFile handles Range/seek natively
	if (dl.done && fs.existsSync(dl.finalPath)) return serveCachedFile(res, dl.finalPath);
	if (fs.existsSync(dl.finalPath)) return serveCachedFile(res, dl.finalPath);

	if (dl.lockLost) {
		if (await waitForCachedFile(dl.finalPath, dl.audioId)) return serveCachedFile(res, dl.finalPath);
		if (!res.headersSent) res.status(502).json({detail: 'Stream failed'});
		return;
	}

	if (dl.failed) {
		if (!res.headersSent) res.status(502).json({detail: 'Stream failed'});
		return;
	}

	// un-rangeable source (no total): can't tail-with-seek, so wait for the full file then serve it
	if (dl.total == null) {
		if (await waitForCachedFile(dl.finalPath, dl.audioId)) return serveCachedFile(res, dl.finalPath);
		if (!res.headersSent) res.status(502).json({detail: 'Stream failed'});
		return;
	}

	return serveRange(req, res, dl);
}

export async function proxyStream(req, res) {
	const audioId = req.params.audio_id;
	const src = typeof req.query.src === 'string' ? req.query.src : null;
	if (!src) return res.status(400).json({detail: 'src query parameter is required'});

	const finalPath = getAudioPath(audioId);

	// cached: serve immediately with full Range/seek support
	if (fs.existsSync(finalPath)) return serveCachedFile(res, finalPath);

	// a download already running in THIS process: attach to it and serve from the growing file.
	const existing = activeDownloads.get(audioId);
	if (existing) return serveFromDownload(req, res, existing);

	// a download running in ANOTHER process (cross-process lock): we can't read its temp file, so
	// wait for the finished file and serve that (range-capable via sendFile)
	if (fs.existsSync(getAudioLockPath(audioId))) {
		if (await waitForCachedFile(finalPath, audioId)) return serveCachedFile(res, finalPath);
		return res.status(502).json({detail: 'Stream failed'});
	}

	// otherwise start a new background fill (independent of this connection) and serve from it
  // funny story: im nerd. 
	return serveFromDownload(req, res, getOrStartDownload(audioId, src));
}

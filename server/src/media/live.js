/*
 * ☆ Live HLS proxy - the CORS bridge for live streams
 * -> A YouTube live stream is an HLS (.m3u8) manifest whose playlists + segments live on
 *    *.googlevideo.com with no CORS headers, so the WebView's hls.js can't fetch them
 *    directly. This proxies both through our own origin (and token-auth), rewriting every
 *    child URL in the manifest to point back at us.
 * -> Stateless: nothing is cached. A live playlist is a sliding window - hls.js re-requests
 *    it and we just re-fetch upstream each time (Cache-Control: no-store).
 * -> SSRF guard: only *.googlevideo.com sources are fetched, so the proxy can't be aimed at
 *    internal addresses (same idea as the image host allow-list).
 */

import {bearerFrom} from '../auth/middleware.js';
import {httpError} from '../lib/http-error.js';

// a live src must resolve to a googlevideo host - yt-dlp's HLS manifests + segments all live
// there. Anything else is rejected before we make an outbound request.
function assertAllowedSrc(raw) {
	let parsed;
	try {
		parsed = new URL(raw);
	} catch {
		throw httpError(400, 'Invalid src');
	}
	if (!['http:', 'https:'].includes(parsed.protocol)) throw httpError(400, 'src not allowed');
	const host = parsed.hostname.toLowerCase();
	if (host !== 'googlevideo.com' && !host.endsWith('.googlevideo.com')) {
		throw httpError(400, 'src host not allowed');
	}
	return parsed;
}

// build one of our own proxy URLs for a child playlist/segment, carrying the same token.
function ourUrl(kind, absUrl, token) {
	const q = `src=${encodeURIComponent(absUrl)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
	return `/live/${kind}?${q}`;
}

// rewrite a bare child URI to point back through us. `kind` ('manifest' | 'segment') is
// decided by the manifest tag context, NOT the URL extension - YouTube's HLS URLs are
// extensionless (params live in the path), so a "does it end in .m3u8" guess would wrongly
// treat every variant playlist as a segment...
function rewriteChildUri(rawUri, baseUrl, token, kind) {
	let abs;
	try {
		abs = new URL(rawUri, baseUrl).toString();
	} catch {
		return rawUri; // leave anything we can't parse untouched
	}
	return ourUrl(kind, abs, token);
}

// rewrite a URI="..." attribute inside an #EXT-X tag, routed by `kind`.
function rewriteUriAttribute(line, baseUrl, token, kind) {
	return line.replace(/URI="([^"]*)"/g, (_m, uri) => {
		let abs;
		try {
			abs = new URL(uri, baseUrl).toString();
		} catch {
			return `URI="${uri}"`;
		}
		return `URI="${ourUrl(kind, abs, token)}"`;
	});
}

// rewrite the master manifest: each URI after a STREAM-INF is a variant playlist (routed
// back through /live/manifest); MEDIA/RENDITION-REPORT URIs are playlists too.
function rewriteMasterManifest(lines, baseUrl, token) {
	const out = [];
	let nextUriIsPlaylist = false;
	for (const line of lines) {
		if (line === '') {
			out.push(line);
			continue;
		}
		if (line.startsWith('#')) {
			if (/^#EXT-X-(STREAM-INF|I-FRAME-STREAM-INF)/i.test(line)) nextUriIsPlaylist = true;
			if (
				/^#EXT-X-(MAP|KEY|MEDIA|I-FRAME-STREAM-INF|PART|PRELOAD-HINT|RENDITION-REPORT)/i.test(line) &&
				/URI="/.test(line)
			) {
				const attrKind = /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT)/i.test(line)
					? 'manifest'
					: 'segment';
				out.push(rewriteUriAttribute(line, baseUrl, token, attrKind));
			} else {
				out.push(line);
			}
			continue;
		}
		out.push(rewriteChildUri(line, baseUrl, token, nextUriIsPlaylist ? 'manifest' : 'segment'));
		nextUriIsPlaylist = false;
	}
	return out.join('\n');
}

// how many trailing segments of a DVR playlist to keep. a 24/7 YouTube live stream is served
// as a DVR window (the synthwave radio gave 2880 segments / 3.4 MB!)
//  keep only the live edge, which is all hls.js needs to play "now".
const LIVE_EDGE_SEGMENTS = 24;

// rewrite + TRIM a media playlist down to the last LIVE_EDGE_SEGMENTS segments. Bump
// #EXT-X-MEDIA-SEQUENCE by the number of dropped segments so hls.js still sees a consistent,
// monotonically-advancing sliding window across refreshes.

// in a non-nerd way: we're just keeping the last 24 segments of a live stream,
// so the player can play the most recent part of the stream without downloading the entire history
function rewriteMediaPlaylist(lines, baseUrl, token) {
	const firstSeg = lines.findIndex((l) => /^#EXTINF/i.test(l));
	if (firstSeg < 0) return null; // no segments — not a media playlist
	const header = lines.slice(0, firstSeg);
	const body = lines.slice(firstSeg);

	// group the body into one block per segment (an #EXTINF line plus any per-segment tags,
	// up to and including the segment URL line).
	const blocks = [];
	let cur = null;
	for (const line of body) {
		if (/^#EXTINF/i.test(line)) {
			if (cur) blocks.push(cur);
			cur = [line];
		} else if (cur) {
			cur.push(line);
		}
	}
	if (cur) blocks.push(cur);

	const dropped = Math.max(0, blocks.length - LIVE_EDGE_SEGMENTS);
	const kept = blocks.slice(dropped);

	// header: rewrite any MAP/KEY URI, and advance MEDIA-SEQUENCE past the dropped segments
	let sawSeq = false;
	const outHeader = header.map((line) => {
		const seq = line.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/i);
		if (seq) {
			sawSeq = true;
			return `#EXT-X-MEDIA-SEQUENCE:${Number(seq[1]) + dropped}`;
		}
		if (/^#EXT-X-(MAP|KEY)/i.test(line) && /URI="/.test(line))
			return rewriteUriAttribute(line, baseUrl, token, 'segment');
		return line;
	});
	if (!sawSeq && dropped > 0) outHeader.push(`#EXT-X-MEDIA-SEQUENCE:${dropped}`);

	const outBody = [];
	for (const block of kept) {
		for (const line of block) {
			if (line === '') {
				outBody.push(line);
				continue;
			}
			if (line.startsWith('#')) {
				if (/^#EXT-X-(MAP|KEY|PART|PRELOAD-HINT)/i.test(line) && /URI="/.test(line)) {
					outBody.push(rewriteUriAttribute(line, baseUrl, token, 'segment'));
				} else {
					outBody.push(line);
				}
			} else {
				outBody.push(rewriteChildUri(line, baseUrl, token, 'segment'));
			}
		}
	}
	return [...outHeader, ...outBody].join('\n');
}

function rewriteManifest(text, baseUrl, token) {
	const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
	// master manifest lists renditions via STREAM-INF; a media playlist lists segments via EXTINF.
	// in a non-nerd way: if the manifest has any EXTINF lines, it's a media playlist; otherwise it's a master playlist.
	const isMaster = lines.some((l) => /^#EXT-X-STREAM-INF/i.test(l));
	if (isMaster) return rewriteMasterManifest(lines, baseUrl, token);
	const media = rewriteMediaPlaylist(lines, baseUrl, token);
	// fall back to the master rewriter if it somehow had neither (shouldn't happen.. but just in case)
	return media != null ? media : rewriteMasterManifest(lines, baseUrl, token);
}

export async function handleLiveManifest(req, res) {
	const src = typeof req.query.src === 'string' ? req.query.src : '';
	if (!src) throw httpError(400, 'src query parameter is required');
	assertAllowedSrc(src);
	const token = bearerFrom(req) || '';

	let upstream;
	try {
		upstream = await fetch(src, {redirect: 'follow'});
	} catch (err) {
		throw httpError(502, `Live manifest fetch failed: ${err.message}`);
	}
	if (!upstream.ok) throw httpError(502, `Live manifest upstream ${upstream.status}`);

	// resolve child URIs against the *final* URL (after redirects) so relative paths are right
	const baseUrl = upstream.url || src;
	const text = await upstream.text();
	const rewritten = rewriteManifest(text, baseUrl, token);

	res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
	res.setHeader('Cache-Control', 'no-store');
	res.send(rewritten);
}

export async function handleLiveSegment(req, res) {
	const src = typeof req.query.src === 'string' ? req.query.src : '';
	if (!src) throw httpError(400, 'src query parameter is required');
	assertAllowedSrc(src);

	let clientGone = false;
	const controller = new AbortController();
	res.on('close', () => {
		clientGone = true;
		controller.abort();
	});

	let upstream;
	try {
		upstream = await fetch(src, {redirect: 'follow', signal: controller.signal});
	} catch (err) {
		if (clientGone) return;
		throw httpError(502, `Live segment fetch failed: ${err.message}`);
	}
	if (!upstream.ok) throw httpError(502, `Live segment upstream ${upstream.status}`);

	res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp2t');
	res.setHeader('Cache-Control', 'no-store');
	try {
		for await (const chunk of upstream.body) {
			if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
		}
	} catch (err) {
		if (!clientGone) throw err;
	} finally {
		res.end();
	}
}

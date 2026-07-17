/*
 * ☆ Image host allow-list (SSRF guard)
 * -> /cache/image will only fetch from these hosts, so the proxy can't be pointed at
 *    internal addresses. Same set as the old server.
 */

export const IMAGE_ALLOWED_HOSTS = new Set([
	'i.ytimg.com',
	'yt3.ggpht.com',
	'yt3.googleusercontent.com',
	'lh3.googleusercontent.com',
	'music.youtube.com',
	'i.scdn.co',
	'cdn.discordapp.com',
	'media.discordapp.net',
]);

// cached images are content-addressed, so their bytes never change for a path - let the
// client/webview cache them for a week and stop re-requesting thumbnails on every render.
export const IMAGE_CACHE_HEADERS = {'Cache-Control': 'public, max-age=604800, immutable'}; // 7 days

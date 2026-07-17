/*
 * ☆ Request log
 * -> one line per request, just [ip] /path, so a running server actually shows life
 * -> deliberately just the path, never the query string or body, so search terms,
 *    lyrics lookups, whatever someone's playing - none of that ends up in the log
 * -> a chatty client (the app polling /mix or /stats back to back) collapses into one
 *    "[ip] /mix (3x)" line instead of flooding the console with repeats
 */

const FLUSH_IDLE_MS = 800;

let pending = null; // { key, line, count }
let flushTimer = null;

function flush() {
	if (!pending) return;
	console.log(pending.count > 1 ? `${pending.line} (${pending.count}x)` : pending.line);
	pending = null;
	clearTimeout(flushTimer);
	flushTimer = null;
}

export function requestLog(req, res, next) {
	const line = `[${req.ip}] ${req.path}`;
	const key = `${req.ip} ${req.path}`;

	if (pending && pending.key === key) {
		pending.count += 1;
	} else {
		flush();
		pending = { key, line, count: 1 };
	}

	// no more of the same coming right now? print what we've got so a streak never
	// sits buffered and invisible once the client moves on to something else
	clearTimeout(flushTimer);
	flushTimer = setTimeout(flush, FLUSH_IDLE_MS);
	flushTimer.unref(); // never the reason the process stays alive

	next();
}

"""
☆ Starl resolver worker
-> a small, always-on localhost JSON service the Node brain calls for the two jobs that
   genuinely need Python: yt-dlp resolution/download and ytmusicapi lookups.
-> warm interpreter + warm YTMusic client = no per-call cold start. ThreadingHTTPServer
   handles requests concurrently; two bounded pools keep a backlog of resolves from
   stalling a freshly typed search (mirrors the old main.py executor split).
-> endpoints (all JSON):
     GET  /health
     POST /resolve         {url, quality}            -> {direct_url, video_id, title, ...}
     POST /download        {url, quality, out_path}  -> {ok, path, title, ...}
     POST /search          {query, limit, kind, offset} -> {items, has_more}
     POST /artist/resolve  {name}                     -> {combined, artists, unresolved}
     GET  /artist          ?name= | ?channel_id=     -> artist dict
     GET  /artist/songs     ?channel_id=&params=      -> {tracks}
     GET  /album            ?id=                       -> album dict
     GET  /playlist         ?id=  (id or pasted URL)   -> {id, title, author, tracks}
     GET  /spotify/playlist ?id=  (id or pasted URL)   -> {id, title, tracks:[{title,artist}]}
     POST /match            {queries:[{title,artist}]} -> {matches:[ytTrack|null]}
"""

from __future__ import annotations

import json
import logging
import sys
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# Flat imports — the worker dir is sys.path[0] when run as `python worker/worker.py`.
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))

import music
import resolver
import spotify
from config import WORKER_PORT

logging.basicConfig(level=logging.INFO, format="%(asctime)s [worker] %(message)s")
log = logging.getLogger("starl.worker")

# Pool for yt-dlp resolve/download (network-bound, releases the GIL while waiting).
_resolve_pool = ThreadPoolExecutor(max_workers=12, thread_name_prefix="resolve")
# Separate pool for ytmusic lookups so a resolve backlog can't queue ahead of a search.
_lookup_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="lookup")


def _run(pool: ThreadPoolExecutor, fn, *args):
    """Run a blocking job on a bounded pool and wait for it (keeps each request handler
    thread from doing heavy work inline, so the pool bounds real concurrency)."""
    return pool.submit(fn, *args).result()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ----- helpers -----
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionError, BrokenPipeError, OSError):
            # Node already hung up (request timed out / client aborted). There's nobody
            # left to answer, so swallow it instead of dumping a socket traceback - and
            # mark the connection closed so the request handler stops cleanly.
            self.close_connection = True

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, OSError):
            return {}

    def log_message(self, fmt, *args):  # quieter default logging
        return

    # ----- routes -----
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        q = parse_qs(parsed.query)
        try:
            if path == "/health":
                return self._send(200, {"status": "ok"})
            if path == "/artist":
                name = (q.get("name") or [""])[0].strip()
                channel_id = (q.get("channel_id") or [""])[0].strip()
                if channel_id:
                    return self._send(200, _run(_lookup_pool, music.get_artist_by_channel_id, channel_id))
                if name:
                    return self._send(200, _run(_lookup_pool, music.search_artist_details, name))
                return self._send(400, {"error": "name or channel_id required"})
            if path == "/artist/songs":
                channel_id = (q.get("channel_id") or [""])[0].strip()
                params = (q.get("params") or [""])[0].strip()
                if not channel_id or not params:
                    return self._send(400, {"error": "channel_id and params required"})
                tracks = _run(_lookup_pool, music.get_artist_songs_page, channel_id, params)
                return self._send(200, {"tracks": tracks})
            if path == "/album":
                album_id = (q.get("id") or [""])[0].strip()
                if not album_id:
                    return self._send(400, {"error": "id required"})
                return self._send(200, _run(_lookup_pool, music.fetch_album_tracks, album_id))
            if path == "/radio":
                video_id = (q.get("video_id") or [""])[0].strip()
                if not video_id:
                    return self._send(400, {"error": "video_id required"})
                limit = int((q.get("limit") or ["40"])[0] or 40)
                tracks = _run(_lookup_pool, music.get_radio, video_id, limit)
                return self._send(200, {"tracks": tracks})
            if path == "/playlist":
                ref = (q.get("id") or [""])[0].strip()
                if not ref:
                    return self._send(400, {"error": "id or url required"})
                return self._send(200, _run(_lookup_pool, music.fetch_playlist_tracks, ref))
            if path == "/spotify/playlist":
                ref = (q.get("id") or [""])[0].strip()
                if not ref:
                    return self._send(400, {"error": "id or url required"})
                return self._send(200, _run(_lookup_pool, spotify.scrape_playlist, ref))
            return self._send(404, {"error": "not found"})
        except Exception as exc:  # surface as a 502-ish error for Node to translate
            log.exception("GET %s failed", path)
            return self._send(502, {"error": str(exc)})

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._read_json()
        try:
            if path == "/resolve":
                return self._send(200, _run(_resolve_pool, resolver.resolve,
                                            body.get("url", ""), body.get("quality", "best")))
            if path == "/download":
                out_path = body.get("out_path", "")
                if not out_path:
                    return self._send(400, {"error": "out_path required"})
                return self._send(200, _run(_resolve_pool, resolver.download,
                                            body.get("url", ""), body.get("quality", "best"), out_path))
            if path == "/search":
                items, has_more = _run(
                    _lookup_pool, music.search_youtube,
                    body.get("query", ""), int(body.get("limit") or 32),
                    body.get("kind", "all"), int(body.get("offset") or 0),
                )
                return self._send(200, {"items": items, "has_more": has_more})
            if path == "/artist/resolve":
                name = (body.get("name") or "").strip()
                if not name:
                    return self._send(400, {"error": "name required"})
                return self._send(200, _run(_lookup_pool, music.resolve_artists, name))
            if path == "/match":
                queries = body.get("queries") or []
                if not isinstance(queries, list):
                    return self._send(400, {"error": "queries must be a list"})
                matches = _run(_lookup_pool, music.match_tracks, queries[:60])
                return self._send(200, {"matches": matches})
            return self._send(404, {"error": "not found"})
        except Exception as exc:
            log.exception("POST %s failed", path)
            return self._send(502, {"error": str(exc)})


def _ytm_sweep_loop() -> None:
    """Reap expired ytm cache files every 10 minutes (the worker owns this cache)."""
    import threading
    import time

    def loop():
        while True:
            time.sleep(600)
            try:
                removed = music.sweep_ytm_cache()
                if removed:
                    log.info("ytm cache sweep removed %d expired file(s)", removed)
            except Exception:
                log.exception("ytm cache sweep failed")

    t = threading.Thread(target=loop, daemon=True)
    t.start()


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", WORKER_PORT), Handler)
    server.daemon_threads = True
    _ytm_sweep_loop()
    log.info("resolver worker listening on http://127.0.0.1:%d", WORKER_PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()

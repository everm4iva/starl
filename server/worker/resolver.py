"""
☆ yt-dlp resolver
-> resolve(): extract a single direct CDN audio URL + metadata WITHOUT downloading, so
   the Node brain can proxy the bytes straight to the client (the fast path).
-> download(): the rare fallback when no direct URL exists (DASH/HLS only) — run the full
   yt-dlp + ffmpeg extraction into a path Node hands us. Node owns the cache id, locking,
   and sidecar/status writes; this module just produces the mp3 and reports metadata.
-> lifted from the old downloads.py; caching/prewarm/locking stripped out (Node's job).
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path

from yt_dlp import YoutubeDL

from config import YTDLP_COOKIES_FILE, YTDLP_COOKIES_FROM_BROWSER, FFMPEG_LOCATION

log = logging.getLogger("starl.worker")

# yt-dlp appends the current minute to a live broadcast's title (e.g.
# "synthwave radio 🌌 beats to chill/game to 2026-06-26 16:59"). Strip that trailing
# " YYYY-MM-DD HH:MM[:SS]" so the player shows a stable station name, not a clock.
_LIVE_TITLE_TS_RE = re.compile(r"\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s*$")


def _clean_live_title(title: str) -> str:
    return _LIVE_TITLE_TS_RE.sub("", title or "").strip()

QUALITY_MAP = {
    "low": "worstaudio",
    "medium": "bestaudio[abr<=128]/bestaudio",
    "high": "bestaudio[abr<=256]/bestaudio",
    "best": "bestaudio",
}

# Selectors for resolve() (download=False): must resolve to a single direct HTTP(S) URL —
# no DASH/HLS manifests, no adaptive formats yt-dlp can't expose as a plain URL.
# The trailing "/best" (or "/worst") is a live-stream safety net: a live broadcast often
# exposes ONLY muxed HLS renditions (no audio-only format), so every "bestaudio" selector
# misses and yt-dlp would raise "Requested format is not available". The muxed fallback lets
# extraction succeed; for live we then use the HLS master manifest (see resolve()) rather than
# the selected format. For normal tracks the audio selectors always match first, so it's a no-op.
_DIRECT_FORMAT_MAP = {
    "low": "worstaudio[protocol=https][vcodec=none]/worstaudio[protocol=http][vcodec=none]/worstaudio[vcodec=none]/worstaudio/worst",
    "medium": "bestaudio[protocol=https][vcodec=none][abr<=128]/bestaudio[protocol=http][vcodec=none][abr<=128]/bestaudio[vcodec=none][abr<=128]/bestaudio[protocol=https][vcodec=none]/bestaudio[vcodec=none]/bestaudio/best",
    "high": "bestaudio[protocol=https][vcodec=none][abr<=256]/bestaudio[protocol=http][vcodec=none][abr<=256]/bestaudio[vcodec=none][abr<=256]/bestaudio[protocol=https][vcodec=none]/bestaudio[vcodec=none]/bestaudio/best",
    "best": "bestaudio[protocol=https][vcodec=none]/bestaudio[protocol=http][vcodec=none]/bestaudio[vcodec=none]/bestaudio/best",
}


@contextmanager
def _ydl_base_opts():
    """yt-dlp options for cookies + JS challenge solving (node runtime enabled — yt-dlp's
    default only has deno, which is rarely installed).

    yt-dlp rewrites its `cookiefile` on *every* YoutubeDL exit (save_cookies -> jar.save()),
    and that save is a truncate-in-place, not an atomic temp+rename. We run several YoutubeDL
    instances concurrently in a thread pool, so pointing them all at the shared cookies.txt
    races: while one instance is mid-save the file is momentarily empty, and another instance
    loading it reads a blank first line -> "does not look like a Netscape format cookies file".
    So hand each call a PRIVATE throwaway copy of the cookie file; saves hit the copy and the
    master is never written. Use as a context manager so the copy is cleaned up after use."""
    opts: dict = {"js_runtimes": {"node": {}, "deno": {}}}
    tmp_cookies: str | None = None
    try:
        if YTDLP_COOKIES_FILE and Path(YTDLP_COOKIES_FILE).exists():
            fd, tmp_cookies = tempfile.mkstemp(prefix="ytdlp-cookies-", suffix=".txt")
            os.close(fd)
            shutil.copyfile(YTDLP_COOKIES_FILE, tmp_cookies)
            opts["cookiefile"] = tmp_cookies
        elif YTDLP_COOKIES_FROM_BROWSER:
            opts["cookiesfrombrowser"] = (YTDLP_COOKIES_FROM_BROWSER,)
        yield opts
    finally:
        if tmp_cookies:
            try:
                os.remove(tmp_cookies)
            except OSError:
                pass


def _resolve_ffmpeg_location(raw_value: str | None) -> Path | None:
    if not raw_value:
        return None
    trimmed = raw_value.strip().strip('"').strip("'")
    candidates = [trimmed]
    collapsed = "".join(trimmed.split())
    if collapsed and collapsed not in candidates:
        candidates.append(collapsed)
    for candidate in candidates:
        if not candidate:
            continue
        p = Path(candidate)
        if p.exists():
            return p
        if p.suffix.lower() not in {".exe", ".bat", ".cmd"}:
            for exe in ("ffmpeg.exe", "ffmpeg"):
                if (p / exe).exists():
                    return p / exe
    return None


def _direct_url_from_info(info: dict) -> str:
    direct_url = info.get("url") or ""
    if not direct_url:
        for fmt in (info.get("requested_formats") or []):
            if fmt.get("url") and fmt.get("vcodec") in (None, "none"):
                direct_url = fmt["url"]
                break
        if not direct_url:
            for fmt in (info.get("requested_formats") or []):
                if fmt.get("url"):
                    direct_url = fmt["url"]
                    break
    if not direct_url:
        formats = info.get("formats") or []
        audio = [f for f in formats if f.get("url") and f.get("vcodec") in (None, "none")]
        if not audio:
            audio = [f for f in formats if f.get("url")]
        if audio:
            audio.sort(key=lambda f: f.get("abr") or f.get("tbr") or 0, reverse=True)
            direct_url = audio[0].get("url") or ""
    return direct_url


def resolve(url: str, quality: str) -> dict:
    """Resolve a direct CDN stream URL + metadata via yt-dlp (no download)."""
    direct_format = _DIRECT_FORMAT_MAP.get(quality, _DIRECT_FORMAT_MAP["best"])
    with _ydl_base_opts() as base_opts:
        ydl_opts = {
            "format": direct_format,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            **base_opts,
        }
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

    # A live stream has no audio-only format, so the selected format is a muxed HLS rendition.
    # Use the *master* HLS manifest (manifest_url) instead — it lists every rendition, so the
    # client's hls.js can lock onto the lowest one (audio is identical across them). Flag it so
    # Node routes to the live proxy instead of the byte-caching /proxy path, and null the
    # duration (yt-dlp reports a bogus elapsed value for a live edge).
    is_live = bool(info.get("is_live"))
    if is_live:
        direct_url = info.get("manifest_url") or _direct_url_from_info(info)
    else:
        direct_url = _direct_url_from_info(info)
    if not direct_url:
        log.warning("resolve: no direct URL for %s — Node should fall back to download", url)
    title = info.get("title") or ""
    if is_live:
        title = _clean_live_title(title)
    return {
        "direct_url": direct_url,
        "video_id": info.get("id") or "",
        "title": title,
        "artist": info.get("artist") or info.get("uploader") or "",
        "duration": None if is_live else info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "is_live": is_live,
    }


def extract_playlist(url: str) -> dict:
    """Flat-extract a YouTube playlist's entries WITHOUT resolving each track (fast).
    Used as the fallback when ytmusicapi can't read a plain YouTube playlist.
    Returns {title, author, thumbnail, tracks:[{id,title,url,thumbnail,artist,duration}]}."""
    with _ydl_base_opts() as base_opts:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": "in_playlist",
            "skip_download": True,
            **base_opts,
        }
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    if not info:
        return {"error": "Playlist could not be read"}

    tracks = []
    for entry in (info.get("entries") or []):
        if not entry:
            continue
        video_id = entry.get("id") or ""
        if not video_id:
            continue
        thumbs = entry.get("thumbnails") or []
        tracks.append({
            "id": video_id,
            "title": entry.get("title") or "",
            "url": f"https://music.youtube.com/watch?v={video_id}",
            "thumbnail": (thumbs[-1].get("url") if thumbs else None) or entry.get("thumbnail"),
            "artist": entry.get("uploader") or entry.get("channel") or "",
            "album": None,
            "duration": entry.get("duration"),
            "kind": "music",
        })
    return {
        "title": info.get("title") or "",
        "author": info.get("uploader") or info.get("channel") or "",
        "thumbnail": info.get("thumbnail"),
        "tracks": tracks,
    }


def _ffmpeg_opts(ydl_opts: dict) -> None:
    ffmpeg_found = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
    if FFMPEG_LOCATION:
        path = _resolve_ffmpeg_location(FFMPEG_LOCATION)
        if path:
            ydl_opts["ffmpeg_location"] = str(path)
        elif not ffmpeg_found:
            raise RuntimeError(f"ffmpeg location does not exist: '{FFMPEG_LOCATION}'")
    elif not ffmpeg_found:
        raise RuntimeError("ffmpeg/ffprobe not found. Install ffmpeg or set FFMPEG_LOCATION.")


def download(url: str, quality: str, out_path: str) -> dict:
    """Full fallback: download + extract mp3 to out_path. Returns metadata for Node to
    write into the sidecar. Caller (Node) already holds the per-track lock."""
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    selected_quality = QUALITY_MAP.get(quality, QUALITY_MAP["best"])
    with _ydl_base_opts() as base_opts:
        ydl_opts = {
            "format": selected_quality,
            "outtmpl": str(out.with_suffix("")),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "continuedl": False,
            "nopart": True,
            **base_opts,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        }
        _ffmpeg_opts(ydl_opts)

        # Remove leftover partials that could make yt-dlp resume with a Range request.
        prefix_name = out.with_suffix("").name
        for p in out.parent.glob(prefix_name + "*"):
            try:
                if p.is_file() and p.resolve() != out.resolve():
                    p.unlink()
            except OSError:
                pass

        try:
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
        except Exception as exc:
            msg = str(exc or "")
            if "Requested range" in msg or "416" in msg:
                retry = dict(ydl_opts, http_chunk_size=0)
                with YoutubeDL(retry) as ydl:
                    info = ydl.extract_info(url, download=True)
            else:
                raise

    mp3_path = out if out.exists() else Path(f"{out}.mp3")
    return {
        "ok": mp3_path.exists(),
        "path": str(mp3_path),
        "video_id": info.get("id") or "",
        "title": info.get("title") or "",
        "artist": info.get("artist") or info.get("uploader") or "",
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
    }

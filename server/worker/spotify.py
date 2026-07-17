"""
☆ Spotify playlist scraper (no-auth)
-> reads a PUBLIC Spotify playlist's track list straight from the open.spotify.com embed
   page (the __NEXT_DATA__ JSON blob), so no Spotify app / client credentials are needed.
-> we only get titles + artists from here; Starl can't play Spotify audio (DRM), so the
   Node/client side matches each track to a YouTube/YTMusic song (see music.match_tracks).
-> fragile by nature: if Spotify changes their embed markup this returns {"error": ...}
   and the import surfaces a clean failure rather than crashing.
"""

from __future__ import annotations

import json
import re

import requests  # already a ytmusicapi dependency; bundles certifi for proper TLS verify

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S
)


def _extract_id(value: str) -> str:
    """Pull a 22-char base62 playlist id out of a URL, spotify: URI, or bare id."""
    v = (value or "").strip()
    m = re.search(r"playlist[/:]([A-Za-z0-9]{22})", v)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9]{22}", v):
        return v
    return ""


def _find_track_list(obj):
    """Depth-first search for the first dict that carries a 'trackList' list; return
    (track_list, owning_dict) so we can also read the playlist name/cover off it."""
    if isinstance(obj, dict):
        tl = obj.get("trackList")
        if isinstance(tl, list):
            return tl, obj
        for value in obj.values():
            found = _find_track_list(value)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = _find_track_list(value)
            if found:
                return found
    return None


def scrape_playlist(id_or_url: str) -> dict:
    """Return {id, title, author, thumbnail, tracks:[{title, artist, duration}]} for a
    public Spotify playlist, or {error}. Tracks are NOT yet matched to YouTube."""
    playlist_id = _extract_id(id_or_url)
    if not playlist_id:
        return {"error": "That doesn't look like a Spotify playlist link"}

    url = f"https://open.spotify.com/embed/playlist/{playlist_id}"
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": _UA, "Accept-Language": "en"},
            timeout=20,
        )
        resp.raise_for_status()
        html = resp.text
    except Exception as exc:  # network / 404 / blocked
        return {"error": f"Could not reach Spotify ({exc})"}

    match = _NEXT_DATA_RE.search(html)
    if not match:
        return {"error": "Could not read this playlist — it may be private or region-locked"}
    try:
        data = json.loads(match.group(1))
    except ValueError:
        return {"error": "Spotify returned unexpected data"}

    found = _find_track_list(data)
    if not found:
        return {"error": "No tracks found in this Spotify playlist"}
    track_list, entity = found

    tracks = []
    for item in track_list:
        if not isinstance(item, dict):
            continue
        title = (item.get("title") or "").strip()
        if not title:
            continue
        artist = (item.get("subtitle") or "").strip()
        duration_ms = item.get("duration") or 0
        try:
            duration = int(int(duration_ms) / 1000) if duration_ms else 0
        except (TypeError, ValueError):
            duration = 0
        tracks.append({"title": title, "artist": artist, "duration": duration})

    cover = None
    cover_art = entity.get("coverArt")
    if isinstance(cover_art, dict):
        sources = cover_art.get("sources")
        if isinstance(sources, list) and sources:
            cover = sources[-1].get("url")

    return {
        "id": playlist_id,
        "url": f"https://open.spotify.com/playlist/{playlist_id}",
        "title": entity.get("name") or entity.get("title") or "Spotify playlist",
        "author": entity.get("subtitle") or "",
        "thumbnail": cover,
        "tracks": tracks,
    }

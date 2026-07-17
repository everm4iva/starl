"""
☆ Music lookups (ytmusicapi)
-> search / artist / artist-songs / album, with a warm shared YTMusic client and a disk
   TTL cache so repeated lookups don't hit the API. Lifted from the old downloads.py.
-> the per-user click re-ranking and ranked-result cache live in the Node brain (it owns
   user state); this module returns the raw, fuzzy-filtered results.
"""

from __future__ import annotations

import difflib
import re
import threading
from concurrent.futures import ThreadPoolExecutor

from ytmusicapi import YTMusic

import search_enhance
from config import YTM_CACHE_DIR
from store import TtlFileCache


def _patch_ytmusicapi_album_header() -> None:
    """Resilience patch for ytmusicapi 1.7.0's album header parser.

    Some albums credit a collaborative artist as plain text (e.g. "A & B") whose
    header run carries no navigationEndpoint. parse_base_header assumes every artist
    run has a browseId and does an intolerant lookup, so get_album() raises KeyError
    and the whole album request 502s. We swap in an identical parser that only makes
    that one lookup tolerant (none_if_absent -> id becomes None), matching how the
    library already treats its other optional fields. albums.py imported the function
    by value, so patch its binding too, not just podcasts'.
    """
    from ytmusicapi.navigation import nav, RUN_TEXT, NAVIGATION_BROWSE_ID, TITLE_TEXT
    from ytmusicapi.parsers import podcasts as _podcasts, albums as _albums

    def parse_base_header(header):
        strapline = nav(header, ["straplineTextOne"])
        return {
            "author": {
                "name": nav(strapline, [*RUN_TEXT]),
                # tolerate a missing browseId (plain-text collaborative artist)
                "id": nav(strapline, ["runs", 0, *NAVIGATION_BROWSE_ID], True),
            },
            "title": nav(header, TITLE_TEXT),
        }

    _podcasts.parse_base_header = parse_base_header
    _albums.parse_base_header = parse_base_header


_patch_ytmusicapi_album_header()

_ARTIST_TTL = 1800   # 30 min
_ALBUM_TTL = 3600    # 60 min
_SEARCH_TTL = 300    # 5 min — searches go stale faster than artist/album pages
_PLAYLIST_TTL = 1800  # 30 min — imported playlists are resolved once, then cached
_RADIO_TTL = 600     # 10 min — a song's radio pool is stable enough to cache briefly


def _ytm_namespace(key: str) -> str:
    return key.split(":", 1)[0] or "misc"


_ytm_cache = TtlFileCache(YTM_CACHE_DIR, namespacer=_ytm_namespace)


def _ytm_cache_get(key: str):
    return _ytm_cache.get(key)


def _ytm_cache_set(key: str, payload, ttl: float) -> None:
    _ytm_cache.set(key, payload, ttl)


def sweep_ytm_cache() -> int:
    return _ytm_cache.sweep_expired()


# Warm, shared, thread-safe (read-only after init) YTMusic client — building one per call
# was a real latency source (three per "all" search). Built lazily under a lock.
_ytmusic_client: "YTMusic | None" = None
_ytmusic_client_lock = threading.Lock()


def _get_ytmusic() -> YTMusic:
    global _ytmusic_client
    if _ytmusic_client is None:
        with _ytmusic_client_lock:
            if _ytmusic_client is None:
                _ytmusic_client = YTMusic()
    return _ytmusic_client


# ----------------------  helpers ----------------------

def _parse_duration(text: str | None) -> int | None:
    if not text:
        return None
    parts = text.strip().split(":")
    if len(parts) < 2:
        return None
    try:
        numbers = [int(part) for part in parts]
    except ValueError:
        return None
    total = 0
    for value in numbers:
        total = total * 60 + value
    return total


def _pick_thumbnail(entry: dict) -> str | None:
    thumbnail = entry.get("thumbnail")
    if isinstance(thumbnail, str) and thumbnail:
        return thumbnail
    # watch playlists (radio) put a LIST of {url,...} under "thumbnail", while search/
    # artist results use "thumbnails" — handle both, biggest (last) first.
    thumb_list = thumbnail if isinstance(thumbnail, list) else (entry.get("thumbnails") or [])
    for candidate in reversed(thumb_list):
        url = candidate.get("url") if isinstance(candidate, dict) else None
        if url:
            return url
    return None


def _query_words(query: str) -> list[str]:
    collapsed = search_enhance._collapse_spaced_letters(query.lower())
    return list(dict.fromkeys(w for w in collapsed.split() if len(w) > 1))


def _spaced_letter_query(query: str) -> str | None:
    q = query.strip().lower()
    if " " in q or len(q) < 3:
        return None
    return " ".join(q)


# ----------------------  search ----------------------

def search_youtube_music(query: str, limit: int) -> list[dict]:
    safe_limit = max(1, min(limit, 60))
    ytmusic = _get_ytmusic()
    results = ytmusic.search(query, filter="songs", limit=safe_limit) or []
    items = []
    for entry in results:
        video_id = entry.get("videoId") or ""
        if not video_id:
            continue
        artists = entry.get("artists") or []
        artist_name = artists[0].get("name") if artists else None
        duration = entry.get("duration_seconds")
        if duration is None:
            duration = _parse_duration(entry.get("duration"))
        items.append({
            "id": video_id,
            "title": entry.get("title") or "",
            "url": f"https://music.youtube.com/watch?v={video_id}",
            "thumbnail": _pick_thumbnail(entry),
            "artist": artist_name,
            "duration": duration,
            "kind": "music",
        })
    return items


def _search_artists_ytm(query: str, limit: int) -> list[dict]:
    ytmusic = _get_ytmusic()
    results = ytmusic.search(query, filter="artists", limit=limit) or []
    items = []
    for entry in results:
        channel_id = entry.get("browseId") or entry.get("channelId") or ""
        if not channel_id:
            continue
        thumbnails = entry.get("thumbnails") or []
        items.append({
            "id": channel_id,
            "title": entry.get("artist") or entry.get("name") or "",
            "url": f"https://music.youtube.com/channel/{channel_id}",
            "thumbnail": thumbnails[-1].get("url") if thumbnails else None,
            "artist": None,
            "duration": None,
            "kind": "channel",
        })
    return items


def _search_community_playlists_ytm(query: str, limit: int) -> list[dict]:
    """Real YouTube Music community playlists (the ones users make), for the
    'Playlists' search pill and the import-by-search flow."""
    ytmusic = _get_ytmusic()
    results = ytmusic.search(query, filter="community_playlists", limit=limit) or []
    items = []
    for entry in results:
        browse_id = entry.get("browseId") or entry.get("playlistId") or ""
        if not browse_id:
            continue
        thumbnails = entry.get("thumbnails") or []
        author = entry.get("author")
        if isinstance(author, list):
            author = author[0].get("name") if author else None
        elif isinstance(author, dict):
            author = author.get("name")
        list_id = browse_id[2:] if browse_id.startswith("VL") else browse_id
        items.append({
            "id": browse_id,
            "title": entry.get("title") or "",
            "url": f"https://music.youtube.com/playlist?list={list_id}",
            "thumbnail": thumbnails[-1].get("url") if thumbnails else None,
            "artist": author or None,
            # ytmusicapi's "itemCount" is the play/view count string (e.g. "91K") for
            # community playlists, NOT the number of songs — keep that name honest.
            "views": entry.get("itemCount") or None,
            "duration": None,
            "kind": "community_playlist",
        })
    return items


def _search_albums_ytm(query: str, limit: int) -> list[dict]:
    ytmusic = _get_ytmusic()
    results = ytmusic.search(query, filter="albums", limit=limit) or []
    items = []
    for entry in results:
        browse_id = entry.get("browseId") or ""
        if not browse_id:
            continue
        artists = entry.get("artists") or []
        thumbnails = entry.get("thumbnails") or []
        items.append({
            "id": browse_id,
            "title": entry.get("title") or "",
            "url": f"https://music.youtube.com/browse/{browse_id}",
            "thumbnail": thumbnails[-1].get("url") if thumbnails else None,
            "artist": artists[0].get("name") if artists else None,
            "duration": None,
            "kind": "playlist",
        })
    return items


_search_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="ytm-search")


def _fetch_by_kind(kind: str, query: str, fetch_limit: int) -> list[dict]:
    if kind == "music":
        return search_youtube_music(query, fetch_limit)
    if kind == "channels":
        return _search_artists_ytm(query, fetch_limit)
    if kind == "playlists":
        return _search_albums_ytm(query, fetch_limit)
    if kind == "community":
        return _search_community_playlists_ytm(query, fetch_limit)
    per = max(3, fetch_limit // 3)
    futures = [
        _search_pool.submit(search_youtube_music, query, per),
        _search_pool.submit(_search_artists_ytm, query, per),
        _search_pool.submit(_search_albums_ytm, query, per),
    ]
    music, artists, albums = (f.result() for f in futures)
    return (music + artists + albums)[:fetch_limit]


def search_youtube(query: str, limit: int, kind: str | None = "all", offset: int = 0) -> tuple[list[dict], bool]:
    fetch_limit = max(1, min(offset + limit, 40))
    normalized_kind = (kind or "all").lower()

    cache_key = f"search:{normalized_kind}:{query.strip().lower()}:{fetch_limit}"
    cached = _ytm_cache_get(cache_key)
    if cached is not None:
        all_items: list[dict] = cached  # type: ignore[assignment]
    else:
        all_items = _fetch_by_kind(normalized_kind, query, fetch_limit)

        words = _query_words(query)
        if words:
            all_items = [it for it in all_items if search_enhance.score_fuzzy(it, words) > 0]
        search_enhance.index_results(all_items)

        # Corrected-query retry when fuzzy filtering left nothing.
        if not all_items:
            corrected = search_enhance.suggest_query(query)
            if corrected and corrected != query.strip().lower():
                corrected_key = f"search:{normalized_kind}:{corrected}:{fetch_limit}"
                all_items = _ytm_cache_get(corrected_key) or []
                if not all_items:
                    all_items = _fetch_by_kind(normalized_kind, corrected, fetch_limit)
                    search_enhance.index_results(all_items)
                    _ytm_cache_set(corrected_key, all_items, _SEARCH_TTL)

        # Last resort: expand a compact query into spaced-letter form.
        if not all_items:
            spaced = _spaced_letter_query(query)
            if spaced:
                spaced_key = f"search:{normalized_kind}:{spaced}:{fetch_limit}"
                all_items = _ytm_cache_get(spaced_key) or []
                if not all_items:
                    all_items = _fetch_by_kind(normalized_kind, spaced, fetch_limit)
                    words = _query_words(query)
                    if words:
                        all_items = [it for it in all_items if search_enhance.score_fuzzy(it, words) > 0]
                    search_enhance.index_results(all_items)
                    _ytm_cache_set(spaced_key, all_items, _SEARCH_TTL)

        _ytm_cache_set(cache_key, all_items, _SEARCH_TTL)

    page = all_items[offset: offset + limit]
    has_more = (offset + limit) < len(all_items)
    return page, has_more


# ----------------------  external import matching ----------------------

def match_track(title: str, artist: str) -> dict | None:
    """Find the best YouTube Music song for a (title, artist) pair — used to back a
    Spotify import with playable YT tracks. Returns a track dict or None on no match."""
    query = f"{title} {artist}".strip()
    if not query:
        return None
    try:
        results = _get_ytmusic().search(query, filter="songs", limit=1) or []
    except Exception:
        return None
    if not results:
        return None
    entry = results[0]
    video_id = entry.get("videoId") or ""
    if not video_id:
        return None
    artists = entry.get("artists") or []
    duration = entry.get("duration_seconds")
    if duration is None:
        duration = _parse_duration(entry.get("duration"))
    return {
        "id": video_id,
        "title": entry.get("title") or title,
        "url": f"https://music.youtube.com/watch?v={video_id}",
        "thumbnail": _pick_thumbnail(entry),
        "artist": artists[0].get("name") if artists else (artist or ""),
        "duration": duration,
        "kind": "music",
    }


def match_tracks(queries: list[dict]) -> list[dict | None]:
    """Match a batch of {title, artist} entries to YT songs in parallel, preserving order.
    None marks a track with no match (the client skips those)."""
    out: list[dict | None] = [None] * len(queries)
    futures = {}
    for i, qd in enumerate(queries):
        if not isinstance(qd, dict):
            continue
        futures[_search_pool.submit(match_track, qd.get("title", ""), qd.get("artist", ""))] = i
    for fut, i in futures.items():
        try:
            out[i] = fut.result()
        except Exception:
            out[i] = None
    return out


# ----------------------  artist / album ----------------------

def _normalize_artist_name(name: str) -> str:
    n = name.strip().lower()
    n = re.sub(r"^the\s+", "", n)
    n = re.sub(r"[^\w\s]", "", n)
    return re.sub(r"\s+", " ", n).strip()


def _artist_name_score(query: str, candidate: str) -> float:
    q = _normalize_artist_name(query)
    c = _normalize_artist_name(candidate)
    if not q or not c:
        return 0.0
    if q == c:
        return 1.0
    if q in c or c in q:
        return 0.9
    return difflib.SequenceMatcher(None, q, c).ratio()


def _ytm_track(entry: dict, artist_name: str | None = None, artist_channel_id: str | None = None) -> dict:
    video_id = entry.get("videoId") or ""
    artists = entry.get("artists") or []
    artist = artists[0].get("name") if artists else (artist_name or "")
    artist_cid = artists[0].get("id") if artists else None
    duration = entry.get("duration_seconds")
    if duration is None:
        duration = _parse_duration(entry.get("duration"))
    year = entry.get("year") or None
    album_raw = entry.get("album")
    album_name = album_raw.get("name") if isinstance(album_raw, dict) else None
    album_browse_id = album_raw.get("id") if isinstance(album_raw, dict) else None
    if not year and isinstance(album_raw, dict):
        year = album_raw.get("year") or None
    return {
        "id": video_id,
        "title": entry.get("title") or "",
        "url": f"https://music.youtube.com/watch?v={video_id}" if video_id else "",
        "thumbnail": _pick_thumbnail(entry),
        "artist": artist,
        "artistChannelId": artist_channel_id or artist_cid or "",
        "album": album_name,
        "albumId": album_browse_id or "",
        "year": year,
        "duration": duration,
        "kind": "music",
    }


def _ytm_album(entry: dict) -> dict:
    return {
        "id": entry.get("browseId") or entry.get("id") or "",
        "title": entry.get("title") or "",
        "year": entry.get("year"),
        "thumbnail": _pick_thumbnail(entry),
        "type": entry.get("type") or "album",
    }


def _artist_payload(channel_id: str, artist: dict, artist_name: str) -> dict:
    thumbnails = artist.get("thumbnails") or []
    photo_url = thumbnails[-1].get("url") if thumbnails else None
    songs_block = artist.get("songs") or {}
    songs_browse_id = songs_block.get("browseId") or None

    tracks: list[dict] = []
    if songs_browse_id:
        try:
            playlist = _get_ytmusic().get_playlist(songs_browse_id, limit=None)
            for e in (playlist.get("tracks") or []):
                t = _ytm_track(e, artist_name, channel_id)
                if t["id"]:
                    tracks.append(t)
        except Exception:
            for e in (songs_block.get("results") or []):
                t = _ytm_track(e, artist_name, channel_id)
                if t["id"]:
                    tracks.append(t)
    else:
        for e in (songs_block.get("results") or []):
            t = _ytm_track(e, artist_name, channel_id)
            if t["id"]:
                tracks.append(t)

    albums = [_ytm_album(e) for e in ((artist.get("albums") or {}).get("results") or [])]
    singles = [_ytm_album(e) for e in ((artist.get("singles") or {}).get("results") or [])]
    return {
        "channel_id": channel_id,
        "name": artist_name,
        "photo_url": photo_url,
        "description": artist.get("description"),
        "subscribers": artist.get("subscribers"),
        "tracks": tracks,
        "albums": albums,
        "singles": singles,
    }


def search_artist_details(name: str) -> dict:
    cache_key = f"artist:{name.strip().lower()}"
    cached = _ytm_cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    ytmusic = _get_ytmusic()
    search_results = ytmusic.search(name, filter="artists", limit=19) or []
    if not search_results:
        return {"error": "Artist not found"}

    scored = sorted(search_results, key=lambda r: _artist_name_score(name, r.get("artist") or ""), reverse=True)
    best = next((r for r in scored if r.get("browseId") or r.get("channelId")), scored[0])
    channel_id = best.get("browseId") or best.get("channelId") or ""
    if not channel_id:
        return {"error": "No channel ID for artist"}

    artist = ytmusic.get_artist(channel_id)
    artist_name = artist.get("name") or name
    result = _artist_payload(channel_id, artist, artist_name)
    _ytm_cache_set(cache_key, result, _ARTIST_TTL)
    _ytm_cache_set(f"artist_channel:{channel_id}", result, _ARTIST_TTL)
    return result


# --- collaborative-credit resolution -------------------------------------------------
# A credit like "Vertigoaway & rainsdeaf" arrives as plain text with no artist link. Given
# such a string, resolve it into the real artists it names: try the WHOLE string as one
# artist first (so "Above & Beyond", "Earth, Wind & Fire", "Tyler, The Creator" survive),
# and only if that misses, split on separators and verify every piece against YT Music.

_ARTIST_MATCH_THRESHOLD = 0.90
_MAX_ARTIST_TOKENS = 6
_ARTIST_SEP_RE = re.compile(
    r"\s*(?:&|/|\+|,|;|、|·|\bfeaturing\b|\bfeat\.?|\bft\.?|\bwith\b|\bvs\.?|\bx\b)\s*",
    re.IGNORECASE,
)


def _verify_artist(name: str) -> dict | None:
    """Fast check that `name` is a real YT Music artist: one cached artist-search, accept
    the best hit only if its name closely matches and it has a channel id. Deliberately
    skips get_artist (the "fast" mode) — a search hit + strong name match is enough."""
    q = (name or "").strip()
    if len(q) < 2:
        return None
    cache_key = f"artist_verify:{_normalize_artist_name(q)}"
    cached = _ytm_cache_get(cache_key)
    if cached is not None:
        return cached or None  # {} is the cached "no match" sentinel

    qn = _normalize_artist_name(q)

    def _whole_name_score(candidate: str) -> float:
        """How fully does `candidate` match the *entire* query — not just appear inside it?
        Deliberately avoids _artist_name_score's substring shortcut: that scores 0.9 when an
        artist's name is merely *contained* in the query, which made a combined credit like
        "gorillaz & Del the Funky Homosapien" verify as the single artist it contains and
        never split. Here only a near-whole-name match passes, so combined credits fail and
        fall through to the splitter."""
        cn = _normalize_artist_name(candidate)
        if not qn or not cn:
            return 0.0
        if qn == cn:
            return 1.0
        return difflib.SequenceMatcher(None, qn, cn).ratio()

    try:
        hits = _get_ytmusic().search(q, filter="artists", limit=5) or []
    except Exception:
        hits = []
    best, best_score = None, 0.0
    for r in hits:
        if not (r.get("browseId") or r.get("channelId")):
            continue
        score = _whole_name_score(r.get("artist") or "")
        if score > best_score:
            best, best_score = r, score

    match = None
    if best and best_score >= _ARTIST_MATCH_THRESHOLD:
        thumbs = best.get("thumbnails") or []
        match = {
            "name": best.get("artist") or q,
            "channel_id": best.get("browseId") or best.get("channelId") or "",
            "photo_url": thumbs[-1].get("url") if thumbs else None,
        }
    _ytm_cache_set(cache_key, match or {}, _ARTIST_TTL)
    return match


def resolve_artists(raw: str) -> dict:
    """Resolve a possibly-combined artist credit into one or more real artists.
    Returns {combined, artists:[{name, channel_id, photo_url}], unresolved:[str]}."""
    text = (raw or "").strip()
    if not text:
        return {"combined": False, "artists": [], "unresolved": []}

    cache_key = f"artist_resolve:{text.lower()}"
    cached = _ytm_cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    # 1) whole string first — the guard that keeps real names with separators intact.
    whole = _verify_artist(text)
    if whole:
        result = {"combined": False, "artists": [whole], "unresolved": []}
        _ytm_cache_set(cache_key, result, _ARTIST_TTL)
        return result

    # 2) tokenize on separators, keeping character spans so a multi-token group can be
    #    reconstructed verbatim (e.g. ["Earth","Wind","Fire"] -> "Earth, Wind & Fire").
    spans: list[tuple[int, int]] = []
    pos = 0
    for m in _ARTIST_SEP_RE.finditer(text):
        if m.start() > pos:
            spans.append((pos, m.start()))
        pos = m.end()
    if pos < len(text):
        spans.append((pos, len(text)))
    spans = [(s, e) for (s, e) in spans if text[s:e].strip()]

    if not (2 <= len(spans) <= _MAX_ARTIST_TOKENS):
        result = {"combined": False, "artists": [], "unresolved": [text]}
        _ytm_cache_set(cache_key, result, _ARTIST_TTL)
        return result

    # greedy longest-match: consume the biggest contiguous run of tokens that verifies as
    # one artist, then continue past it. Verifications are cached, so re-tries are cheap.
    artists: list[dict] = []
    unresolved: list[str] = []
    i, n = 0, len(spans)
    while i < n:
        matched = False
        for b in range(n - 1, i - 1, -1):
            candidate = text[spans[i][0]:spans[b][1]].strip()
            found = _verify_artist(candidate)
            if found:
                if not any(a["channel_id"] == found["channel_id"] for a in artists):
                    artists.append(found)
                i = b + 1
                matched = True
                break
        if not matched:
            unresolved.append(text[spans[i][0]:spans[i][1]].strip())
            i += 1

    result = {"combined": len(artists) >= 2, "artists": artists, "unresolved": unresolved}
    _ytm_cache_set(cache_key, result, _ARTIST_TTL)
    return result


def get_artist_by_channel_id(channel_id: str) -> dict:
    cache_key = f"artist_channel:{channel_id}"
    cached = _ytm_cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    try:
        artist = _get_ytmusic().get_artist(channel_id)
    except Exception:
        return {"error": "Artist not found"}

    artist_name = artist.get("name") or ""
    result = _artist_payload(channel_id, artist, artist_name)
    _ytm_cache_set(cache_key, result, _ARTIST_TTL)
    if artist_name:
        _ytm_cache_set(f"artist:{artist_name.strip().lower()}", result, _ARTIST_TTL)
    return result


def get_artist_songs_page(channel_id: str, params: str) -> list[dict]:
    cache_key = f"artist_songs:{channel_id}:{params}"
    cached = _ytm_cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    ytmusic = _get_ytmusic()
    artist_cached = _ytm_cache_get(f"artist_channel:{channel_id}")
    if isinstance(artist_cached, dict):
        artist_name = artist_cached.get("name") or ""
    else:
        artist_name = (ytmusic.get_artist(channel_id) or {}).get("name") or ""

    tracks = []
    for e in (ytmusic.get_artist_songs(channel_id, params) or []):
        t = _ytm_track(e, artist_name, channel_id)
        if t["id"]:
            tracks.append(t)
    _ytm_cache_set(cache_key, tracks, _ARTIST_TTL)
    return tracks


def get_radio(video_id: str, limit: int = 40) -> list[dict]:
    """YT Music "start radio from this song" — the recommendation pool for a MIX.

    Returns tracks in the same shape as search/artist results (so the client can queue
    them directly). The seed song itself usually comes back first; the caller decides
    whether to keep or drop it.
    """
    vid = (video_id or "").strip()
    if not vid:
        return []
    safe_limit = max(5, min(int(limit or 40), 100))
    cache_key = f"radio:{vid}:{safe_limit}"
    cached = _ytm_cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    ytmusic = _get_ytmusic()
    try:
        data = ytmusic.get_watch_playlist(videoId=vid, radio=True, limit=safe_limit) or {}
    except Exception:
        return []

    items = []
    for entry in (data.get("tracks") or []):
        if not entry.get("videoId"):
            continue
        # music only, no videos: YT Music tags real songs "MUSIC_VIDEO_TYPE_ATV" (audio
        # track), while OMV/UGC entries are music videos. keep songs (and anything with no
        # type set, to be safe), drop the videos.
        video_type = entry.get("videoType") or ""
        if video_type and not video_type.startswith("MUSIC_VIDEO_TYPE_ATV"):
            continue
        # watch playlists label the run time "length" (e.g. "3:45"); _ytm_track reads
        # "duration", so copy it across before mapping.
        if entry.get("duration") is None and entry.get("length"):
            entry = {**entry, "duration": entry.get("length")}
        track = _ytm_track(entry)
        if track["id"]:
            items.append(track)
    _ytm_cache_set(cache_key, items, _RADIO_TTL)
    return items


def fetch_album_tracks(browse_id: str) -> dict:
    cache_key = f"album:{browse_id}"
    cached = _ytm_cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    album = _get_ytmusic().get_album(browse_id)
    artists = album.get("artists") or []
    artist_name = artists[0].get("name") if artists else ""
    thumbnails = album.get("thumbnails") or []
    tracks = []
    for entry in (album.get("tracks") or []):
        t = _ytm_track(entry, artist_name)
        if t["id"]:
            tracks.append(t)
    result = {
        "id": browse_id,
        "title": album.get("title") or "",
        "artist": artist_name,
        "year": album.get("year"),
        "thumbnail": thumbnails[-1].get("url") if thumbnails else None,
        "tracks": tracks,
    }
    _ytm_cache_set(cache_key, result, _ALBUM_TTL)
    return result


# ----------------------  playlist import ----------------------

def _extract_playlist_id(value: str) -> str:
    """Pull a playlist id out of a pasted URL, or pass through a bare id.
    Accepts youtube.com/music.youtube.com '?list=' URLs and bare PL/VL/OLAK/RD ids."""
    raw = (value or "").strip()
    if not raw:
        return ""
    if "list=" in raw:
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(raw).query)
        return (qs.get("list") or [""])[0].strip()
    # bare id pasted directly (no scheme / query)
    if "://" not in raw and " " not in raw:
        return raw
    return ""


def fetch_playlist_tracks(id_or_url: str) -> dict:
    """Resolve a YouTube / YouTube Music playlist (id or pasted URL) to a flat track list.
    Tries ytmusicapi first (rich metadata); falls back to a yt-dlp flat extract for plain
    YouTube playlists ytmusic can't read. Returns {id, title, author, thumbnail, tracks}."""
    playlist_id = _extract_playlist_id(id_or_url)
    if not playlist_id:
        return {"error": "Could not find a playlist id in that link"}

    cache_key = f"playlist:{playlist_id}"
    cached = _ytm_cache_get(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    result = None
    try:
        playlist = _get_ytmusic().get_playlist(playlist_id, limit=None)
        tracks = []
        for entry in (playlist.get("tracks") or []):
            t = _ytm_track(entry)
            if t["id"]:
                tracks.append(t)
        if tracks:
            thumbnails = playlist.get("thumbnails") or []
            author = playlist.get("author")
            if isinstance(author, dict):
                author = author.get("name")
            result = {
                "id": playlist_id,
                "title": playlist.get("title") or "Imported playlist",
                "author": author or "",
                "thumbnail": thumbnails[-1].get("url") if thumbnails else None,
                "tracks": tracks,
            }
    except Exception:
        result = None

    # Fallback: plain YouTube playlist that ytmusic rejected — flat-extract with yt-dlp.
    if result is None:
        import resolver
        url = id_or_url if "://" in (id_or_url or "") else f"https://www.youtube.com/playlist?list={playlist_id}"
        info = resolver.extract_playlist(url)
        if info.get("error"):
            return info
        result = {
            "id": playlist_id,
            "title": info.get("title") or "Imported playlist",
            "author": info.get("author") or "",
            "thumbnail": info.get("thumbnail"),
            "tracks": info.get("tracks") or [],
        }

    if not result.get("tracks"):
        return {"error": "Playlist is empty or unavailable"}
    _ytm_cache_set(cache_key, result, _PLAYLIST_TTL)
    return result

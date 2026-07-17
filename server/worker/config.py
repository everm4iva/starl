"""
☆ Worker config
-> resolves the same DATA_DIR / CACHE_DIR the Node brain uses (read from new-server/.env),
   so the ytm cache and the full-download fallback land where Node expects them.
-> a tiny hand-rolled .env parser keeps the worker's only real deps yt-dlp + ytmusicapi.
"""

from pathlib import Path
import os

WORKER_DIR = Path(__file__).resolve().parent
BASE_DIR = WORKER_DIR.parent  # new-server/
ENV_FILE = BASE_DIR / ".env"


def _load_env(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, ignores comments/blanks, strips quotes.
    Does not override variables already present in the real environment."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env(ENV_FILE)


def _resolve_dir(name: str, fallback: Path) -> Path:
    raw = os.environ.get(name, "").strip().strip('"')
    if not raw:
        return fallback
    p = Path(raw)
    return p if p.is_absolute() else (BASE_DIR / p)


DATA_DIR = _resolve_dir("DATA_DIR", BASE_DIR / "data")
CACHE_DIR = _resolve_dir("CACHE_DIR", BASE_DIR / "cache")

AUDIO_DIR = CACHE_DIR / "audio"
YTM_CACHE_DIR = DATA_DIR / "ytm_cache"

WORKER_PORT = int(os.environ.get("WORKER_PORT", "6913") or "6913")

# yt-dlp / ffmpeg knobs (same env names the old server honored).
# Cookies path resolves like DATA_DIR/CACHE_DIR: a relative value is anchored to
# new-server/ so cookies.txt stays self-contained even if the folder moves or is renamed.
_cookies_raw = os.environ.get("YTDLP_COOKIES_FILE", "").strip().strip('"')
if _cookies_raw and not Path(_cookies_raw).is_absolute():
    _cookies_raw = str(BASE_DIR / _cookies_raw)
YTDLP_COOKIES_FILE = _cookies_raw
YTDLP_COOKIES_FROM_BROWSER = os.environ.get("YTDLP_COOKIES_FROM_BROWSER", "").strip().lower()
FFMPEG_LOCATION = (os.environ.get("FFMPEG_LOCATION") or os.environ.get("FFMPEG_PATH") or "").strip().strip('"')

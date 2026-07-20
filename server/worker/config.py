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
CONFIG_FILE = BASE_DIR / "config.yaml"
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


def _load_worker_port(path: Path) -> int:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return int(os.environ.get("WORKER_PORT", "6918") or "6918")

    in_worker_section = False
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not line.startswith(" ") and line.rstrip(":") == "worker":
            in_worker_section = True
            continue
        if not in_worker_section:
            continue
        if not line.startswith(" "):
            break
        stripped = line.strip()
        if stripped.startswith("port:"):
            value = stripped.split(":", 1)[1].strip().strip('"').strip("'")
            try:
                return int(value)
            except ValueError:
                break

    return int(os.environ.get("WORKER_PORT", "6918") or "6918")


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

WORKER_PORT = _load_worker_port(CONFIG_FILE)

# yt-dlp / ffmpeg knobs (same env names the old server honored).
# Cookies path resolves like DATA_DIR/CACHE_DIR: a relative value is anchored to
# new-server/ so cookies.txt stays self-contained even if the folder moves or is renamed.
_cookies_raw = os.environ.get("YTDLP_COOKIES_FILE", "").strip().strip('"')
if _cookies_raw and not Path(_cookies_raw).is_absolute():
    _cookies_raw = str(BASE_DIR / _cookies_raw)
YTDLP_COOKIES_FILE = _cookies_raw
YTDLP_COOKIES_FROM_BROWSER = os.environ.get("YTDLP_COOKIES_FROM_BROWSER", "").strip().lower()
FFMPEG_LOCATION = (os.environ.get("FFMPEG_LOCATION") or os.environ.get("FFMPEG_PATH") or "").strip().strip('"')

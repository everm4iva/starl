"""
☆ Worker TTL cache
-> per-key TTL files {key, expires_at, payload}, one small file per cache entry, grouped
   into sub-dirs by a namespacer so the ytm cache stays browsable (search/ artist/ album/).
-> trimmed copy of record_store.TtlFileCache — the worker keeps the ytm page cache warm.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable


def _atomic_write_json(path: Path, data: object, attempts: int = 6) -> None:
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
    for attempt in range(attempts):
        try:
            os.replace(tmp, path)
            return
        except (PermissionError, OSError):
            if attempt == attempts - 1:
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
                raise
            time.sleep(0.05 * (attempt + 1))


def _safe_unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _safe_cache_filename(key: str, max_len: int = 80) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", key).strip("_")
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip("_")
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]
    return f"{cleaned}__{digest}" if cleaned else digest


class TtlFileCache:
    def __init__(self, directory: Path, namespacer: Callable[[str], str | None] | None = None):
        self.directory = Path(directory)
        self._namespacer = namespacer
        self._mem: dict[str, tuple[float, object]] = {}
        self._lock = threading.RLock()

    def _dir_for(self, key: str) -> Path:
        if self._namespacer:
            try:
                sub = self._namespacer(key)
            except Exception:
                sub = None
            if sub:
                return self.directory / re.sub(r"[^A-Za-z0-9._-]+", "_", sub).strip("_")
        return self.directory

    def _path_for(self, key: str) -> Path:
        return self._dir_for(key) / f"{_safe_cache_filename(key)}.json"

    def get(self, key: str) -> object | None:
        now = time.time()
        with self._lock:
            entry = self._mem.get(key)
            if entry is not None:
                expires_at, payload = entry
                if now < expires_at:
                    return copy.deepcopy(payload)
                self._mem.pop(key, None)
                _safe_unlink(self._path_for(key))
                return None
        path = self._path_for(key)
        try:
            with path.open("r", encoding="utf-8") as handle:
                record = json.load(handle)
        except (FileNotFoundError, ValueError):
            return None
        except OSError:
            return None
        expires_at = float(record.get("expires_at", 0) or 0)
        if now >= expires_at:
            _safe_unlink(path)
            return None
        payload = record.get("payload")
        with self._lock:
            self._mem[key] = (expires_at, payload)
        return copy.deepcopy(payload)

    def set(self, key: str, payload: object, ttl: float) -> None:
        expires_at = time.time() + ttl
        with self._lock:
            self._mem[key] = (expires_at, payload)
        path = self._path_for(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            _atomic_write_json(path, {"key": key, "expires_at": expires_at, "payload": payload})
        except OSError:
            pass

    def sweep_expired(self) -> int:
        removed = 0
        now = time.time()
        if not self.directory.exists():
            return 0
        for path in self.directory.rglob("*.json"):
            try:
                with path.open("r", encoding="utf-8") as handle:
                    record = json.load(handle)
                if now >= float(record.get("expires_at", 0) or 0):
                    path.unlink()
                    removed += 1
            except (FileNotFoundError, ValueError):
                pass
            except OSError:
                pass
        return removed

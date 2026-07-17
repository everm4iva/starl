# Server Architecture

This document explains how Starl's backend is built, and how the current **new server** differs from the old version.
It's a curiosity-level overview, not a setup guide.

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

---

## What the server is for

The app never talks to YouTube directly. A server does it on the app's behalf: it searches, resolves a playable URL, streams the audio (caching a copy as it goes), caches thumbnails, validates logins, and stores each user's account state (playlists, history, settings).

There are two generations of this server in the private repo of the developer (currently, but not for long, a server is going to be avaliable soon):

- The old ("server/"). One FastAPI (Python) app that did everything.
- The new ("new-server/"). The rewrite, currently in use. A **Node/Express "brain"** plus a small **Python "resolver" worker**.

Both expose the **exact same HTTP API**, so the mobile client doesn't know or care which one it's talking to. The new server even reads the old one's data and cache files in place - no migration.

---

## The new server: brain + worker

The core idea of the rewrite is a split of responsibilities by language.

```
mobile client --HTTP--> Node/Express (the "brain")
                          |  reads/writes  data/ + cache/  (plain files)
                          '--HTTP (localhost)--> Python worker
                                                 yt-dlp + ytmusicapi
```

**Node owns almost everything:** routing, auth, CORS, rate limits, the version gate, the file-based data layer, the **audio streaming proxy**, image caching, and the background janitor that sweeps stale/unused/invalid files.

**Python owns only what genuinely needs it:** resolving a YouTube URL to a real audio stream (`yt-dlp`) and music lookups - search, artist, album (`ytmusicapi`). These are Python libraries with no good Node equivalent, so they stay in Python.

The worker is a tiny always-on localhost JSON service. Node spawns it on startup and restarts it if it dies. Because it stays warm, there's no per-request Python/library cold start - Node just makes a quick local HTTP call when it needs a URL resolved or a search run.

### No database

There's no database, i hate using those, too complicated. Everything is plain readable files on disk:

- `data/` - users, account state, search history, etc. - as per-record JSON sidecars (one small file per record, so a write never rewrites a giant monolith).
- `cache/` - cached audio (`.mp3` + a `.json` of metadata) and cached images.

Cross-process file locks coordinate concurrent access, and atomic writes keep files from being half-written...

### Why it's so GODDAMN quick

A few  choices, mostly carried over and refined from the old server:

- **First play streams immediately.** Instead of "download the whole file, *then* start playing," (old server behaviour),the resolved CDN URL is streamed straight to the client while a copy is written to cache in the same pass.
- **Bounded byte-range chunks.** The proxy pulls the CDN in fixed-size chunks. An open-ended request gets throttled to roughly playback speed, but chunked requests burst at full speed - so a track finishes caching in seconds.
- **Images never block audio.** Thumbnail fetching/caching is always backgrounded and working in paralel from everything..
- **The worker stays warm**, as i said.

---

## The old server: one Python app :(

`server/` was a single FastAPI application (`app/main.py` is ~1600 lines on its own). It did the same jobs, but everything lived in one Python process:

- FastAPI routes for auth, media, search, account state.
- `yt-dlp` and `ytmusicapi` called inline, on dedicated thread pools.
- The same file-based storage idea (per-record JSON, TTL caches, file locks).
- The same streaming-while-caching proxy.

It worked.. barely, and a lot of the hard-won details (the streaming proxy, the per-record stores, the priority queue that lets a new typed search jump ahead of an older one, the cache janitor) were proven here first and then carried into the rewrite.

It's main limitation was structural: one big Python process doing both the lightweight web/IO work *and* the heavy resolution work, with a lot of careful thread-pool juggling, killing birdies, head-scratching paranoia to keep slow `yt-dlp` calls from starving fast endpoints like `/stream` or `/auth/me`.

---

## Side-by-side, because i love comparing

| | `server/` (old) | `new-server/` (current) |
|---|---|---|
| Web layer | Python / FastAPI | Node / Express |
| Resolution + search | Inline in the same process | Separate warm Python worker |
| Languages | Python only | Node (brain) + Python (worker) |
| Process model | One process, many thread pools | Brain process + supervised worker process |
| Concurrency model | `asyncio` + thread pools, with a tuned threadpool token limit | Node's native async I/O; Python isolated to the worker |
| Storage | File-based (per-record JSON, file locks) | **Same files, read in place** |
| HTTP API | - | **Identical** to the old one |
| Status | Kept as a fallback | In use |

---

## Why the split helps

The rewrite's main win is that the two kinds of work no longer compete in one runtime. Node is supa good at lots of concurrent I/O (streaming, proxying, serving files), so the web layer doesn't need careful thread-pool, head-scratching,  eyes twisting of exhaustion to tuning to stay responsive. The slow, blocking, library-heavy work is fenced off in its own process, where it can't stall the brain - and if it crashes, the brain restarts just the worker.

Because the API and on-disk format are unchanged, the switch is invisible to the client and reversible, i left the old `server/` is left in the project place as a fallback.

---

## Where to look in the code

No shit. Not public - yet. Code is still messy as always. Cry about it. (Just kidding, i hate having cafeine in my blood because of this)

Im working on getting it public asap.
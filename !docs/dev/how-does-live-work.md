# How Live Streams Work

This document explains how Starl plays a live stream (a 24/7 lo-fi radio, for example) - and why it takes a completely different path than a normal track.

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

---

## Why Live Is Special

A normal track is a **finite file**. The server resolves one direct CDN link, streams the bytes to your phone, and writes a finished `.mp3` to disk so the next play is instant. Read [how-sys-streaming-works.md](./how-sys-streaming-works.md) for that flow.

A live stream breaks every assumption that flow is built on:

- **It never ends.** There is no finished file to cache or play offline.
- **It has no duration.** `audio.duration` is `Infinity`, so the seek bar and "resume from position" logic have nothing to work with.
- **It is HLS, not a plain file.** YouTube serves live audio as an `.m3u8` *manifest* - a constantly-updating playlist of short segments. An Android WebView `<audio>` element cannot play `.m3u8` natively, and the segments live on `*.googlevideo.com` with no CORS headers, so the WebView cannot fetch them directly either.

So live needs its own resolve path, its own server proxy, and a real HLS player on the client.

## IMPORTANT INFO!

For now Starl only can fetch *some* YouTube live streams on the search. If one specific doesn't show up, go on youtube -> go on the live -> share -> share with starl.

The app will then be able to play it.. but will take a while to start because it will have to fetch the manifest and segments from youtube. This is a known issue and will be fixed in the future.

Enjoy the rest.

---

## The Main Players (Files)

### Server side

| File | What it does |
|---|---|
| `new-server/worker/resolver.py` | yt-dlp resolve. Detects `is_live` and returns the HLS **master manifest** URL instead of a direct file URL |
| `new-server/src/media/downloads.py` | `/download` handler. Routes a live result to `/live/manifest` instead of `/proxy` |
| `new-server/src/media/live.js` | The HLS proxy - re-serves the manifest + segments through our own origin (CORS + auth) |
| `new-server/src/routes/media.js` | Registers `GET /live/manifest` and `GET /live/segment` |

### Client side

| File | What it does |
|---|---|
| `js/vendor/hls.min.js` | hls.js - plays an `.m3u8` in the WebView via MediaSource |
| `engine.js` | `playStream()` - the live branch that drives hls.js, plus the event guards |
| `engine-player.js` | `playFromSearch()` - reads `is_live`, skips caching, handles restore |
| `playback-state.js` | Owns the `isLive` flag and the single live `hls` instance |
| `meta.js` | Swaps the seek bar for a "LIVE" pill when `isLive` is set |
| `search.js` | Detects a pasted YouTube link and renders it as one playable card |

---

## Part 1 - Resolving a Live URL

### Step 1: You start a live stream

A live URL reaches the app the same way any track does - pasted into search, or shared in from YouTube ("Share -> starl"). It flows into `playFromSearch(item)` and on to `POST /download`, exactly like a normal song.

### Step 2: The resolver notices it is live

In `resolver.py`, yt-dlp extracts the URL. The key detail: **a live stream has no audio-only format** - only muxed (audio+video) HLS renditions. The normal "bestaudio" selectors all miss, so the format string ends in a `/best` fallback purely so extraction does not hard-fail.

Once extracted, the resolver checks `info["is_live"]`. If true, it returns the **master manifest** (`info["manifest_url"]`) - the playlist that lists every quality rendition -- and nulls the duration:

```
{
  "is_live": true,
  "duration": null,
  "direct_url": "https://manifest.googlevideo.com/api/manifest/hls_variant/..."
}
```

### Step 3: The server hands back a /live URL

`downloads.py` sees `is_live` and, instead of building a `/proxy` URL (which would try to cache a file), builds a live one. A live result is never written to the audio cache and never background-downloaded:

```
{
  "is_live": true,
  "stream_url": "/live/manifest?src=https%3A%2F%2Fmanifest.googlevideo.com%2F...",
  "duration": null
}
```

---

## Part 2 - The Live Proxy (Why It Exists)

hls.js needs to fetch the manifest and every segment. Those live on `*.googlevideo.com`, which sends no CORS headers - so a direct fetch from the WebView is blocked. `live.js` fixes this by re-serving everything through our own origin.

### The manifest handler

`GET /live/manifest?src=<m3u8>` fetches the upstream playlist and **rewrites every child URL to point back at us**, carrying the same auth token:

- variant playlists (the master's renditions) -> `/live/manifest?src=...`
- media segments + init/key URIs -> `/live/segment?src=...`

The tricky and fucked part: YouTube's HLS URLs are **extensionless** (the params live in the path, not a `.m3u8`/`.ts` suffix). So the proxy decides playlist-vs-segment by **manifest tag context**, not the file extension, yeah... boring:

```
#EXT-X-STREAM-INF:...        <- the next URL line is a variant PLAYLIST
https://.../hls_playlist/...

#EXTINF:2.0,                 <- the next URL line is a SEGMENT
https://.../videoplayback/...
```

The manifest is never cached (`Cache-Control: no-store`) - a live playlist is a sliding window, so hls.js re-requests it and we just re-fetch upstream each time.

### Trimming the DVR window (indirectly the big performance fix)

A 24/7 YouTube live stream is served as a **DVR** playlist: the media playlist lists *every* segment in a multi-hour window (i guess). The synthwave radio handed back **2880 segments / 3.4 MB** of playlist - and hls.js re-downloads the whole thing every ~5 seconds. That is exactly what made a live take a *minute* to start and then stutter. :3

So when the proxy detects a media playlist (it has `#EXTINF` segments, not `#EXT-X-STREAM-INF` renditions or whatever), it keeps only the **last 24 segments** - the live edge, all hls.js needs to play "now" - and bumps `#EXT-X-MEDIA-SEQUENCE` by the number of dropped segments so the sliding window stays consistent across refreshes. That turns a 3.4 MB refresh into ~36 KB.

### The segment handler

`GET /live/segment?src=<seg>` streams the upstream bytes straight through, no caching.

### SSRF guard

Both handlers only fetch hosts ending in `.googlevideo.com`. Anything else is rejected with 400, so the proxy cannot be pointed at internal addresses - for security, OH YEAH!!!!

---

## Part 3 - Playing It on the Client

### Step 1: playStream takes the live branch

`playFromSearch()` reads `downloadData.is_live`, sets `starlPlaybackState.isLive`, and calls `playStream(url, token, isLive)`. The live branch hands the manifest to **hls.js** instead of setting `audio.src` directly:

```
hls = new Hls({ startLevel: 0, ... })   // lock the lowest rendition
hls.loadSource(manifestUrl)
hls.attachMedia(audio)                  // feeds the shared <audio> element via MediaSource
```

Because the streams are muxed-only, it locks hls.js to the **lowest** rendition (`currentLevel = 0`) - so.. it only need the audio, so there is no reason to pull a 1080p video feed. The shared `<audio>` element decodes the audio and ignores the video.

### Step 2: Buffer deep (omg)

Latency does not matter for a 24/7 stream, so hls.js is tuned to sit several segments behind the live edge with a large buffer (`liveSyncDurationCount: 8`, `maxBufferLength: 60`). A brief network or proxy hiccup then rides through the buffer instead of stalling.

### Step 3: The event guards

The normal `<audio>` listeners assume a finite duration, so `engine.js` guards them when `isLive`:

- `loadedmetadata` - duration is `Infinity`, so no seek-bar max is set
- `timeupdate` - no position, no slider, no state saving
- `ended` - a live stream should not fire this; if the edge time drops, hls.js reconnects on its own

### Step 4: The UI

`meta.js` toggles an `is-live` class on the player, which hides the seek bar and time readout and shows a pulsing **"LIVE"** pill in their place. Caching, pre-caching, and queue neighbor prefetch are all skipped - there is nothing finite to store.

---

## Part 4 - Restarting the App

A live manifest URL expires between launches, so the saved one is useless on the next start. `restorePlayerState()` sees the saved `isLive` flag and **does not** reuse the old URL - it leaves the player primed so the first tap on play re-resolves a fresh manifest through the normal `playFromSearch` path.

---

## Summary - Live vs Normal

```
Normal track:
  /download -> resolve direct CDN url -> /proxy streams + caches an .mp3 -> <audio> plays it
  (finite, seekable, cacheable, works offline)

Live stream:
  /download -> resolve HLS master manifest (is_live) -> /live proxy adds CORS + auth
            -> hls.js plays it via MediaSource -> "LIVE" pill, no seek bar
  (infinite, no duration, never cached, never offline)
```

The one thing they share is the entry point: both start at `playFromSearch()` and `POST /download`. Everything after the `is_live` check diverges.


learn more about the backend architecture in [server-architecture.md](./server-architecture.md).

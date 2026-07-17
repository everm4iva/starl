# How Streaming Works

This document explains how Starl finds, downloads, and plays music - from the moment you tap a song to the moment you hear it.

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

---

## The Two Sides

There are two computers involved every time you play a song.

- The **client** is your phone running the app.
- The **server** is a computer running Nodejs/Express + python worker (yt-dlp) that treats youtube as a slave on your behalf.

The app never talks to YouTube directly. It always goes through the server. The server fetches the audio, optionally caches it to disk, and hands a stream URL back to the app.

---

## The **FILES** (*dramatic pause*)

### Server side

| File | What it does |
|---|---|
| `server/app/main.py` | The front door. Defines every API route (/download, /search, /prewarm, etc.) |
| `server/app/downloads.py` | Talks to yt-dlp and ytmusicapi to find songs and resolve stream URLs |
| `server/app/cache.py` | Knows where files are stored on disk and manages the audio/image index |

### Client side

| File | What it does |
|---|---|
| `runtime.js` | Owns the single audio element the whole app uses |
| `engine.js` | Wires audio events (play, pause, seek, ended) and handles state saving |
| `engine-player.js` | The main entry point - playFromSearch() lives here |
| `queue-player.js` | Wires the next/prev/shuffle buttons to the queue |
| `queue.js` | Tracks the list of songs and your position in it |
| `server/player.js` | Makes the actual HTTP call to /download |
| `media-cache.js` | Stores audio blobs and images in IndexedDB (your phone's local database) |
| `search.js` | Handles the search input, results, and prewarm scheduling |

---

## Part 1 - Playing a Song

### Step 1: You tap a song

`playFromSearch(item)` is called. The `item` object has the song title, artist, and its YouTube URL (`https://music.youtube.com/watch?v=...`).

### Step 2: Check the local cache first

Before touching the network, `getCachedPlayableTrackUrl()` checks IndexedDB (the browser's built-in local database). If the song was downloaded before, it returns a blob URL right away and playback starts instantly. No server needed.

### Step 3: If not cached, ask the server

The app calls `POST /download` on the server with the YouTube URL. The server runs `prepare_direct_stream()` which uses yt-dlp to find the real audio stream URL on YouTube's CDN. This step is the slow one - yt-dlp has to solve challenges and extract a direct HTTPS link. It usually takes 1-3 seconds on a cold call.

The server returns something like:

```
{
  "stream_url": "/proxy/abc123?src=https://cdn.youtube.com/...",
  "audio_id": "abc123",
  "title": "Song Name",
  "duration": 213
}
```

### Step 4: The proxy endpoint

The app points the audio element at `/proxy/{audio_id}?src={cdn_url}`. This endpoint does two things at the same time:

- Streams the audio bytes directly to the browser so it can start playing
- Writes the same bytes to a file on disk (in `/app/cache/audio/`)

Once the file is fully written, it is renamed to its final path. From that point on, any future request for this song bypasses the proxy entirely and serves straight from disk via `/stream/{audio_id}`.

### Step 5: Audio element plays

`playStream(url, token)` sets `audio.src` to the proxy or stream URL, calls `audio.load()`, then `await audio.play()`. The browser starts receiving bytes and buffers enough to begin playback.

---

## Part 2 - The Prewarm System

Calling `/download` cold takes 1-3 seconds because yt-dlp has to contact YouTube. To avoid that wait, the app pre-resolves URLs before you actually need them.

This is called prewarming :3 (like unfreezing a car engine before you drive it).

### Server-side prewarm cache

`prewarm_audio()` runs the same yt-dlp resolution as `/download` but stores the result in a small in-memory dictionary with a 3-minute expiry. When `/download` is called later for the same song, it finds the result in device's storage and returns in under 100ms instead of 1-3 seconds.

### Client-side prewarm triggers

There are three places that fire prewarm calls in the background:

**1. Search results**

When results appear on screen, `schedulePrewarm()` fires:
- The top result is prewarmed immediately (0ms delay or a bit longer) because it is most likely to be played
- The remaining results are sent as a single batch request (`POST /prewarm/batch`) after a 500ms~1s delay so the search request itself has settled

**2. Queue neighbors**

When a song starts playing, `_prefetchQueueNeighbors()` fires immediately:
- It reads the next and previous tracks from the queue without moving the queue position (using `peekNext()` and `peekPrev()`)
- It sends both URLs in one `POST /prewarm/batch` call so the server resolves them in parallel
- After 2 seconds, it also starts a full download of the next track (see Part 3)

**3. Batch endpoint**

`POST /prewarm/batch` accepts up to 8 URLs and runs them all in parallel on the server. This is much faster than making 8 separate prewarm requests one after another.

And it's pretty rad, imagine just skipping and not waiting - bare minimum.

---

## Part 3 - Pre-caching the Next Track

Prewarm alone still leaves a 1-2 second gap when you skip, because the server has to open a connection to the proxy and buffer the first few seconds of audio before it can play.

To eliminate this gap, the app actively downloads the next track in the queue while you are still listening to the current one.

### The flow

```
current song starts playing
    |
    +-- immediately: prewarm next + prev via /prewarm/batch
    |
    +-- 2 seconds later: _precacheNextTrack(nextTrack) fires
            |
            +-- calls POST /download for the next track
            |     (fast because prewarm already ran)
            |
            +-- gets back the proxy URL (ex: /proxy/xyz?src=...)
            |
            +-- starts a hidden silent audio element pointing at that URL
            |     the browser begins downloading bytes in the background
            |     the server writes the file to disk via the proxy
            |
            +-- calls cache.cacheTrack() which also downloads the full audio
                  blob and stores it in IndexedDB
```

### Why the hidden audio element helps

When the hidden element requests `/proxy/xyz`, the server starts streaming from YouTube CDN and writing to disk at the same time. If you skip before the download finishes, your app requests for `/proxy/xyz` has to wait for the ongoing proxy to finish - but that is only seconds away, not a cold start. Once the proxy is done, the server serves from disk (almost instant).

Once `cacheTrack()` finishes storing the blob in IndexedDB, future skips to that track are completely instant with no server call at all.

---

## Part 4 - Image Loading

Images (album art, thumbnails) follow the same layered pattern. ^3^

### Server side

`POST /cache/image?url=...` fetches the image from YouTube's CDN, saves a full-resolution copy and a low-resolution copy to disk, and returns the cached bytes. Subsequent requests serve from disk, not CDN.

### Client side

`resolveImageUrl(url)` checks IndexedDB first. If the image is there, it returns a blob URL (no network). If not, it returns the server proxy URL and starts caching in the background so the next time is instant.

For list rows (search results, queue), the app always requests the low-resolution variant to avoid downloading 1280px images for 40px thumbnails - bleh.. such a wasteeeeee of resources.

### Pre-caching neighbor images

When `_prefetchQueueNeighbors()` runs, it also calls `cache.cacheImage()` for the next and previous track artwork. By the time you skip, the image is already in IndexedDB and appears immediately.

---

## Part 5 - Search

### Request flow

```
you type a query
    |
    300ms debounce (waits for you to stop typing)
    |
    POST /search  { query, limit: 20, kind: "music" }
    |
    server checks the per-user rank cache (1-hour TTL)
    |   hit  --> returns sorted results instantly
    |   miss --> calls ytmusicapi (1-3 seconds)
                 sorts by your past click history
                 stores in rank cache
                 returns results
    |
    app renders results
    |
    prewarm fires (top result: 0ms, rest: batch at 500ms)
```

### Kind filters

The search tab has four kinds: Music, Artists, Albums, Playlists. When kind is "all", the server runs all four searches in parallel and merges the results. Each kind uses ytmusicapi's corresponding filter.

### Click tracking

When you click a search result, the app records it with `POST /search/click`. The server increments your click count for that query+result pair and invalidates the rank cache so the next search re-ranks with updated data.

---

## Part 6 - Offline Playback

All audio and images stored in IndexedDB (via `cacheTrack` and `cacheImage`) are available offline. The blobs are stored as Blob objects and served as blob:// URLs when needed.

If a blob URL is revoked by the browser (this happens on some Android devices), `runtime.js` detects the error and automatically falls back to the last known server stream URL, resuming from the same position.

---

## Part 7 - Artist Pages

Opening an artist page calls `GET /artist?channel_id=...` which returns the artist's full track list, albums, and bio via ytmusicapi. This call takes 1-3 seconds cold.

To make it instant, the app has two layers of caching:

**Server side**: artist data is cached in memory for 30 minutes after the first fetch. Repeat opens within 30 minutes hit the in-memory cache and return in milliseconds.

**Client side**: `artist-page.js` has its own in-memory Map with the same 30-minute TTL. Once you have opened or prewarmed an artist, every open for the next 30 minutes returns from the client-side Map with zero network calls.

**Prewarm triggers**:
- When any song starts playing, the artist for that song (and the next/prev queue track's artists) are all prewarmed in parallel
- When artist search results render, each artist card immediately triggers a background prewarm so opening any of them is instant

---

## Summary - What Happens When You Skip

When you press next, here is the order of events depending on what has been prepared:

```
Best case (blob in IndexedDB - next track was fully downloaded):
  getCachedPlayableTrackUrl() returns a blob URL
  audio.src = blob://...
  audio.play() starts immediately
  Total wait: under 100ms

Good case (server has file on disk -- hidden element finished downloading):
  /download returns /stream/{audio_id}  (cached: true)
  audio.src = /stream/...
  audio.play() starts after the browser buffers a small chunk from disk
  Total wait: around 300-500ms

Okay case (proxy is mid-download -- hidden element started but not done):
  /download returns /proxy/{audio_id}?src=...
  proxy is locked by the ongoing hidden element download
  browser waits for lock to release, then gets FileResponse from disk
  Total wait: depends how close the download was to finishing

Slow case (nothing was prewarmed -- cold start):
  /download calls yt-dlp (1-3 seconds)
  returns /proxy/{audio_id}?src=...
  browser buffers from CDN stream (1-2 more seconds)
  Total wait: 2-5 seconds
```

The first three cases are what you get for any track in a queue after the current song has been playing for more than a few seconds. :3

learn more about the backend architecture in [server-architecture.md](./server-architecture.md).
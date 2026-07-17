# Manage Storage (for some reason i didn't add it sooner)
It opens a page that shows you where every byte goes and lets you boss the caches around. Here are the details about it:

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

---

## The idea

Open it from **account tab -> Storage -> Manage storage**. You get:

- one **stacked bar** showing the storage visually (music cache, image cache, their reserved little space, your user storage, the app itself, and free space),
- and a handful of **settings** to cap the caches and decide what happens when they overflow.

All the logic lives in [storage.js](../../www/js/client/data/storage.js).

The page you look at is [storage-page.js](../../www/js/client/ui/storage-page.js). They never mix - one does the thinking, the other does the visual stuff.

---

## The bar

| Segment | Shade | What it is |
|---|---|---|
| Music cache | bright | downloaded songs sitting on disk |
| Image cache | bright | cached artwork sitting on disk |
| Music headroom | darker | the reserved-but-empty room up to the music cap |
| Image headroom | darker | same, for images |
| User storage | neutral | your protected local metadata (see below) |
| App storage | neutral | the app's own footprint - its caches |
| Free storage | darkest | space left |

The bar spans the **device total**. On a real device the leftover chunk that isn't any of these (other apps, the OS) just shows as empty digital dark space.

---

## User storage vs App storage vs caches

This confuses people up, so here's is what is going on:

- **User storage**: is protected. It's the little drawer of local app metadata: current playback info, cached lyrics, your login token, the storage settings themselves, plugin cache, your profile picture + info. **It never gets evicted.** You can't cap it and the app won't touch it. (trust)
- **App storage**: is the app's own install/data footprint (from the native plugin).
- **Caches**: (music + image) are in your control.

> Heads up: offline-cached **playlist** data is *not* user storage. That stuff mirrors data that really lives on the server - the client just keeps a local copy for offline vibes, so it's treated as cache, not protected metadata.

---

## Total size (what the 100% means)

The image and music caps are percentages. The **Total size** setting decides what those percentages are a percentage *of*:

| Mode | 100% means... |
|---|---|
| `device` | the device's **live free space** right now. **This is the default.** |
| `fixed` | a **fixed GB total** you lock in with the slider (0 --> device free). |

So if your budget is 10 GB and the music cap is 40%, music may fill 4 GB. Flip to `device` mode and that 40% floats with however much free space the device has at the moment. Total size opens as its own little sub-view inside the page (the back button pops it before closing the whole thing).

---

## The caps

Two sliders, both 0-100%:

- **Image cache** - how much of the total the cached artwork may fill.
- **Music cache** - how much of the total the downloaded music may fill.

It shows both the percent and the resolved byte value, so `40%  (4.0 GB)` tells you exactly what you're configuring exactly.

---

## Overflow actions

For each cache you pick what happens the moment it busts its cap.

"Everything good has a limit" - my mom
| Action | What it does |
|---|---|
| Remove older | deletes the **oldest** cached items first (by `cachedAt`), just until it fits. **This is the default.** |
| Delete all | nukes the **whole** cache. flagged red because, well, it deletes everything. |
| Compress all | shrinks cached **images** to reclaim room. **Music can't be compressed client-side**, so for the music cache this quietly falls back to "remove older". can cause image quality loss. |
| Don't cache anymore | stops caching **new** items once the limit is hit. nothing already saved gets deleted - playback still streams live, it just won't save. |

The "compress" thing is worth repeating: there's no honest way to re-encode audio in a WebView, so choosing it for music behaves like remove-older. Images get a real canvas re-encode down to JPEG q0.5, biggest-first, and if that still isn't enough it tops up with eviction.

---

## How forcing flows through the code

Forcing runs on every cache write and once on boot. It never blocks playback.

```
a track/image gets cached
        |
        v
media-cache.js fires  starl-track-cached / starl-image-cached
        |
        v
storage.js  checkAndEnforce(kind)
        |
        +- action = no-cache     -> pause writes for this kind if spent >= cap, done
        |
        +- (any other action)    -> make sure writes are un-paused, then:
        |
        +- spent <= cap ?        -> nothing to do, done
        |
        +- delete-all            -> wipe this cache
        +- compress (image)      -> re-encode biggest images, then evict if still over
        +- compress (music)      -> fall back to remove-older
        +- remove-older          -> drop oldest until it fits
```

`kind` is `'music'` or `'image'`. The "no-cache" action is the only one that ever pauses writes - `setCachePaused()` on the media cache flips a flag that `cacheTrack` / `cacheImage` check before saving. Switch away from no-cache and the next enforce pass un-pauses it automatically.

Changing any setting runs everything through `setSettings()`, which persists, re-runs enforcement with the new caps, and fires `starl-storage-updated` so the open page redraws itself.

---

## The native plugin

Real device numbers can't come from the WebView, so there's a tiny Cordova plugin for it: [cordova-plugin-starl-storage](../../local-plugins/cordova-plugin-starl-storage/). One action, no permissions, read-only.

```
window.StarlStorage.getDeviceStorage(success, error)
        |
        v
StorageManager.java  (off the UI thread)
        |
        +- StatFs on the data partition   -> totalBytes, freeBytes
        +- walk the app's own data dir     -> appBytes
        |
        v
success({ totalBytes, freeBytes, appBytes })
```

And because the whole feature should still render while you're poking at it in a plain browser, [storage.js](../../www/js/client/data/storage.js) falls back to `navigator.storage.estimate()` when the native plugin isn't around. The numbers are approximate on that path - the true device totals only show up on an actual build - but the page still works instead of exploding i guess...

---

## Persistence (local-only, on purpose)

Unlike Smart Queue or appearance settings, storage limits are **not server side**. They live only in `localStorage` under `starl_storage_settings`.

Why? Free space is a per-device thing. A 40% cap on a 256 GB phone and a 40% cap on a miserable 32 GB phone are completely different amounts, and syncing one phone's "8 GB total" onto another that doesn't have 8 GB free would be nonsense. So each client keeps its own limits and that's it.

On app boot the settings get run through `reconcile()` (heheh, funny name), which clamps the percents to 0-100, checks the modes/actions are real and genuine and truthfull.. because it's suspicious, and swaps any junk back to its default - so an old or half-written blob can't brutally explode with garbage.

---

## Reusable hooks added elsewhere

The feature lives in its own files, but a few **generic** primitives got added to [media-cache.js](../../www/js/client/data/media-cache.js) so this - and anything future - can poke the cache properly:

| Added to `starlMediaCache` | Purpose |
|---|---|
| `listTracks()` / `listImages()` | one `{key, bytes, cachedAt}` row per item, for picking what to evict |
| `removeImage(key)` | delete one cached image (mirrors the existing `removeTrack`) |
| `putImageBlob(key, blob)` | swap an image's blob in place (used by the compress action) |
| `getImageRecord(key)` | read one image record back out |
| `setCachePaused({audio, image})` | the flag the "don't cache anymore" action flips |

It also now fires a `starl-image-cached` event on every image write, matching the `starl-track-cached` one that already existed.

---

## Public API

`window.starlStorageManager` exposes:

| Method | Purpose |
|---|---|
| `getSettings()` | current settings (a copy) |
| `setSettings(patch)` | merge, persist, re-enforce, and notify the page |
| `getDeviceStorage()` | `{ totalBytes, freeBytes, appBytes }` (native, or estimate() fallback) |
| `collectSnapshot()` | every number the bar needs, in bytes, in one object |
| `checkAndEnforce(kind)` | bring one cache back under its cap |
| `enforceAll()` | do both caches |

`window.starlStoragePage` exposes `open()`, `close()`, and `goBack()` (the last one pops the Total size sub-view before closing, and it's what the system back button calls).

Sources: [storage.js](../../www/js/client/data/storage.js), [storage-page.js](../../www/js/client/ui/storage-page.js), [storage.css](../../www/styles/tabs/storage.css), [cordova-plugin-starl-storage](../../local-plugins/cordova-plugin-starl-storage/)

that's the lot - go fill up your cache and watch the little bar grow ;3

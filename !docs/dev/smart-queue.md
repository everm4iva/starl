# Smart Queue

This document explains what happens when a track in the queue **fails to play**, and how Starl recovers from it.

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

---

## The Problem

A queued track can fail to start for a few reasons:

- It isn't cached, and the device is **offline** (so it can never stream).
- The server doesn't answer.
- The stream request is invalid (bad URL, 404, server hiccup...).

When that happens, the player shouldn't just stop dead in the middle of a session. **Smart Queue** is the recovery policy that decides what to do instead. The user picks the policy under **"When queue fails"** in the account tab!!! wow rad and simple.

---

## The Three Modes

| Mode | Label in UI | What it does |
|---|---|---|
| `stop` | Do nothing | Playback halts. No recovery. |
| `retry` | Request again | Re-request the same track a few times (online only). If it never loads, fall through to finding the next track. |
| `findNext` | Find next cached track | Skip ahead (or back) to the next playable track. **This is the default.** |

### `retry` tuning

When `retry` is selected, two extra controls appear:

- **Attempts** - how many times to re-request (1–15, default 5).
- **Seconds between** - delay between attempts (1–120s, default 15).

Each attempt re-requests the failed track, waits ~2.5s to see if the engine got it playing, and if not, waits the configured interval before the next attempt. Retries are **online only**- if the device goes offline mid-retry, it stops and falls through.

---

## Online vs Offline behaviour

This is the key distinction in the recovery logic.

- **Offline** (device offline, *or* in cache mode - logged out, browsing cached content): an uncached track can *never* play, so a skip must jump straight to the next **fully-cached** track in the queue.
- **Online**: a failure usually means something temporary (bad URL, server hiccup, 404). Skipping straight to a cached track would jump over other tracks that could still stream just fine, so the player just moves to the **next track in line** instead.

> "Fully cached" means the media cache holds a complete `.blob` for the track. The cache is all-or-nothing, so this is the only reliable "is it playable offline" signal.

So `findNext` and the post-`retry` fallback both branch on this: cached-only when offline, plain adjacent when online.

---

## How a failure flows through the code

```
audio fails to play
        |
        v
engine-player.js  ----- unless it was a direct pick (user tapped this exact track)
        |             or a code-1 / blob-fallback error
        v
starlSmartQueue.handleFailure({ direction })
        |
        +- mode = stop      -> return, do nothing
        |
        +- mode = retry     -> retryCurrentTrack() (online only)
        |                       +- recovered? done.
        |                       +- failed?  -> offline ? findNextCachedTrack
        |                                              : advanceToAdjacentTrack
        |
        +- mode = findNext  -> offline ? findNextCachedTrack
                                       : advanceToAdjacentTrack
```

`direction` is `+1` for next / auto-advance (the default) and `-1` for previous, so recovery keeps moving the way the user was already going.

A `recovering` flag guards against one failure firing recovery twice (the audio `error` event and a thrown `play()` can both arrive for the same track).

### Manual skips while offline

The next/previous buttons (and the lock-screen / notification skip buttons) also route through `starlSmartQueue.skip(direction)`:

- **Offline** -> smart queue handles it, jumping to the next/previous fully-cached track. Returns `true`. Even if no other cached track exists, it still "handles" the skip - it just stays put rather than landing on an unplayable track.
- **Online** -> returns `false`, telling the caller to do its normal adjacent skip (uncached tracks can still stream online).

This keeps the offline user from ever landing on a track that can't play. Callers mentioned btw: [queue-player.js](../../www/js/client/playback/queue-player.js) and [runtime-notifications-handler.js](../../www/js/client/playback/runtime-notifications-handler.js).

---

## Persistence & Sync

Smart Queue settings live under the `smartQueue` section of `starlAccountState`, so they're stored in the user's server-side state file (same pattern as appearance settings).

It also keeps working **offline**:

- The choice is cached in `localStorage` under `starl_smart_queue_settings`.
- An edit made while offline is flagged `pendingSync` and re-sent automatically once the server is reachable again (`starl-server-connection-state` event).
- When another device changes the setting, the `starl-account-state-updated` event adopts the new value locally.

On boot, `init()` loads the local cache first, then the server section, then plain defaults if there's nothing yet (and saves those).

Whatever it loads gets checked over by `reconcileSettings()`, which fills in any missing or junk field and clamps the retry numbers - so an old or half-saved settings blob can't jam the recovery with a bad mode or a zero retry count.

---

## Public API

`window.starlSmartQueue` exposes:

| Method | Used by | Purpose |
|---|---|---|
| `handleFailure({ direction })` | [engine-player.js](../../www/js/client/playback/engine-player.js) | Run the recovery policy when a queued track fails. |
| `skip(direction)` | [queue-player.js](../../www/js/client/playback/queue-player.js), [runtime-notifications-handler.js](../../www/js/client/playback/runtime-notifications-handler.js) | Intercept manual skips while offline; returns whether smart queue handled it. |
| `getMode()` | - | The currently active mode id. |

Source: [smart-queue.js](../../www/js/client/playback/smart-queue.js)

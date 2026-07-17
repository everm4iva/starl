# Action Modes (shuffle + loop)

So this is just some little unasked improvements that got snuck in - the shuffle and loop buttons used to do one fixed thing each, and now **you get to pick what they do**. Here we go.

*- [Back to documentation](../index.md)*

---

## The idea

Two tiny settings live under **Playback** in the account tab, right next to "When queue fails":

- **Shuffle action** - where the song you're listening to ends up when you hit shuffle.
- **Loop action** - what one tap of the loop button actually does.

Both are saved per-user and sync to server, same as Smart Queue. Defaults match the old behaviour, so nothing changes unless you go poking.

---

## Shuffle action

When you enable shuffle, the whole queue gets a normal shuffle. The only question is what happens to the **currently playing** song.

| Mode | Label in UI | What it does |
|---|---|---|
| `middle` | Keep current song in place | Shuffle everything; the current song just lands wherever it falls. **This is the default** (the old behaviour). |
| `start` | Move current song to the top | The current song jumps to the start of the queue, and everything else is shuffled *ahead of* it. |

`start` mode shuffles only the *other* tracks and then pins the current one to index 0, so what you're hearing keeps playing and the freshly-shuffled run sits right after it.

Read [queue.js](../../www/js/client/playback/queue.js) to find more about how the shuffle action is applied.

---

## Loop action

The loop button is no longer a dumb on/off. Under the hood it now has a single **loop behaviour** with three states:

| Behaviour | Icon | What loops |
|---|---|---|
| `off` | loop icon, faded | nothing |
| `song` | loop icon, solid | the current track repeats (`audio.loop`) |
| `queue` | cycle icon, solid | the queue wraps at the end, no single-song repeat |

The **Loop action** setting just decides what one tap of the button *cycles through*:

| Mode | Label in UI | One tap cycles... |
|---|---|---|
| `track` | Loop the song, not the queue | `off` <-> `song`. **This is the default.** |
| `queue` | Loop the queue, not the song | `off` <-> `queue`. |
| `multi` | Multi-action button | `off` -> `song` -> `queue` -> `off`, round and round. |

### The "stop at the end" change

Heads up, because this one changes a long-standing quirk: with the loop button **off**, the queue used to silently restart from the top forever. Now **off means off** - playback runs to the last track and stops. Looping only happens when you ask for it.

---

## How a tap flows through the code

```
tap the loop button
        |
        v
player.js  ->  cycleLoopButton()        (runtime.js)
        |
        +- reads loopMode from starlPlaybackPrefs
        |
        +- track : off <-> song
        +- queue : off <-> queue
        +- multi : off -> song -> queue -> off
        |
        v
applyLoopBehavior(next)                  (runtime.js)
        |
        +- audio.loop             = behaviour === 'song'
        +- state.queueLoopEnabled = behaviour === 'queue'
        +- swaps the button icon (.active / .loop-queue)
        +- persists the behaviour
```

The behaviour itself is **independent of the mode** - `song`/`queue`/`off` map straight to playback no matter which mode picked them. The mode only matters at tap-time to decide the *next* state. That's why changing the loop setting mid-session doesn't yank what's currently playing; the new cycle just takes over on your next tap.

At the end of the queue, [engine-player.js](../../www/js/client/playback/engine-player.js) checks `state.queueLoopEnabled`: if it's on, the queue wraps; if not, playback stops instead of looping forever.

---

## Persistence & Sync

Both settings live under the `playbackPrefs` section of `starlAccountState`, so they're stored server-side (same pattern as Smart Queue and appearance settings).

It also keeps working **offline**:

- The choice is cached in `localStorage` under `starl_playback_prefs`.
- An edit made while offline is flagged `pendingSync` and re-sent automatically once the server is reachable again (`starl-server-connection-state` event).
- When another device changes the setting, the `starl-account-state-updated` event adopts it locally.

On boot, `init()` loads the local cache first, then the server section, then plain defaults if there's nothing yet. Whatever it loads runs through `reconcileSettings()`, which swaps any missing or junk value back to its default - so an old or half-saved blob can't jam the buttons with a mode that doesn't exist.

The live **loop behaviour** (off/song/queue) is stored separately, under the existing `starl_player_repeat` key, and restored on boot by [runtime.js](../../www/js/client/playback/runtime.js). The old `true`/`false` value from before this change is migrated automatically (`true` -> `song`).

---

## Public API

`window.starlPlaybackPrefs` exposes:

| Method | Used by | Purpose |
|---|---|---|
| `getShuffleMode()` | [queue.js](../../www/js/client/playback/queue.js) | The current shuffle mode id (`middle` / `start`). |
| `getLoopMode()` | [runtime.js](../../www/js/client/playback/runtime.js) | The current loop mode id (`track` / `queue` / `multi`). |

Main source: [playback-prefs.js](../../www/js/client/playback/playback-prefs.js)

AH! forgot to mention, the font color and highlight colors are already in the **Set colors** menu, so you can change them without any extra settings!! that's it ;3
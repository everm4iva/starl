# How Lyrics Work

This document explains how Starl gets the words of a song, shows them inside the player, and lets you restyle the whole thing.

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

---

## The Idea

You're on the maximized player and open lyrics, the player **turns into** a lyrics screen. Nothing else on screen moves - only the player changes. You get one of three things:

- **Synced lyrics** - timed lines. The current line lights up as the song plays, and tapping a line jumps the song to that spot.
- **Static lyrics** - just the plain text, no timing.
- **A fallback message** - a little joke line, for when there's nothing to show - customizable btw.

The words don't come from the client. The client asks our server, the server asks [LRCLIB](https://lrclib.net) (a free lyrics database), and the answer gets cached on both sides so the next time is instant.

---

## The Main Players (Files)

### Client side

| File | What it does |
|---|---|
| `playback/lyrics.js` | The brain. Fetches, shows the lines, follows the song, handles tap-to-seek, the toggle, open/close, and the fallback messages. |
| `data/lyrics-cache.js` | Remembers lyrics on the client (in `localStorage`) so reopening a song is instant. |
| `ui/lyrics-settings.js` | The font / size / highlight / animation settings and the quotes editor. |
| `styles/lyrics.css` | The whole look of the lyrics screen and the settings sheets. |
| `js/notes/lyrics-failed.txt` | The joke lines (loading + "no lyrics" messages). |

### Server side

| File | What it does |
|---|---|
| `new-server/src/routes/lyrics.js` | The `GET /lyrics` endpoint. Asks LRCLIB and caches the answer. |

---

## Where the words come from

The client never talks to LRCLIB directly. It asks our server, every time.

```
client (lyrics.js)
   |   GET /lyrics?artist=...&track=...   (with your login token)
   |
server (routes/lyrics.js)
   |   already cached?  -- yes --> send it back
   |       | no
   |       |
   |   ask https://lrclib.net/api/get
   |       |
   |   clean up the answer, cache it, send it back
   |
client shows synced / static / fallback
```

LRCLIB hands back a chunk of HARD AND RAW COMPRESSED stuff; the server trims it down to only what we use:

```
{
  "found": true,
  "synced": "[00:35.66] Look at the stars\n[00:38.46] Look how they shine for you\n...",
  "plain": "Look at the stars\nLook how they shine for you\n...",
  "duration": 267
}
```

Each synced line is just a timestamp and text - `[00:35.66] Look at the stars` means "show this line at 35.66 seconds." `lyrics.js` reads those timestamps to know which line to light up.

### Caching (both sides) and why

Asking LRCLIB takes a moment, and hammering them on every single open would be a dick move (and they rate-limit you for it). So:

- **The server caches every answer.** A song with lyrics is kept for 30 days. A song with *no* lyrics is also cached, but only for 1 day - just in case someone adds lyrics later.
- **The client caches too, but only what you actually opened.** When the lyrics screen opens, the result is saved on the client. Reopen the same song and it shows up instantly, even offline.

### The background probe

Here's the split that matters: **when the song changes, the client quietly asks the server for lyrics in the background.** This does two things:

1. It warms the **server's** cache, so the lyrics are ready before you even ask.
2. It learns whether the song *has* lyrics at all - which is how the context menu knows to say **"Lyrics - unavailable"** instead of just "Lyrics".

The probe does **not** save anything on the client. The client only keeps lyrics once you actually open them. So: the server gets eager and grabs everything ahead of time, the client only hangs on to what you looked at.

---

## The references file

`www/js/notes/lyrics-failed.txt` holds all the little messages. It's split into sections with `--- section ---` lines, and the code only reads the lines between them:

```
--- fetch fail ---
"oops, no lyrics over here :("
"404 lyrics"

--- loading ---
"finding the words..."
"reading the artist's mind..."
```

Each time a message is needed, a random line from the right section is picked. The four sections:

| Section | When you see it |
|---|---|
| `fetch fail` | There are no lyrics at all - not synced, not static. |
| `no static lyrics` | You flipped to static, but only synced exists. |
| `no animated lyrics` | You flipped to synced, but only static exists. |
| `loading` | While the request is still going (skipped if it's already cached, since that's instant). |

The file ships with the app, but you can rewrite it yourself in settings (see below). Your edited version wins over the bundled one.

---

## Opening lyrics, step by step

```
you open lyrics (menu, or a player button)
   |
   starlLyrics.open(track)
   |   show the screen (it fades + slides in)
   |
   +-- already saved on the client?  -- yes --> show it right away
   |        | no
   |        |
   |     show a random "loading..." line
   |        |
   |     ask the server, then save the answer on the client
   |
   decide what to show:
   |   no synced AND no static  -->  "fetch fail" message
   |   synced lyrics exist       -->  show them + start following the song
   |   only static               -->  show the plain text
```

There are three ways in: the **Lyrics** row in the track menu (right under "Add to favorites"), the **note button** next to the favorite star, and the `lyrics` button in the player's bottom action row. To get out, tap the **chevron-down**. To open the track menu while you're in lyrics, tap the song title.

---

## Following the song

For synced lyrics, `lyrics.js` runs a small loop. Every frame it checks **where the song is right now** (`audio.currentTime`), finds the last line whose timestamp has passed, lights it up, and scrolls it to the middle.

**Tap a line** and it just sets `audio.currentTime` to that line's timestamp - same thing the seek bar does. (Only works on synced lyrics, since static text has no timing to jump to.)

---

## The highlight look

Two separate settings decide how the current line stands out. The JavaScript doesn't do any styling itself - it just sets two attributes on the lyrics box, and the CSS handles the rest:

CSS IS RAD ASF!!!!

- **Style** (`data-hl-type`): **Transparency** (the other lines fade out, the current one stays bright) or **Block** (the current line gets a colored background behind it).
- **Animation** (`data-hl-anim`): how the current line changes.
  - **Static** - snaps, no movement.
  - **Grow** - the current line gets bigger. ("static" = instant, "animated" = smooth.)
  - **Difference** - the *other* lines shrink instead, current stays full size. (again static/animated.)
  - **Random** - picks a different one for each song.

The two highlight colors are normal app color variables, so they already show up in the **Set colors** menu - no extra setting needed for them.

---

## Settings

Under **Appearence - Lyrics** in the "Me" tab. Five things, each opens a sheet with a live preview of how lyrics will look:

| Setting | Choices | Default |
|---|---|---|
| Lyrics font | any app font | InstrumentSans |
| Lyrics font size | 0.8rem to 1.7rem | 1.25rem |
| Highlight style | Transparency / Block | Transparency |
| Highlight animation | the six above | Grow (animated) |
| Edit lyrics quotes | rewrite the joke lines (max 254 lines) | - |

### Saving and syncing

The settings live in your account, under a `lyrics` section, same as the appearance and smart-queue settings. So they **follow you to other devices**.

They also survive being offline:

- A copy is kept on the client (`localStorage`).
- If you change something while offline, it's marked "needs syncing" and sent up the moment the server is reachable again.
- If another device changes a setting, this one picks it up and re-applies it.

On startup it loads the client copy first, then the server's, then plain defaults if there's nothing yet. Whatever it loads gets checked over - missing or junk values are filled in with defaults - so an old or half-saved settings blob can't break anything mueheheh...

---

## Summary

```
song changes      -->  client quietly warms the server cache (background probe)
you open lyrics   -->  show saved copy, or fetch + save it
                  -->  synced? follow the song, tap to seek
                  -->  nothing? show a random joke line
settings          -->  font / size / highlight, saved to your account, synced everywhere
```

The one thing to remember: the server grabs lyrics ahead of time and holds onto them; the client only keeps what you actually opened. Everything else is just showing those words nicely.

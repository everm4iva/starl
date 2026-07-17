# How the MIX system works

A MIX is a fresh, smart-built queue you can spin up any time you want more of something, without having to go build a playlist yourself. This is the full story on how one gets made.

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

See also: [How the recommendation system works](recommendation-system.md) - [Content preferences (more / less / none of this)](content-preferences.md) - [Your data and privacy](data-and-privacy.md)

---

## What is a MIX, really

Think of it as a "radio mode", but built with your own taste in mind instead of just YouTube's raw radio order. You seed it with either:

- **one track** ("Based on current track") - a mix built around that one song, or
- **your whole queue** ("Based on queue") - a mix blended from everything currently lined up.

Once it's built, it drops straight into your queue and starts playing. It's not saved anywhere by default - it's a "right now" queue. If you like it, you can save it as a real playlist (more on that below).

---

## How to create one

Tap **⋮** on any track (or open its context menu another way) and hit **Create MIX**. You'll get asked which kind you want: based on that track, or based on your whole queue. Pick one, and it builds.

If the song currently playing happens to be one of your seeds, the app is polite about it: it keeps that song playing and just swaps in the mix right after it, instead of yanking you out of the middle of a song.

---

## How it's actually built (two stages)

### Stage 1 - the server builds a pool

The client sends the seed video id(s) to **`POST /mix`**. For each seed, the server asks YT Music for that video's "start radio" list - basically "give me a bunch of stuff similar to this". A few rules keep it sane:

- Up to **5 seeds** get used (if you seed from a big queue, only the first 5 unique tracks count).
- Each seed pulls enough tracks to fill a pool of up to **120 tracks total**, split evenly across seeds.
- The seeds' pools get "interleaved round-robin" (funny) (a bit of seed 1, a bit of seed 2, a bit of seed 1 again...) so a multi-seed mix feels blended instead of "all of song A's radio, then all of song B's radio".
- Duplicate tracks (same video id showing up from two different seeds) get dropped, keeping only the first one.

That's it. The server hands back a clean, varied, de-duped pool. It does **not** know anything about your taste, your stats, or your settings at this point - it's just a fair, honest pool of "stuff similar to your seeds".

### Stage 2 - the client does the smart part

This is where your own listening habits and your **Customize MIX** settings actually shape the mix. All of this happens on your device, not the server:

1. **Drop what you skip.** Anything you've skipped a couple times while barely listening to it gets filtered straight out of the pool before anything else happens.
2. **Artists pass** - reorders the pool based on your "Artists" setting (see below).
3. **Genre pass** - reorders/filters based on your "Genre" setting.
4. **Mood pass** - reorders based on your "Scale mood" setting.

The result gets capped at 64 tracks and dropped into your queue.

---

## How to customize a MIX

Open **Account -> Recommendation system -> Customize MIX**. Three sections, pick one option per section:

**Artists**
- `Prioritize new artists` - leans toward artists you rarely hear (based on your stats).
- `Prioritize followed artists` - artists you follow show up more.
- `Prioritize followed artists and artists in queue` - same, but also boosts artists already in your current queue.
- `Random` - no preference, just shuffled.

**Genre** - a heads up first: there's no real genre data anywhere in this. YouTube doesn't hand that over, so "genre" here is an honest approximation built from artist variety and the radio order the server already gave back. It's not lying to you, it's just being upfront about its limits.
- `Shuffle different genres` - spreads artists out so you don't get 5 songs by the same person in a row.
- `Shuffle closer genres` - keeps the order close to what the radio pool already suggested.
- `Same genre only` - sticks close to the seed artist (falls back to a normal mix if that's too strict to fill 64 tracks).
- `Random` - shuffled.

**Scale mood** - same honesty here: no real tempo/BPM data exists, so this is approximated purely from track length.
- `Tempo and mood goes up and down` - zigzags between shorter and longer tracks.
- `Tempo and mood stays consistent through mix` - leaves the order the earlier passes already settled on.
- `Tempo and mood varies randomly` - fully shuffled.

Whatever you pick is saved instantly to your device, same as every other setting in the app.

---

## Saving a MIX as a playlist

While a MIX is what's currently playing, the track context menu gets an extra option: **Save Mix as a playlist**. Tap it, name it, and the whole thing gets turned into a real playlist you keep forever - the MIX itself was always temporary, but nothing stops you from keeping the good ones.

---

## One thing to know: it needs internet

Building a MIX means asking the server for a radio pool, so it can't work offline. If you're offline, the app tells you straight up instead of pretending to build something broken.

---

## Where this lives in code

| Piece | File |
|---|---|
| The actual build logic (both stages 2's passes) | [mix-engine.js](../../www/js/client/playback/sidethings/mix-engine.js) |
| The "Create MIX" chooser sheet | [mix-menu.js](../../www/js/client/ui/mix-menu.js) |
| Customize MIX settings screen | [mix-settings-page.js](../../www/js/client/ui/mix-settings-page.js) |
| Shared settings-page builder | [recommendation-page.js](../../www/js/client/ui/recommendation-page.js) |
| Server: the pool builder (`POST /mix`) | `new-server/src/routes/mix.js` |

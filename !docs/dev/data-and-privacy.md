# Your data and privacy (and how to manage it)

The [recommendation system](recommendation-system.md) and the [MIX system](mix-system.md) both lean on one thing to feel personal: a little score of what you actually listen to. This page is the full, honest breakdown of what that score is, where it lives, and how you stay in control of it.

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

See also: [How the recommendation system works](recommendation-system.md) - [How the MIX system works](mix-system.md)

---

## What actually gets counted

While you use the app, a small piece of code (think of it as a quiet messenger, not a spy) notices a handful of things and reports them:

- **Track clicks** - you tapped a song to play it.
- **Listened seconds** - real wall-clock time the song was actually playing. Seeking around doesn't inflate this, and pausing doesn't count either.
- **Skips** - you moved off a track after hearing less than 20 seconds of a song that was long enough to matter.
- **Album clicks / artist page opens** - you opened an album or an artist's page.

That's the whole list. No raw audio, no screenshots, no what-you-typed, no background snooping. Just counts and seconds, tied to a track/artist/album, nothing more.

These get batched up and sent to the server every few seconds (not on every single click, so it's not chatty), and also right before the app closes or goes to the background, so nothing gets lost.

---

## Where it's stored

One small file per user, on the server, keyed to your account. Nothing shared between users, nothing mixed together. It holds three simple buckets: `tracks`, `artists`, and `albums`, each just a list of counters (clicks, opens, seconds listened, skips, plays) per thing.

There are also some quiet safety rails built in on the server side, mostly to stop a broken or messed-with client from ever growing this file forever or claiming something silly like "I listened for 400 hours in one go":

- A single listen event can't claim more than 6 hours.
- Text fields (titles, names) are capped at a sane length.
- Each bucket (tracks/artists/albums) is capped at 4000 entries - if it's full and something new comes in, the least useful old entry (least seconds/clicks) gets dropped to make room.

None of that is about limiting you, it's just basic "don't let one weird request blow up a file" hygiene.

---

## What it's used for

Only two things, both explained in more detail on their own pages:

- The [MIX system](mix-system.md) reads it to know which artists you're already familiar with (for the "new artists" preference) and which tracks you keep skipping (so it can leave those out).
- The **Pick up albums** and **Pick up artists** rows on your home page read it to figure out what you've been into lately.

That's it. It's not sold, not shared, not looked at by anyone, not used for ads (there are no ads). It exists purely so the app can be a little smarter about what it shows you, on your own device, using your own numbers.

---

## How to manage it

Open **Account -> Recommendation system**, you'll find three rows there:

- **Data collection** - toggle it **On** or **Off**. Off means the server stops recording anything new starting right then. It does **not** delete what's already there, it just stops adding to it. Flip it back on whenever you want.
- **Clear all collected data** - wipes your whole score on the server, completely and for good. The app double checks with you first ("This wipes your listening score on the server. It cannot be undone.") since there's no undo button for this one.
- **Export all statistics data** - pulls your whole score down as a `statistics.json` file, saved right to your device. It's your data, so you get a copy of it whenever you want, no questions asked.

Turning collection off and clearing your data are two separate buttons on purpose: you might want to stop new tracking while still keeping your existing score around (or the other way, wipe everything but keep collecting going forward). Your call either way.

---

## Where this lives in code

| Piece | File |
|---|---|
| The client-side messenger (what gets counted, when it flushes) | [stats-tracker.js](../../www/js/client/data/stats-tracker.js) |
| The three buttons under Account -> Recommendation system | [stats-settings.js](../../www/js/client/ui/stats-settings.js) |
| Server: the routes (`GET/POST/DELETE /stats`) | `new-server/src/routes/stats.js` |
| Server: the actual counters + safety rails | `new-server/src/stats/stats-store.js` |

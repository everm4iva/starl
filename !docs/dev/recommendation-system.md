# Recommendation system (the home page suggestions)

This one explains the stuff that shows up on your home tab without you asking for it - the rows that go "hey, maybe you'll like this too".

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

See also: [How the MIX system works](mix-system.md) - [Content preferences (more / less / none of this)](content-preferences.md) - [Your data and privacy](data-and-privacy.md)

---

## What it actually is

There's no big AI brain running this. It's four separate little rows on the home tab, each doing one simple job:

| Row | What it shows |
|---|---|
| **Recommended** | A few tracks similar to the last thing you played, or by the last artist you played. |
| **New releases** | Fresh singles/albums from artists you follow. |
| **Pick up albums** | Albums you've been playing a lot lately, resurfaced so you don't forget them. |
| **Pick up artists** | Artists you've been playing a lot lately, same idea. |

Each row can be turned off on its own. If a row has nothing good to show (you're offline, you have no history yet, whatever), it just hides itself instead of showing an empty box.

---

## How each row works

**Recommended** looks at the newest thing in your listening history, grabs its video id, and asks the server for a small pool of similar tracks (the exact same pool-building the [MIX system](mix-system.md) uses). It only re-asks the server when your last-played track actually changes, so it's not hammering anything.

**New releases** looks at who you follow, asks the server for each followed artist's page (singles, and albums if you asked for those too), and sorts everything by release year, newest first. It caches an artist's releases for 30 minutes so flipping through the app doesn't re-fetch the same thing over and over.

**Pick up albums** and **Pick up artists** don't call the server for anything new - they just read your existing listening stats (see [Your data and privacy](data-and-privacy.md)) and rank whatever you have the most listened-seconds and clicks on. Only entries with a cover picture get shown, so a card is never just blank text.

---

## How to customize it

Open **Account -> Recommendation system -> Customize Home page**. You get four little sections, pick one option in each:

- **General** - `No recommendations` / `Recommend based on last track` / `Recommend based on last artist`. This controls the "Recommended" row.
- **New releases** - hide it, show only followed artists' singles, or show singles AND full albums too.
- **Pick up albums** - yes or no.
- **Pick up artists** - yes or no.

Whatever you pick is saved right away and synced to your account, so it follows you to your other devices too. No save button needed, just tap and it's done.

---

## What the server actually does

Here's the honest part: the server doesn't have a "recommendation engine" of its own. There is no dedicated recommendation route. It's really just two existing endpoints, reused:

- **`POST /mix`** - the exact same pool-builder the MIX system uses (full breakdown in [How the MIX system works](mix-system.md)). The Recommended row just calls it with one seed (your last track) and a smaller limit.
- **`GET /artist`** - the normal artist-page endpoint, called once per followed artist to read their singles/albums for the New releases row.
- **`GET /stats`** - your saved listening score, read back so Pick up albums/artists can rank things. Nothing is computed server-side here either, the server just hands the raw numbers back and the client does the sorting.

So really: the server's whole job in "recommendations" is handing over ingredients. All the actual picking, ranking and filtering happens on your client, using your own settings and your own stats. Nothing is decided on the server and pushed onto you.

---

## Where this lives in code

| Piece | File |
|---|---|
| Customize Home page settings screen | [home-settings-page.js](../../www/js/client/ui/home/home-settings-page.js) |
| Shared helpers for all four rows | [home-common.js](../../www/js/client/ui/home/home-common.js) |
| Recommended row | [home-recommended.js](../../www/js/client/ui/home/home-recommended.js) |
| New releases row | [home-new-releases.js](../../www/js/client/ui/home/home-new-releases.js) |
| Pick up albums row | [home-pickup-albums.js](../../www/js/client/ui/home/home-pickup-albums.js) |
| Pick up artists row | [home-pickup-artists.js](../../www/js/client/ui/home/home-pickup-artists.js) |
| Shared settings-page builder | [recommendation-page.js](../../www/js/client/ui/recommendation-page.js) |
| Server: pool builder | `new-server/src/routes/mix.js` |
| Server: listening stats route | `new-server/src/routes/stats.js` |

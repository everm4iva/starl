# Content preferences (more / less / none of this)

This one is about the little "Recommend:" menu you get on the home page, and the "Configure content" page behind it. Basically: how you tell the app what you actually wanna see more or less of, and how it listens without going overboard.

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

See also: [The rate math + self-adjust](content-preferences-math.md) - [How the recommendation system works](recommendation-system.md) - [How the MIX system works](mix-system.md) - [Your data and privacy](data-and-privacy.md)

---

## The short version

Every recommendation app has an opinion about you. Most of them only know one move: you listened to a thing, so here's that thing again, and again, and again until you're sick of it.

This does the opposite. You get a tiny menu that lets you say "more of this", "less of this", or "none of this, ever" - and then the app quietly checks its own homework. If you boost something but never actually reach for it, the boost fades back to normal on its own. You listen, you like it, that doesn't mean you want it shoved at you 24/7. That's the whole idea.

None of this touches the server logic. The server just hands over the same pool of candidate tracks it always did (see the [MIX system](mix-system.md)); all the "more/less/none" shaping happens on the client, right before stuff hits your eyes.

---

## The Recommend menu

Hover a card on the home page - a track, an artist, or an album - and after a moment the "Recommend:" menu pops up. Right-click or long-press works too, if you don't wanna wait.

It's kept dead simple, no descriptions, just the moves:

| Option | What it does |
|---|---|
| **More of this** | Bumps this thing up so it shows more often. Tap it again to push it harder. |
| **Less of this** | Same but the other way - it shows up less. |
| **None of this** | Blacklist. This gets dropped from every recommendation surface, on purpose, until you undo it. - Still avaliable on search tho |
| --- | (a little line splits the reco stuff from the rest) |
| **Don't wanna see** | Just hides this card for now. It's back next time you launch the app or log in. Doesn't change recommendations at all, it's purely a "not right now" thing. |
| **Configure content** | Opens the full page below. |

There's also a **"Recommend more of this"** row inside the track menu of whatever's playing (sitting right on top of "Statistics"), so you can boost a song without going back to the home page. - The "star" button on the player page is just to add to a "favorites" playlist, it doesn't affect recommendations.

### What "surfaces" actually means

"More/less/none" only reaches the spots that are trying to suggest things to you:

- the **Recommended** row on home
- the **Pick up albums** and **Pick up artists** rows
- any **MIX** you build

It does NOT touch search, or an artist's/album's own page. If you go looking for a blacklisted thing on purpose, it's still right there - blacklist is about what gets *suggested*, not about hiding stuff from you. Your library is yours, always.

---

## The Configure content page

Open it from **Account -> Recommendation system -> Configure content**, or straight from the Recommend menu. It's a full page with three simple tabs.

### General

A cute little overview of what you actually enjoy. Top followed artists, top albums, top tracks - flip the toggle between **By hours** (real listened time) and **By clicks**. Only artists you follow show up in the artists list, so it stays about the people you actually chose.

This is read-only, it's just a mirror. All the numbers come from your listening stats (the same ones the [recommendation rows](recommendation-system.md) use).

### Removed

Everything you hit "None of this" on - tracks, artists, and albums, all together. It shows the first 5, with a "See more" if there's a pile of them.

To let something back in: hover it for 4 seconds. A little ring fills up around it, and when it's full the thing pops away and it's un-blacklisted. No accidental un-blocks from a stray tap, you gotta mean it.

### Recommending

Everything you boosted or debuffed by hand. Each row shows the cover (in its shape), the title, and for tracks an up/down arrow with a percentage and a color - green up means boosted, warm-red down means debuffed. The percentage is just how hard you pushed it.

Tap a row and you get a little menu with:

- a **slider** from 0.5x to 7x to set the strength directly
- **Boost more** / **Debuff more** to nudge it a step at a time
- **Remove item** to drop the pref and go back to normal

The exact numbers, and the self-adjusting part, are their own page: **[the rate math + self-adjust](content-preferences-math.md)**.

---

## Where it's stored

Same place as the rest of your stuff - a `recommendPrefs` section in your account state. It saves on your device first (localStorage), then syncs up to the server so it follows you across your other logins, exactly like your history and follows do (see [Your data and privacy](data-and-privacy.md)).

And because it rides on your listening score, it goes away with it: hit **Clear all collected data** and your boosts, debuffs, and blacklist get wiped right along with the stats. Clean slate means clean slate.

---

## The files, if you're poking around

| File | Job |
|---|---|
| [`recommend-prefs.js`](../../www/js/client/data/recommend-prefs.js) | the core thingy - storage, the weight math, the weekly self-adjust |
| [`recommend-menu.js`](../../www/js/client/ui/components/recommend-menu.js) | the little "Recommend:" hover popup |
| [`configure-content-page.js`](../../www/js/client/ui/configure-content-page.js) | the full page with the three tabs |

The home rows ([recommended](../../www/js/client/ui/home/home-recommended.js), [pick up albums](../../www/js/client/ui/home/home-pickup-albums.js), [pick up artists](../../www/js/client/ui/home/home-pickup-artists.js)) and the [mix engine](../../www/js/client/playback/sidethings/mix-engine.js) just ask the core thingy "should this show, and how strongly?" right before they draw - they don't hold any of the logic themselves.

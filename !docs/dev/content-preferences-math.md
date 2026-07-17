# Content preferences - the rate math + self-adjust

The nerdy half of the [content preferences](content-preferences.md) page. This is exactly how a boost or debuff turns into "how often you see something", and how the app walks it back on its own so it never poisons your taste.

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

See also: [Content preferences (the menus + page)](content-preferences.md) - [Your data and privacy](data-and-privacy.md)

---

## Levels, and what they mean

Every boosted or debuffed thing has one number attached: a **level**.

- positive level -| boosted (shows more)
- negative level -| debuffed (shows less)
- zero -| normal, so the app just forgets the pref entirely

Each whole step of level is about **10%**. So level 2 is "about 20% more often", level 7 is "about 70% more often". Same going down: level -7 is "about 70% less often". Seven is the hard cap both ways - the app won't let you go past 70%, because past that you're not really recommending anymore, you're just deleting stuff (that's what "None of this" is for).

The math, if you like it plain:

```
how_often = 1 + (level * 0.10)
```

clamped so it never drops below 0.3 (level -7) or climbs above 1.7 (level +7). A track at `how_often = 1.7` roughly cuts its wait in half; at `0.3` it waits about three times as long. Gentle nudges, never a hard reshuffle.

---

## Tapping More / Less

The first time you tap **More** on a normal thing, it snaps to level **2** (that base "about 20%"). After that, each tap adds one step:

```
2x -| 3x -| 4x -| 5x -| ... up to 7x
```

It does NOT double every tap - that'd get silly fast. It just climbs one at a time. **Less** works the exact same way, just downhill: first tap lands at -2, then -3, -4, and so on down to -7.

The slider on the Configure page is the fine-control version: it sets the strength straight, anywhere from **0.5x to 7x**, keeping whatever side (boost or debuff) the thing is already on.

---

## The self-adjust (the actual smart bit)

Here's the part that makes this different. Setting a level isn't a promise the app keeps forever - it's more like a suggestion the app then fact-checks against what you *actually do*.

Once a week, per thing, it looks back:

**For a boost:** did your clicks on this thing climb at least **20%** since you boosted it? 

- yes -| cool, you really do want more of it. The boost stays, the week resets.
- no -| you said "more" but you're not reaching for it. The boost melts back to normal. No hard feelings.

**For a debuff:** are you *still* reaching for it a lot anyway (clicks up 20%+)?

- yes -| you clearly still like it, so the debuff eases off one step at a time.
- no -| the debuff's doing its job, it stays.

So a boost you don't live up to fades out, and a debuff you keep fighting loosens up. The app meets you where you actually are, instead of just cranking the same knob harder like everything else does. It's the app going "you listen to it, you like it - but that doesn't mean you wanna hear it all the time", and actually meaning it.

### How it measures "clicks"

It reads the same listening score everything else does (see [Your data and privacy](data-and-privacy.md)):

- a **track** -| how many times you played it
- an **artist** -| how many times you opened their page
- an **album** -| how many times you clicked into it

When you set or adjust a pref, the app snapshots that number right then. A week later it compares "now" against "back then" to get your 20%. Simple as that, no spooky profiling.

### When it runs

At most twice a day (on app launch, once stats have settled), and even then it only actually judges a thing once a full week has passed since it last looked at that thing. If you're offline or you turned data collection off, it just shrugs and tries again later - it never guesses without the numbers to back it up.

---

## The knobs, in one place

All of these live at the top of [`recommend-prefs.js`](../../www/js/client/data/recommend-prefs.js), so tweaking the whole system is a one-file job:

| Knob | Value | Meaning |
|---|---|---|
| base level | 2 | where the first More/Less tap lands (~20%) |
| max level | 7 | the cap both ways (~70%) |
| slider floor | 0.5x | lowest the Configure slider goes |
| step percent | 10% | how much one whole level is worth |
| growth target | 20% | how much your clicks must climb in a week to "earn" a boost |
| review gap | 7 days | how long before a pref gets judged again |
| sweep gap | 12 hours | shortest time between two self-adjust passes |

Change a number there and the menus, the slider, and the weekly check all follow it - nothing's hardcoded anywhere else.

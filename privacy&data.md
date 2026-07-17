# Privacy Policy

- Last updated: 2026 july 9

Straight talk, no legal-speak wall of text nobody reads. This is what actually happens to your data when you use Starl, written by the one person who built it (me - everm4iva/zoe).

*- [Back to README](README.md) - [Back to documentation](docs/index.md)*

---

## The short version

- I'm one human, not a company. There's no ad team, no data broker deal, no "trusted partners" list as long as your arm.
- You log in with Google or Discord (or don't log in at all, offline mode exists) - I never see or store a password.
- The server keeps your app data (library, history, settings) so it can sync across your devices, plus a small listening-stats file used only to make recommendations and MIXes feel personal.
- Nothing here is sold, shared with advertisers, or used to build a profile of you for anyone but you. There are no ads in this app, period.
- You can turn stats collection off, wipe your stats, or delete your whole account whenever you want. Buttons for all of it live in the Account tab.

If that's all you needed, you're done reading, lol. If you want the actual detail, keep going.

---

## Who's behind this

Just me. Starl is a solo project, not a company, not a startup, nothing incorporated. That matters for privacy because there's no internal "growth team" asking for more data, no analytics vendor pushing a new SDK, no boardroom deciding your data is worth monetizing. It's one server, one codebase, one person accountable for it.

---

## Signing in

Starl uses OAuth through Google or Discord (via Supabase, the auth provider handling the handshake). When you sign in:

- Google/Discord hand back a token proving who you are.
- I never see, ask for, or store your password. That's handled entirely by Google/Discord/Supabase, not by me.
- From that login, the server keeps: a random account id (a UUID, not tied to anything else), your email, your display name, and your profile picture URL - whatever your provider gives up.

Don't want an account at all? There's an **offline / cache mode**. You can browse and play whatever's already cached on your device with zero login, and nothing about you touches the server in that mode.

---

## What the server actually stores

Here's the honest, itemized list - no vague "we may collect information" nonsense.

| What | Why it exists |
|---|---|
| Account id, email, display name, profile picture | So the app knows it's you and can show your name/avatar. |
| Your app data - library, playlists, likes, follows, history, playback settings, appearance | So your stuff syncs across every device you log into, instead of living and dying on one phone. |
| Listening stats (play counts, listened seconds, skips, artist/album opens) | Feeds the [recommendation system](docs/dev/recommendation-system.md) and [MIX system](docs/dev/mix-system.md) - see below, this one's opt-out. |
| Search click history (which result you picked for a search) | Makes your own future searches rank better. It's per-account, it doesn't leak into anyone else's search results. |
| Cached songs and images | This one is **not personal data** - it's a shared cache keyed by the song/image itself, not by you. If ten people play the same song, it's stored once, not ten times. Nobody can look at this cache and tell it was you who played it. |

Full breakdown of the stats specifically (what counts, the safety limits, how to manage it) lives in [Your data and privacy](docs/dev/data-and-privacy.md).

---

## What does NOT happen here

Being direct about the negative space too, since that's the part most policies dance around:

- No ads. No ad SDKs. No ad ids.
- No selling or renting your data to anyone, ever.
- No IP address logging. The server doesn't run a request logger - only internal error messages get logged, and those don't carry your identity.
- No tracking you across other apps or websites.
- No reading your messages/mic/contacts/whatever - the app doesn't ask for permissions it has no reason to need.

---

## Third parties involved

I can't pretend nothing external touches this, so here's exactly what does:

- **Supabase** handles the OAuth handshake and issues your login token. They see what Google/Discord tell them during login, per their own privacy policy.
- **Google / Discord** (whichever you picked to log in with) see that you logged into "Starl", same as logging into any app with their button.
- **YouTube / YT Music** is where the actual music and metadata come from. The server fetches on your behalf, so YouTube sees requests coming from the server, not directly from your device.

That's the whole list.

---

## How long stuff sticks around

- Your app data and stats stay until **you** clear them or delete your account. No secret expiry timer quietly wiping your playlists.
- The shared song/image cache gets swept automatically in the background (a "janitor" job cleans up stale temp files every 10 minutes or so), but that's cache housekeeping, not deleting your personal stuff.

---

## Managing or deleting your data

All in the **Account** tab:

- **Account -> Recommendation system -> Data collection**: flip stats tracking off. Off means off, nothing new gets recorded starting that second.
- **Account -> Recommendation system -> Clear all collected data**: wipes your listening stats file for good, no undo.
- **Account -> Recommendation system -> Export all statistics data**: pulls your whole stats score down as a `statistics.json` file. It's your data, you can have a copy of it.
- **Account -> Profile & Privacy -> Delete account**: removes your profile, library, history, playlists, follows and settings from the server, permanently (you type "DELETE" to confirm, on purpose, so it's not an accidental tap).

One honest heads-up on that last one: account deletion clears your profile and app-state files, but your listening-stats sidecar is stored separately and isn't swept up by that same delete pass right now. If you want a fully clean slate, hit **Clear all collected data** too before (or after) deleting your account. Being upfront about that instead of pretending it's flawless :)

---

## How it's actually secured

Not going to oversell this: your data sits in encrypted plain JSON files converted to .ed format (encrypted data) on the server's disk, What actually protects it is that every request needs a valid login token tied to your account id, so nobody can just wander in and read someone else's file without being logged in as them.

The server itself isn't hosted on some third-party cloud either - I run it myself, on my own hardware. No AWS, no Google Cloud, nobody else's terms of service sitting between your data and me.

---

## Kids / age

Starl doesn't have an age gate, but it's also not built or marketed at children. If you're a parent and this concerns you, the OAuth login (Google/Discord) already carries whatever age protections those platforms enforce on their end.

---

## This policy can change

If Starl grows features that touch data differently, this file gets updated to match - no silent rewrites.

Since everything about this project is open source, you can always check the [commit history](https://github.com/everm4iva/starl/commits/main) on this exact file to see what changed and when. That's a receipt a normal privacy policy PDF can never give you lol.

---

## Questions?

Open an [Issue](https://github.com/everm4iva/starl/issues) and ask. I'd rather answer a "wait, what does Y actually do" question directly than have you guess.

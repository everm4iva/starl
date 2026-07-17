# User Guide

*- [Back to documentation](./index.md)*

---

## Installation

Starl is not on any app store - and never will be. To install:

1. Download the latest `.apk` from the [Releases](https://github.com/everm4iva/starl/releases) page.
2. On your Android device, go to **Settings -> Security** and allow installation from unknown sources.
3. Open the downloaded `.apk` and tap **Install**.


## Logging in

Starl uses OAuth via **Google** or **Discord** - no passwords stored anywhere. Tap your preferred option on the welcome screen and a little **Choose a server** sheet pops up first, listing every public server that's out there. Pick one and the app opens a browser for you to complete the login on that server, then returns automatically.

Each server in the list shows a little colored status dot so you know what you're picking:

| Status | Color | Meaning |
|---|---|---|
| Online | green | good to go, tap it |
| Offline | grey | not up right now, can't connect |
| Unavailable | red | up, but not taking connections |
| In repair | orange | someone's fixing it |
| Updating | blue (pulsing) | mid-upgrade |

Tap anything that isn't online and Starl just tells you straight up it can't connect right now, no weird native popup, just its own little message. And if a server's running an older version than your app, you can still pick it, Starl just gives you a heads up first that some features might not work there.

But!!!!! Also you can log in without an account (offline mode) any time! There is a button for it. In this mode you only have access to cached content but can't request new content from the server.

Prefer your own server? There's a **Connect to server** button too, for pointing the app at a self-hosted one instead of picking from the public list.

## Playing music

- Tap any track to start playing.
- The **mini-player** appears at the bottom while music is playing - tap it to expand the full player.
- Use the **shuffle** and **repeat** buttons in the full player to control playback mode.
- Lyrics and favorite button are right there in the player. Easy to access.
- Music keeps playing in the background - control it from the notification.

## Offline listening

Starl caches songs and images as you listen. Once a song has been played, it's stored locally and will play again without a connection. There is no manual download option yet - caching happens automatically :)

Don't worry - the app will never delete your cached songs without asking first. You can manage the cache under **Account -> Storage**.

And there is this really cool stuff that lets your music just keep playing even if a track fails to load - check out **Account -> Settings -> When queue fails**.

## Library

- The **Library** tab holds your playlists, liked songs, artists/albums of your library and listening history.
- **Star** a track to add it to your favorites.
- Tap **⋮** on any track to open the context menu (add to playlist, view album/artist, etc.).
- Click the "+" on the top to create a playlist or import one from Spotify or Youtube. You can also export your playlists.
- On the top search bar, you can search for tracks, albums and artists across the whole library.

## Search

- Use the **Search** tab to find songs, artists, albums, and community playlists!
- Recent searches items are saved and shown when you open the tab.

## Account

- Your profile picture and username sync automatically from your Google or Discord account.
- Log out from the **Account** tab at any time.
- You can easily delete your account from the **Account** tab at any time.
- In that tab you can costumize app's behaviour, appearence, playback settings, storage and way more!

## Gestures

Starl is gesture-driven. The system back button is not used (tho it works too):

| Gesture | Action |
|---|---|
| Swipe right on a page header | Go back |
| Swipe up on mini-player | Expand to full player |
| Swipe down on full player | Minimize to mini-player |
| Swipe down on mini-player | Close currently playing track |
| Swipe right on mini-player | Play next track in queue |
| Swipe left on mini-player | Play previous track in queue |
| Long-press on a track / tap ⋮ | Open context menu |
| System button | Close app, minimize player, previous page |
| Swipe left on a playlist track | Remove track from playlist |
| System button | Close app, minimize player, previous page |

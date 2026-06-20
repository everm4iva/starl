# Changelog for Starl Client

# ☆ Alpha 0.1.2 (2026-06-19)
- "The music never stops"

## New stuff
- Redesigned account page
- Share YouTube/YTMusic links directly to Starl and play them instantly.
- Offline mode in login. Now you can log in without internet connection or authentication and listen to your cached content!
- New settings! Profile name/picture set, Colors, Transitions (time and type) and fonts type!
- Reset track cache: In case there is any issues, now you can reset the track cache! Just pop up the context menu of your track -> Statistics - > Reset cache. This will remove all cached files and data, so the next time you play a song it will be like the first time, downloading the file again and caching it from scratch.
- Smart queue skipping setting: handles skip operations by jumping straight to the next/previous cached track, never stopping the playback.
- Swipe right in update banner to dismiss it for the current session.
- Swipe left in a playlist track to remove it.

## Fixed
- App crashing on log in/out.
- Unstable queue playback Inside albums
- Media Notification issue: when music stops, all playback stops as well and app closes
- Artist/album pages mixed content with other albums/artist with same name (now uses Channel-ID/Album-ID)
- Playback has fake ending when song is not fully cached.
- Albums fetched via context menu on currently playing track now shows real info instead of cached tracks.
- Artist page profile picture was searching by name and not by channel ID, causing wrong profile picture when there were artists with the same name.
- Artist page filters: filter "newest" works the same as "popular".
- Album follow system - now only followed albums are show in library.
- Cannot remove artist/albums from library. Now you can unfollow artists and albums and have more options on how to remove them (remove all songs or just unfollow/unsave them).
- Recents section in search tab was showing history and not actual searches.
- System back button not working in some versions of android
- Track context menu "view artist" goes to fake page.
- No "currently playing" indicator in track lists.
- Update modal appearing when offline.
- Library: no image covers in playlist item on view list mode.

## Tweaks and optimizations
- Now search results are ranked by numer of clicks (server side), so the most clicked songs by the users will be shown first.
- Album/Artist list now show a grid of 3 instead of 2, showing more content and making it look better.
- When offline, library and artist/album pages will only show totally cached content as available (visually).
- Artist & albums appear in "recents" section of search tab.
- Dynamic Time bar (small when not active, big when pressed), for a cleaner layout **(create issue to request removal)**
- Search results now are cached, should be faster after the first search.
- Search results/image loading/steaming are now near instant! from 17s~ (total average) to 2s (new server) - thats like 85% faster than before!
- Now everything totally async and parallel (server side, this time for real)

## Server updates
- Now the server has a new way of putting your client experience in the next level: BATCH CACHE! what is this? When you listen to a song in a queue, the last and next 8 tracks are cached in the background (server side), so when you just click skip, you don't have to wait for the song to download anymore!
- Search functions now handle better.. uncommon names like if you type "r u s s" it will understand that you mean "russ" and vice versa.
- Changed the WHOLE ARCHITECTURE of the server, now instead of full python, it's a Node/Express brain that handles all the requests and a Python worker that resolves the tracks and fetches the data. This makes the server way faster and more stable, and also allows for future features like multi-worker support, better caching and way more!

## For developers:
- Added documentation about streaming in `/docs/how-sys-streaming-works.md`.
- Supa cool command: "npm run rebuild", that just rebuilds the app, clears build cache (aka: old code), installs every plugin again easily.
- Now server does a really cool stuff with search: vowels and word sounds! that means if you wanna search "cat" but write "kat", it will still find stuff! :O
- The playback subsystem has only one holdout still using bare globals
> now routes all shared mutable state through one owner, window.starlPlaybackState, matching the IIFE-singleton pattern between others implemented in the app.
- localStorage: each key now has exactly one owner
> engine writes PLAYER_STATE_KEY, runtime writes REPEAT_STATE_KEY, both via the singleton's key constants - same style as account-state/media-cache. no caching behavior changed.
- Fixed some inconsistencies in the css code. (The use of transitions and background proprieties was kinda messy + uncommented code)

### --- Special thanks to! ---
- @pinguino : "add a soundtrack to your life and perfect it" - nujabes
- @wasSammyDev - he just reacted :fire: emoji to a feature i presented, he unironically deserves to be here.
- @SubhrajitSain - "good app. me like."
- @InkChasm - "green - chasm"

also! a quick word: [update-note.txt](./update-note.txt)

# ☆ Alpha 0.1.1 (2026-06-05)

### --- Added ---
- System back button: minimizes player, closes overlays, navigates back
- Custom splash screen via StarlSplash plugin (replaces Cordova default)
- Missing symbols and action variables in plugins
- Skip-previous and skip-next actions on the system media notification
- Gesture: click in timebar to go there.
- System status bar now transparent, showing what's behind it while showing your notification badges, battery level etc..!
- Statistics (for each track) has now more details: duration, cached (percentage), file size, videoID and track key! + Reset track cache in case of currupted files/streaming issues.

### --- Improved ---
- Faster server: parallel queries, advanced image/track indexing, artist page caching
- Smoother playback: songs start twice as fast, smarter cache system
- Better code comments and CSS/HTML cleanup
- Small elements request low res images, and big elements request hi res images (for better performance)

### --- Fixed ---
- Artist/album pages mixed content when names were identical (now uses Channel-ID/Album-ID)
- "See more tracks" on artist page returned false positive
- Auto-play on app start (no more jump scares)
- Session expired too frequently - now checks token locally, silent refresh before redirecting
- Tracks hidden behind bottom bar
- Limited search results
- Album library only showed cached tracks instead of full album
- Queue failing due to full URL being sent instead of track ID
- Skip-next on mini-player not working
- Track only streaming after image load.
- Track/album filter order in artist page not working
- Queue doesn't follow the current context.
- Shuffle action has now impact on the current queue.

### --- Removed ---
- Star action from search results in Recents (*open an issue to request it back*)

### --- Extras ---
- Added cute explanatory headers and modularized some long nested codes into different files!

### --- Special thanks to! ---
- @ferpen - For testing and giving honest feedback through the development.
- @Evelyn (owo.sh) - just because :3
- @Kabsaeater - HE GAVE ME A STARRR!!! I LOVE STARRZZZZZ
- @InkChasm - for the kind words and support!!
- @wasSammyDev - for the website help (tho its not ready yet, but stilll!)
- @pinguino - for all the support, encouragement and for being the person i needed to start this project in the first place <3
- @starloexoliz11 - "Testing the best music app there is :3"

## indev (day 12) - 2026-06-05
- Released Version Alpha 0.1.0!

## indev (day 11) - 2026-06-04
- Some optimizations and bug fixes
- Documented features and code for the release
- Preparing official release (alpha version).

## indev (day 10) - 2026-06-03
- Added artist & album pages.
- Full search feature with filters and sorting.
- Polished some bugs and UI details.
- Added playlist features (create, edit, delete, add/remove songs).
- Polished gestures and interactions across app.

## indev (day 9) - 2026-06-02
- Added full design and function for library
- Added context menu for tracks
- Developing search page..

## indev (day 8) - 2026-06-01
- nothing, no development today, just relaxing and planning the next steps for the project.

## indev (day 7) - 2026-05-31
- server side caching & optimized streaming system
- Better handler for notifications (play/pause, next, previous, etc) that works even when the app is closed.
- favorite playlist & star icon interaction
- Syncronize user data with server, so when the user log in with another device, all their data is there (playlists, liked songs, search history, etc).

## indev (day 6) - 2026-05-30
- documented and organized client & server code.
- Polished a bit the UI, added some animations and transitions, and fixed some minor bugs.
- tweaked some gesture features.

## indev (day 5) - 2026-05-29
- Now server caches songs way better and smoother
- Sreaming system optimized, songs start playing almost instantly, even if they are not cached on the device.
- Added "favorite" function + playlist.
- Polished a bit of the plugins to the client, now it interacts flawlessly even when the app is closed.
- Implemented a better storage for the cache and designing some settings for the future.

## indev (day 4) - 2026-05-28
- Polished a bit the cache, so when offline it won't try to request the server when a resource is cached on the device.
- Cleaned code structure, made it modular and documented. (For client and server)
- Redesigned login page
- User data now syncronizes in the server! (It uploads when back online, and downloads when logging in)
- Made the initial screen desing + history access in home screen

## indev (day 3) - 2026-05-27
- Added successfully the google & discord auth system - omgomgomg
- Added notifications for the music player, background process is working well, music keeps playing even if the app is closed.

## indev (day 2) - 2026-05-26
- Music player works!
- Polished google auth for now

## indev (day 2)- 2026-05-25
- Search function implemented on the server, client testing shows positive results.
- Working in implementing basic playback functionality on the client side, but still in early stages

## indev (day 1) - 2026-05-24
- First commit of the project. Only includes basic info files, planning documents and web mobile client prototype.

## indev (day 1) - 2026-05-23
- Server prototyping started. Basic fetching and storing data system ready.
- Mobile client prototyping started. Basic UI interaction and elements, but no functionalities yet.

## indev (first day) - 2026-05-22
- Official start of the project. I have the base cordova project for now

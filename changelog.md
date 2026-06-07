# Changelog for Starl Client

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

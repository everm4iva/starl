# Talking to the server (API)

_- [back to server docs](readme.md)_

This page is for anyone poking at the server directly, or just curious what the client is actually saying to it. Everything here is on the **api port** (6912 by default) unless it says otherwise.

Two kinds of endpoints: the open ones (no login needed) and the protected ones (need a token). Protected ones want the access token in a header:

```
Authorization: Bearer <access_token>
```

## ☆ Open endpoints (no login)

- `GET /health` - the heartbeat, returns `{"status":"ok"}` if the server's alive. This is what a ping uses.
- `GET /info` - who the server is: name, description, picture, version, min version, and the auth mode. This is how a client learns what login to show.
- `GET /auth/mode` - just the auth mode and whether signups are open.
- `GET /point.json` - the version manifest.
- `GET /test` - a tiny built-in page for poking at search and playback by hand.
- `GET /login` - a simple built-in login page that matches whatever mode you're in.

## ☆ Getting in

- `POST /auth/register` - make an account (userpass mode only). Body: `username`, `password`, and an optional `client_name`.
- `POST /auth/login` - log in. What you send depends on the mode:
  - none: nothing needed
  - pin: `{ "pin": "4823" }`
  - password: `{ "password": "..." }`
  - userpass: `{ "username": "...", "password": "..." }`
  - and you can always tuck in a `client_name`
  - you get back an `access_token`, a `refresh_token`, and the `user`
- `GET /auth/me` - who am i? - reads your token and tells you.
- `POST /auth/logout` - kills the current token for good (cutely violent)
- `POST /auth/refresh` - trade a `refresh_token` for a fresh `access_token`, so you don't have to log in every week.

## ☆ The music stuff (needs a token)

These are what the client leans on all day. Not going to list every field here, just what each one is for:

- `POST /search` - search for songs, artists, playlists, channels
- `POST /download` - get a song ready and hand back a stream url
- `GET /stream/:audio_id` and `GET /proxy/:audio_id` - the actual audio streaming
- `GET /image/:image_id` and `GET /imgres/:image_id` - cover art and pictures
- `GET /lyrics` - lyrics for a song
- `GET /album`, `GET /artist`, `GET /artist/songs`, `GET /playlist` - browsing
- `POST /mix` - the mix / radio feature
- `GET /live/manifest`, `GET /live/segment` - live streams

## ☆ Your account and data (needs a token)

- `GET /account/state`, `PUT /account/state` - your saved state (playlists, history, favorites)
- `GET /account/settings`, `PUT /account/settings` - your settings
- `POST /account/settings/picture`, `GET /account/settings/picture/:user_id` - your profile picture
- `GET /account/export` - export your account
- `DELETE /account/delete` - delete your account
- `GET /stats`, `POST /stats/event`, `DELETE /stats` - listening stats

## » A note on the min version gate

If a client sends a version older than your `limits.min_version`, the server turns it away with a "please update" instead of letting it hit endpoints that might've changed. The open endpoints above (health, info, login, and friends) are always allowed through, so an outdated client can still be told to update in the first place.

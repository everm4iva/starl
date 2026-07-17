# The web page + status

_- [back to server docs](readme.md)_

Da server serves a little website of its own, and it lives on the **page port** (6910 by default), kept separate from the api so the two never step on each other.

## ☆ The web folder

Everything the site is made of sits in `web/`, as plain html, css and js. It's yours to edit. Change the colors, rewrite the text, throw in your own page, whatever. The server just serves whatever's in there, it doesn't care what you do to it - it's your little space.

Open `http://your-server:6910` in a browser and you'll see it.

If you ever empty the `web/` folder, the server drops in a tiny fallback page so there's still something to look at. But the real site ships in `web/` and it's meant to be messed with.

## ☆ The status page

The page that shows up by default is a little status card. It reads a small file the server exposes and shows you, live:

- the server name, description and picture
- the version, and the oldest client version allowed in
- how long the server's been running
- how much memory it's using
- the api and page ports

It refreshes every few seconds, so you can leave it open and watch, the server is so cute lol

## ☆ status.json

The status page draws itself from `http://your-server:6910/status.json`. It's just plain public info, no login needed. If you're building your own dashboard or you just wanna peek, hit that url.

Quick heads up: `status.json` is on the **page port**. The client app instead reads server info from `/info` on the **api port**, because that's the port the client already talks to. Same idea, two doors, one for browsers looking at the cute page, one for the client that only knows the api port. More on that in [the API page](api.md).

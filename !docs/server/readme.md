# The Starl Server

_- [back to all docs](../index.md)_

So you wanna run your own Starl server? Nice. This is the little book that explains the whole thing. The server is a small program you drop in a folder and run, and it turns that folder into a full music backend the client can talk to.

Heads up: this is the *public, self-hosted* server, the one anybody can run. It lives in `server/` directory. It is not my private public server, it's the copy made for you to own and mess with.

## ☆ Start here

- [How it works](how-it-works.md) - what has inside and what happens the first time you run it
- [The config file](config.md) - every setting in `config.yaml`, explained plain
- [Login modes](login-modes.md) - none, pin, password, or full accounts, you pick
- [The cache](cache.md) - where the audio, images and lyrics live, and how to tame it
- [The web page + status](web-and-status.md) - the little site and the live status page
- [Talking to the server (API)](api.md) - the endpoints a client uses
- [Connecting a client](connecting.md) - how the app points itself at your server
- [Troubleshooting](troubleshooting.md) - when it says "offline" and other headaches

## » So.. the 1 minute version

1. You run the server program in an empty folder.
2. It unpacks itself: a `config.yaml`, a `data` folder, a `cache` folder, a `web` folder.
3. You open `config.yaml`, set a name and how people log in, save it.
4. You start it again, and now the client can connect and play music.

That's basically it. The rest of these pages just go deeper when you actually need them :3

# How the server works

_- [back to server docs](./readme.md)_

The server looks like one program, but inside it's really two little helpers working together, plus a folder it calls home.

## ☆ The two helpers

**Da core (Node).** This is the part the client actually talks to. It handles logins, serves audio and images, keeps the accounts and stats, all that. Think of it as the front desk.

**The worker (Python).** This one does the heavy digging: finding songs and pulling audio (it leans on yt-dlp and ytmusicapi to fetch things). The core hands it jobs and it reports back.

Da core starts the worker for you by default, so you only ever run one thing. If the worker falls over, the core just brings it back up.

## ☆ What happens the first time you run it

The first run is kinda the fun part. The server unpacks itself right into the folder you ran it from:

- `config.yaml` - your settings, made fresh with a private login secret baked in
- `data/` - the server's own memory: accounts, stats, saved state
- `cache/` - everything the worker makes: audio, images, lyrics, plus its own little `cache/config.yaml`
- `web/` - a plain website you can open and edit
- a desktop shortcut - only when it's a real built program, not while testing from source

It also prints a "raw log" in the terminal the second it boots, so you can see exactly where everything landed and which ports it grabbed.

Run it again later and nothing gets "sdbfsdagfagf" (messed up with). It only fills in whatever's missing and leaves your stuff alone.

## ☆ The three ports

- the **api port** (6912 by default) - where the client talks to the server
- the **page port** (6910 by default) - where the little website and status page live
- the **worker port** (6913 by default) - internal, just the brain talking to the worker

> Quick note: not a "69" joke. Just wanted something unusual that wouldn't conflict with other apps.

You can change any of them in [config.yaml](config.md).

## » Where's my data?

Right there in the folder, in plain files, one file per thing. No database to install, no cloud... you can literally open `data/users.json` and read it. Back it up by copying the folder. Move it by moving the folder. It's yours, fully.

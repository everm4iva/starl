# How to build it

_- [how the packaged build works](how-this-works.md)_

The short version: `npm run build`. This is the long version, what that actually does and what
you need before running it.

## ☆ What you need first

- Node 20 or newer
- Python 3, plus the worker's own packages and `pyinstaller`:

```
npm run build:worker:deps
```

(that's just `pip install -r worker/requirements.txt pyinstaller` under the hood)

- The regular node dependencies:

```
npm install
```

## ☆ One command, four steps

```
npm run build
```

runs these in order, you can also run any one on its own if you're just fixing that one part:

- **`build:bundle`** - squashes VIOLENTLY HGSDYFAGSOF8GD the `src/index.js` into one file at `build/bundle.cjs` (esbuild)
- **`build:sea`** - turns that bundle into a real exe at `dist/<platform>/starl-server(.exe)`
- **`build:worker`** - freezes the python worker into `dist/<platform>/worker/starl-worker(.exe)`
  (PyInstaller)
- **`build:assemble`** - copies `web/` in, and does a tiny separate `npm install` of just
  `sharp` into `dist/<platform>/native/`, so the image resizing still works standalone

`<platform>` is whatever OS you ran the build on, `win32`, `linux`, or `darwin`.

## ☆ Where it lands

```
dist/<platform>/
  starl-server(.exe)      <- the real exe, this is what you run
  worker/
    starl-worker(.exe)    <- the frozen python worker
  native/
    node_modules/sharp/   <- sharp's own little install, just for image resizing
  web/                    <- the editable website, copied straight from server/web
```

Hand someone that whole `dist/<platform>` folder (or zip it up), and `starl-server(.exe)` is the
one they double click. First run drops a `config.yaml`, `data/`, and `cache/` right there beside
it, same as running from source, see [how it works](../!docs/server/how-it-works.md) for what
that first run actually does.

## » Building for other OSes

PyInstaller and node's SEA step both only make a binary for the OS you're currently on, there's
no cross-building a linux exe from windows or the other way around.

## » Testing it worked

Run the exe, then from any browser on the same machine:

```
http://127.0.0.1:6912/health      -> {"status":"ok"}
http://127.0.0.1:6910/status.json -> the server's status page json
```

If both come back clean and the terminal printed `resolver worker is healthy`, the whole thing,
node exe, frozen worker, and sharp, all found each other and it's good to go :3

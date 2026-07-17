# How the packaged build works

_- [how to build it](how-to-build.md)_

So this folder can run two different ways: straight from source with plain node, or as one
standalone exe nobody needs node or python installed for. This doc is about that second part,
how a folder full of source somehow turns into one file you can just hand someone. Honestly
kinda magic from another timeline the first time you see it work, ngl.

## ☆ One flag decides everything

Every part of the code that acts differently when packaged checks the same thing:
`process.env.STARL_PACKAGED === '1'`. Not a build tool's own flag, not a guess, just that one
env var. Dev never sets it, so dev always takes the "normal" path. The bundle step (below)
sets it as the very first line that runs, so by the time any of my code executes, it already
knows which world it's in.

Three places lean on it:

- `config-file.js` - where's home? packaged means the folder the exe sits in, dev means the
  package root (one up from `src/`)
- `worker-process.js` - how do i start the worker? packaged means run the frozen worker exe,
  dev means `python worker/worker.py`
- `native-require.js` - where's `sharp`? packaged means a `native/` folder sitting next to the
  exe, dev means the normal `node_modules`

One flag, three files, done. I know it looks like it should be more complicated than that.
It's not. I checked twice.

## ☆ The bundle

`esbuild` squashes SPANKS AND COMPRESS VIOLENTLY da `src/index.js` and everything it pulls in into one plain CommonJS file. This
matters because Node's single-executable feature (the thing that actually makes the .exe) wants
one file, not a folder of `import`s pointing at each other. NEEERDD

One catch: `sharp` is a native addon (real compiled code, not js), so it can't be squashed into
the bundle at all, it gets marked "external" and handled on its own (next section). Tried
ignoring this the first time. Did not go well. Moving on.

Another catch: once bundled, `import.meta.url` goes empty (CommonJS just doesn't have it), so
anything that used it to find its own folder had to move that logic behind the packaged check,
otherwise the exe would crash the second it tried to read an empty path. Found that one the fun
way, exe built clean, ran perfect, cute on line one at actual boot. Cool cool cool.
Same deal with the version number btw, it gets baked straight into the bundle at build time
instead of being read from `package.json` (which won't exist next to the exe).

## ☆ Native stuff needs a way out

`sharp` resizes images, and it ships a real compiled binary per platform, there's no bundling
that, no matter how hard esbuild pretends it can. So the packaged build carries a tiny `native/`
folder right next to the exe with its own `node_modules/sharp` in it, like a mini separate
install just for that one thing.

`native-require.js` is the bridge: instead of a normal `import sharp from 'sharp'` (which needs
a real file on disk to resolve relative to, something a single exe simply does not have), it
uses node's `createRequire` pointed straight at that `native/` folder. Packaged, it looks there.
Dev, it looks at the normal package `node_modules` like nothing's different. Small file, does
exactly one job, cute and clean.

## ☆ The worker gets frozen too

The python resolver worker gets its own standalone exe via `PyInstaller`, same idea, no python
needed on the machine that runs it. `worker-process.js` just picks which one to spawn based on
the same flag: the frozen `worker/starl-worker(.exe)` when packaged, or `python worker/worker.py`
straight from source in dev. Genuinely can't believe pyinstaller just... works.

## ☆ The exe itself

Node has a built in way to turn a script into a real standalone executable (a "single executable
application", SEA for short): make a snapshot blob of the bundled file, copy node's own binary,
then inject that blob right into the copy. The copy becomes a fully working node runtime with
your code already baked in, no separate install needed to run it. Actually kind of a beautiful
idea when you say it slow like that.

Then it broke immediately and none of it felt beautiful anymore. The exact marker string node
looks for when injecting (the "sentinel fuse") isn't the same across every node version, it
quietly changed shape at some point and nobody warns you. Spent way too long convinced my own
script was wrong before realizing the binary itself just doesn't carry the string the docs say
it does. So now the build script reads whatever's actually inside the copied binary instead of
hardcoding one string, so it doesn't quietly break again next time node updates and decides to
be weird about it. Anyway. It works now. let's bounce.

## » Building on other OSes

Both the exe step and the worker freeze step only make a binary for whatever OS you run them
on, there's no cross-building one from another, and yes i also wish that wasn't true. Windows
only makes a windows exe, and so on. See [how to build it](how-to-build.md) for the actual
commands, and for the option that makes all three at once without needing three machines.

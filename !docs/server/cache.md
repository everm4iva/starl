# Da cache

_- [back to server docs](readme.md)_

The `cache/` folder is where the server keeps everything the worker makes, so it never has to do the same work twice or everytime... First time someone plays a song, the server fetches it and saves it here. Next time, it just serves the saved copy. That's the whole reason playback goes from "loading forever" to "instant".

## ☆ What's inside

- `cache/audio/` - the actual audio files
- `cache/images/` - cover art and pictures
- `cache/lyrics/` - fetched lyrics
- `cache/config.yaml` - a little settings file just for the cache side

Search results and other small stuff get cached too. It all rebuilds itself if you delete it, so you can wipe the cache folder anytime to reclaim space and nothing breaks, the server just starts filling it again.

## ☆ cache/config.yaml

This one's separate from the main config on purpose, so the cache knobs sit right next to the cache.

```yaml
audio:
  quality: "best"      # best | high | medium | low, how good the pulled audio comes out
  format: "opus"       # the format audio gets saved as, opus is tiny and sounds great

cleanup:
  max_age_days: 7      # cached files older than this get swept out to keep the folder from bloating

cookies_file: ""       # optional path to a cookies.txt, if a source wants you signed in
ffmpeg_path: ""        # optional path to ffmpeg, leave empty to let the server find it
```

## ☆ The cleanup sweep

The server runs a little janitor that sweeps old cached files every so often, so the cache doesn't just grow forever. `max_age_days` decides how old is "too old". If you've got tons of disk and want to keep everything longer, bump it up. If space is tight, drop it.

## » About cookies and ffmpeg

- **cookies_file** is only needed if a source starts asking the server to prove it's a real signed-in browser. Most of the time you can ignore it. If you do need it, it's a `cookies.txt` you export from a browser. Careful: that file is basically your login, so never share it.
- **ffmpeg** is the tool that converts audio. The server tries to find it on its own. Only fill `ffmpeg_path` in if it can't, pointing at where ffmpeg lives on your machine.

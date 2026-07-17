/*
 * ☆ Bootstrap
 * -> first time you run the server it kinda unpacks itself right here in its own folder,
 *    makes the data + cache + web folders, drops a config or two, so everythings ready
 * -> its all idempotent, running again just fills in whatevers missing and leaves your
 *    own stuff alone, no clobbering, promise
 * -> the raw log at the end is the terminal side of "the details", so you can eyeball
 *    ports and paths the second it boots
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  BASE_DIR, CONFIG_PATH, CACHE_DIR, WEB_DIR,
  DATA_DIR, USER_STATE_DIR, SEARCH_CLICKS_DIR, SEARCH_RANK_CACHE_DIR, STATS_DIR,
  ACCOUNT_SETTINGS_DIR, PROFILE_PICTURE_DIR,
  AUDIO_DIR, IMAGE_DIR, LYRICS_CACHE_DIR,
  SERVER_NAME, PORT, PAGE_PORT, WORKER_PORT,
} from './config.js';
import { ensureShortcut } from './lib/desktop-shortcut.js';

// make a folder if its not there yet, parents and all, super chill about it already existing
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// write a file only if its missing, so we never step on something you already edited
function ensureFile(file, contents) {
  if (fs.existsSync(file)) return false;
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, contents, 'utf-8');
  return true;
}

// the little config for the cache side, simple knobs the workers care about
// (audio quality, cleanup, optional cookies/ffmpeg paths) so its all in one obvious spot
function cacheConfigText() {
  return `# ☆ Cache config
# this holds the stuff the workers make, audio, pictures, lyrics, search caches, all cached here
# tweak these if the cache gets hungry, or you want a different audio quality, that kinda thing

audio:
  quality: "best"      # best | high | medium | low, how good the pulled audio comes out
  format: "opus"       # the format workers save audio as, opus is tiny and sounds great

cleanup:
  max_age_days: 7      # cached files older than this get swept, keeps the folder from bloating

cookies_file: ""       # optional path to a cookies.txt, if a source wants you signed in
ffmpeg_path: ""        # optional path to ffmpeg, leave empty to let the server find it
`;
}

// a bare fallback page, just so the status page still shows something if web/ got wiped
// the real editable site ships in web/ already, this is only the safety net
function fallbackIndexHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${SERVER_NAME}</title></head>
<body><h1>${SERVER_NAME}</h1><p>web/ is empty, so this is the fallback page, drop your site here</p>
<p><a href="/status.json">status.json</a></p></body></html>`;
}

// prints the raw log, the friendly wall of text that tells you exactly whats where
function printBanner() {
  const line = '-'.repeat(52);
  console.log(line);
  console.log(`  ☆ ${SERVER_NAME}`);
  console.log(line);
  console.log(`  folder    | ${BASE_DIR}`);
  console.log(`  config    | ${CONFIG_PATH}`);
  console.log(`  data      | ${DATA_DIR}`);
  console.log(`  cache     | ${CACHE_DIR}`);
  console.log(`  web       | ${WEB_DIR}`);
  console.log(`  api port  | ${PORT}`);
  console.log(`  page port | ${PAGE_PORT}`);
  console.log(`  worker    | ${WORKER_PORT}`);
  console.log(line);
}

// the whole first-run unpack, called once at boot before we start listening
export function bootstrap() {
  // data side, one folder per kind of record, the janitor + stores fill these as they go
  [
    DATA_DIR, USER_STATE_DIR, SEARCH_CLICKS_DIR, SEARCH_RANK_CACHE_DIR, STATS_DIR,
    ACCOUNT_SETTINGS_DIR, PROFILE_PICTURE_DIR,
  ].forEach(ensureDir);

  // cache side, plus its own little config so the worker knobs sit right beside the cache
  [CACHE_DIR, AUDIO_DIR, IMAGE_DIR, LYRICS_CACHE_DIR].forEach(ensureDir);
  ensureFile(path.join(CACHE_DIR, 'config.yaml'), cacheConfigText());

  // web side, make the folder and only drop the fallback page if theres literally nothing
  ensureDir(WEB_DIR);
  if (fs.readdirSync(WEB_DIR).length === 0) {
    ensureFile(path.join(WEB_DIR, 'index.html'), fallbackIndexHtml());
  }

  // a desktop shortcut so you can start the server without hunting for the exe (best effort)
  ensureShortcut();

  printBanner();
}

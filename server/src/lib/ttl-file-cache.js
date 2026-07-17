/*
 * ☆ Per-key TTL file cache
 * -> each entry is one small JSON file {key, expires_at, payload}, so a write touches
 *    only that key instead of rewriting a multi-megabyte blob, and a memory miss reads
 *    one tiny file instead of the whole store.
 * -> a namespacer optionally maps a key to a sub-directory (e.g. "search", "artist") so
 *    the cache stays browsable by category. Port of record_store.TtlFileCache.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteJson, safeUnlink } from './atomic-write.js';

// everything here counts time in seconds, same as the files on disk do
const nowSeconds = () => Date.now() / 1000;

// keep a name to the characters every filesystem is happy with
const sanitize = (text) => String(text).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');

// filesystem-safe, length-capped, collision-free filename for an arbitrary key. The
// readable prefix keeps the dir browsable; the hash suffix guarantees uniqueness even
// when two keys sanitize alike. The full original key is stored inside the file.
export function safeCacheFilename(key, maxLen = 80) {
  let cleaned = sanitize(key);
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen).replace(/_+$/g, '');
  const digest = crypto.createHash('sha1').update(key, 'utf-8').digest('hex').slice(0, 10);
  return cleaned ? `${cleaned}__${digest}` : digest;
}

// every .json file under dir, however deep the namespacer nested them
function* jsonFilesUnder(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonFilesUnder(full);
    else if (entry.name.endsWith('.json')) yield full;
  }
}

export class TtlFileCache {
  constructor(directory, namespacer = null) {
    this.directory = directory;
    this._namespacer = namespacer;
    this._mem = new Map(); // key -> { expiresAt, payload }
  }

  _dirFor(key) {
    if (!this._namespacer) return this.directory;
    let sub = null;
    try { sub = this._namespacer(key); } catch { sub = null; }
    return sub ? path.join(this.directory, sanitize(sub)) : this.directory;
  }

  _pathFor(key) {
    return path.join(this._dirFor(key), `${safeCacheFilename(key)}.json`);
  }

  // the entry sitting on disk, for a key we havent seen this run (or another process wrote)
  _read(key) {
    try {
      const record = JSON.parse(fs.readFileSync(this._pathFor(key), 'utf-8'));
      return { expiresAt: Number(record.expires_at) || 0, payload: record.payload };
    } catch {
      return null;
    }
  }

  // forget a key completely, from memory and from disk
  _drop(key) {
    this._mem.delete(key);
    safeUnlink(this._pathFor(key));
  }

  get(key) {
    const entry = this._mem.get(key) || this._read(key);
    if (!entry) return null;
    if (nowSeconds() >= entry.expiresAt) {
      this._drop(key); // expired, so clean it out on the way past
      return null;
    }
    this._mem.set(key, entry); // a disk hit gets promoted, a memory hit just stays put
    return structuredClone(entry.payload);
  }

  set(key, payload, ttl) {
    const expiresAt = nowSeconds() + ttl;
    this._mem.set(key, { expiresAt, payload });
    const file = this._pathFor(key);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      atomicWriteJson(file, { key, expires_at: expiresAt, payload });
    } catch { /* best effort cache write :) */ }
  }

  invalidate(key) {
    this._drop(key);
  }

  invalidatePrefix(prefix) {
    // driven by the in-memory key set (covers the common no-restart case). A file
    // orphaned across a restart is harmless — the next write to that key overwrites it.
    for (const key of [...this._mem.keys()]) {
      if (key.startsWith(prefix)) this._drop(key);
    }
  }

  sweepExpired() {
    const now = nowSeconds();
    let removed = 0;
    for (const file of jsonFilesUnder(this.directory)) {
      let record;
      try { record = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { continue; } // skips nerd-ly
      if (now < (Number(record.expires_at) || 0)) continue; // still fresh, leave it alone
      try { fs.unlinkSync(file); removed++; } catch { /* itll get swept next time */ }
    }
    return removed;
  }
}

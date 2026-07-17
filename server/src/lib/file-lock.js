/*
 * ☆ Cross-process file lock
 * -> coordinates work between processes using only the filesystem: a lock is a file
 *    created atomically (via 'wx'); whoever creates it holds the lock.
 * -> the file records the holder's pid + token + acquire time, so a lock left by a
 *    crashed worker is detected as stale (older than staleAfter) and stolen - a dead
 *    holder can't deadlock a track forever. Port of locks.FileLock.
 * -> it's atomic. (again) hehehe
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class FileLock {
  constructor(lockPath, staleAfter = 300) {
    this.path = lockPath;
    this.staleAfter = staleAfter; // seconds
    this._token = `${process.pid}:${crypto.randomUUID().replace(/-/g, '')}`;
    this._held = false;
  }

  exists() {
    return fs.existsSync(this.path);
  }

  _tryCreate() {
    let fd;
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      fd = fs.openSync(this.path, 'wx'); // fails with "EEXIST" if it already exists
    } catch {
      return false;
    }
    try {
      fs.writeSync(fd, JSON.stringify({ token: this._token, pid: process.pid, acquired_at: Date.now() / 1000 }));
    } finally {
      fs.closeSync(fd);
    }
    this._held = true;
    return true;
  }

  _stealIfStale() {
    let acquiredAt;
    try {
      acquiredAt = Number(JSON.parse(fs.readFileSync(this.path, 'utf-8')).acquired_at || 0) || 0;
    } catch (err) {
      if (err.code === 'ENOENT') return true;
      // corrupt/partial lock file - fall back to mtime for the age check
      try { acquiredAt = fs.statSync(this.path).mtimeMs / 1000; } catch { return false; }
    }
    if (Date.now() / 1000 - acquiredAt > this.staleAfter) {
      try { fs.unlinkSync(this.path); } catch (err) { if (err.code !== 'ENOENT') return false; }
      return true;
    }
    return false;
  }

  acquire(timeout = null, poll = 100) {
    const deadline = timeout == null ? null : Date.now() + timeout * 1000;
    // spin-wait; used off the hot path (full fallback download)
    for (;;) {
      if (this._tryCreate()) return true;
      this._stealIfStale();
      if (deadline != null && Date.now() >= deadline) return false;
      const until = Date.now() + poll;
      while (Date.now() < until) { /* cute brief spin */ }
    }
  }

  /**
   * when it returns true (ex:. the cached file appeared while we waited), acquisition is
   * abandoned and this resolves false
   */
  async acquireAsync(timeout = null, poll = 100, shouldAbort = null) {
    const deadline = timeout == null ? null : Date.now() + timeout * 1000;
    for (;;) {
      if (this._tryCreate()) return true;
      this._stealIfStale();
      if (shouldAbort) {
        try { if (shouldAbort()) return false; } catch { /* just fucking ignore */ }
      }
      if (deadline != null && Date.now() >= deadline) return false;
      await delay(poll);
    }
  }

  release() {
    if (!this._held) return;
    try {
      const owner = JSON.parse(fs.readFileSync(this.path, 'utf-8')).token;
      if (owner === this._token) fs.unlinkSync(this.path);
    } catch (err) {
      if (err.code === 'ENOENT') { this._held = false; return; }
      // unreadable but we believe we own it - best-effort removal
      try { fs.unlinkSync(this.path); } catch { /* ignore it duh */ }
    }
    this._held = false;
  }
}

export function sweepStaleLocks(directory, maxAgeSeconds = 600) {
  let removed = 0;
  const now = Date.now() / 1000;
  if (!fs.existsSync(directory)) return 0;
  let entries = [];
  try { entries = fs.readdirSync(directory); } catch { return 0; }
  for (const name of entries) {
    if (!name.endsWith('.lock')) continue;
    const full = path.join(directory, name);
    try {
      if (now - fs.statSync(full).mtimeMs / 1000 > maxAgeSeconds) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch { /* shrug and skip */ }
  }
  return removed;
}

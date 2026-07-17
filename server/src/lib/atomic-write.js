/*
 * ☆ Atomic JSON write
 * -> write to a temp file then rename over the target, so a reader never sees a
 *    half-written sidecar. Retries the rename to ride out the brief Windows file lock
 *    (AV scan / handle close) that raises EPERM/EBUSY right after we close the file.
 * -> port of record_store._atomic_write_json.
 * -> It's atomic
 */

import fs from 'node:fs';

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);

function sleep(ms) {
  // tiny synchronous wait - used only on the rare Windows rename retry path.
  const until = Date.now() + ms;
  while (Date.now() < until) { /* cutely spin briefly */ }
}

export function atomicWriteJson(filePath, data, attempts = 6) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      fs.renameSync(tmp, filePath);
      return;
    } catch (err) {
      if (!RETRYABLE.has(err.code) || attempt === attempts - 1) {
        try { fs.unlinkSync(tmp); } catch { /* best effort */ }
        throw err;
      }
      sleep(50 * (attempt + 1));
    }
  }
}

export function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch { /* missing is totally fine */ }
}

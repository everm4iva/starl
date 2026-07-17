/*
 * ☆ Native require
 * -> native addons (like sharp) can't live inside a Node SEA blob, so a packaged build
 *    ships them as a real node_modules/ folder sitting in a "native/" dir next to the exe
 * -> createRequire lets us point module resolution at that folder explicitly, instead of
 *    relying on __dirname (which means nothing once the code is baked into a single exe)
 * -> in dev theres no native/ dir at all, we just resolve node_modules the normal way
 * -> yes noop.cjs doesnt actually need to exist anywhere, createRequire just wants a path
 *    to squint at, i double checked this like three times before believing it too
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolutionRoot() {
  if (process.env.STARL_PACKAGED === '1') {
    return path.join(path.dirname(process.execPath), 'native', 'noop.cjs');
  }
  // two dirs up from src/lib -> the server package root, right where node_modules lives
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', '..', 'noop.cjs');
}

const nativeRequire = createRequire(resolutionRoot());

export function requireNative(name) {
  return nativeRequire(name);
}

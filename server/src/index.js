/*
 * ☆ Boot
 * -> the runway: build the app, bring the Python worker up, start the janitor, listen.
 * -> the worker is optional to spawn (SPAWN_WORKER=0 to manage it yourself); either way
 *    we health-check it so a misconfigured worker is obvious at startup, not mid-request.
 */

import { buildApp } from './app.js';
import { PORT, PAGE_PORT } from './config.js';
import { bootstrap } from './bootstrap.js';
import { startPageServer } from './page-server.js';
import { pruneRevokedTokens } from './auth/revoked.js';
import { startWorker, stopWorker } from './music/worker-process.js';
import { startJanitor } from './jobs/janitor.js';

// the fix for "it's running but nobody on the network can reach it" nine times out of ten,
// so it gets printed right on boot instead of making every operator go find it themselves
function printFirewallHint() {
  console.log(`[starl] if devices on your network can't reach this, your OS firewall is probably blocking it`);
  if (process.platform === 'win32') {
    console.log(`[starl] windows: run this in an admin PowerShell to allow it through -`);
    console.log(`[starl]   New-NetFirewallRule -DisplayName "Starl Server" -Direction Inbound -Protocol TCP -LocalPort ${PORT},${PAGE_PORT} -Action Allow -Profile Private`);
  } else if (process.platform === 'linux') {
    console.log(`[starl] linux: if ufw is on, run - sudo ufw allow ${PORT}/tcp && sudo ufw allow ${PAGE_PORT}/tcp`);
  }
}

// first thing: unpack ourselves into this folder (data/, cache/, web/, configs, shortcut)
// so everything the server reaches for below is already sitting there, ready to go
bootstrap();

// Clear out long-expired revoked tokens on startup (best effort).
try { pruneRevokedTokens(); } catch { /* ignore */ }

const app = buildApp();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[starl] server listening on http://0.0.0.0:${PORT}`);
});

// the little website + status page, off on its own port so it never fights the api
const pageServer = startPageServer();

printFirewallHint(); // comment this out if you don't want the hint printed on every boot, but it's usually helpful

// Bring the Python resolver worker up (or just health-check it) alongside the brain.
startWorker().catch((err) => console.error('[starl] worker startup error:', err));

// Sweep stale cache files on boot and every 10 minutes after.
startJanitor();

function shutdown(signal) {
  console.log(`[starl] ${signal} received, shutting down`);
  stopWorker();
  try { pageServer.close(); } catch { /* ignore */ }
  server.close(() => process.exit(0));
  // Don't hang forever if a connection is stuck.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

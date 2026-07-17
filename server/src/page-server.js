/*
 * ☆ Page server
 * -> the little website lives on its own port (page_port), kept separate from the api so
 *    the site and the actual server dont step on each other
 * -> it serves whatevers in web/ (yours to edit) plus a /status.json that the status page
 *    reads to show how the server is doing, name, uptime, memory, that kinda thing
 */

import express from 'express';
import os from 'node:os';
import {
  WEB_DIR, PAGE_PORT, PORT, SERVER_VERSION,
  SERVER_NAME, SERVER_DESCRIPTION, SERVER_PICTURE,
  MAX_MEMORY_MB, MAX_STORAGE_GB, MIN_VERSION,
  AUTH_MODE, AUTH_ALLOW_SIGNUP,
} from './config.js';

// true for the private ranges a home/office lan actually uses (rfc1918), so we can tell
// those apart from vpn adapters (tailscale, radmin, ...) that also hand out an ipv4
function isPrivateLan(addr) {
  return /^192\.168\.\d{1,3}\.\d{1,3}$/.test(addr)
    || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr)
    || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(addr);
}

// every non-internal ipv4 this machine answers to, tagged with which adapter its on and
// whether it looks like a real lan address, so the status page can point at the right one
// instead of someone grabbing a vpn address their phone cant actually reach
function lanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const [name, iface] of Object.entries(nets)) {
    for (const net of iface || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addrs.push({ address: net.address, iface: name, lan: isPrivateLan(net.address) });
      }
    }
  }
  // real lan addresses first, so the obvious pick is always on top
  addrs.sort((a, b) => Number(b.lan) - Number(a.lan));
  return addrs;
}

// a quick snapshot of how the servers feeling right now, the status page polls this
function statusSnapshot() {
  const mem = process.memoryUsage();
  return {
    name: SERVER_NAME,
    description: SERVER_DESCRIPTION,
    picture: SERVER_PICTURE,
    version: SERVER_VERSION,
    min_version: MIN_VERSION,
    ports: { api: PORT, page: PAGE_PORT },
    addresses: lanAddresses(),
    // mode only, never the actual pin/password, this page has no auth of its own so
    // anyone on the network can load it, the secret still only gets shared out-of-band
    auth: { mode: AUTH_MODE, allow_signup: AUTH_ALLOW_SIGNUP },
    uptime_seconds: Math.floor(process.uptime()),
    memory: { used_mb: Math.round(mem.rss / 1024 / 1024), max_mb: MAX_MEMORY_MB },
    storage: { max_gb: MAX_STORAGE_GB },
  };
}

export function startPageServer() {
  const app = express();
  app.disable('x-powered-by');

  // the status page reads this to draw itself, plain json, no auth, its all public info
  app.get('/status.json', (req, res) => res.json(statusSnapshot()));

  // everything else is just the static site sitting in web/, yours to mess with freely
  app.use(express.static(WEB_DIR, { extensions: ['html'] }));

  const server = app.listen(PAGE_PORT, '0.0.0.0', () => {
    console.log(`[starl] page + status on http://0.0.0.0:${PAGE_PORT}`);
  });
  return server;
}

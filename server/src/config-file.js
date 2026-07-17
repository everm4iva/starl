/*
 * ☆ Config file
 * -> the friendly config.yaml sits right next to the server, so anyone can open it and
 *    tweak the name, ports, limits, all that, without ever touching the code
 * -> first run has no config yet, so we just plant a default one (with a fresh auth
 *    secret baked in) and read it back, kinda like it grows itself the first time
 * -> we also make dead sure theres always an auth secret, even if someone deletes the
 *    line, otherwise nobody could log in, so we quietly top it back up and keep the comments
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

// where the server actually lives, so all its stuff expands right here beside it
// packaged (a real exe) -> the folder the exe sits in, thats wherever you dropped it
// dev (plain node) -> the package root, one up from src/, same idea just from source
function resolveBaseDir() {
  // process.pkg or our own flag tell us were running as a bundled executable
  const packaged = Boolean(process.pkg) || process.env.STARL_PACKAGED === '1';
  if (packaged) return path.dirname(process.execPath);
  // only touched in dev - import.meta.url is empty once this is squashed into a SEA bundle,
  // so this must never run on the packaged path (it doesn't, thanks to the check above)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, '..');
}

export const BASE_DIR = resolveBaseDir();
export const CONFIG_PATH = path.join(BASE_DIR, 'config.yaml');

// a fresh random secret, made just for this one server, it signs the logins later on
function freshSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// the default config.yaml we drop on first run, comments and all so its easy to read
// we keep it as a plain string so the friendly comments survive exactly how theyre written
// (a yaml serializer would just eat them, and half the point here is the little notes)
function defaultConfigText() {
  return `# ☆ Starl server config
# this is your server so tweak it however you like, it gets read every time you start up
# keep the shape the same though, and dont share secrets here, this file is yours not the users

server:
  name: "My Starl Server"        # the name people see on the status page and in the app
  description: "just a cozy little music server"
  picture: ""                    # path or url to a picture, leave empty for the default one
  port: 6912                     # the api port, where the app talks to the server
  page_port: 6910                # the page port, where the little website and status page live

limits:
  max_memory_mb: 1024            # soft memory hint for now, the cache leans on it more later
  max_storage_gb: 20             # how big the cache can get before cleanup gets a bit pushier
  min_version: "0.1.0"           # oldest app version allowed in, older ones get asked to update

auth:
  mode: "userpass"               # how people get in: none | pin | password | userpass
  pin: ""                        # pin mode only: the shared numeric code you pick, like "4823"
  password: ""                   # password mode only: the shared password you pick
  allow_signup: true             # userpass mode only: let new folks make an account, or lock it
  secret: "${freshSecret()}"     # signs your logins, keep it secret, it was made just for you

worker:
  port: 6913                     # the python resolver worker port, just internal plumbing
  spawn: true                    # let the server run the worker for you, or do it yourself

network:
  # who's allowed to talk to the server from a browser (cors), the app needs this to connect
  # "*" means any app or site can reach it, which is fine here since login is by token not cookies
  # wanna lock it down? swap the "*" for a list, like: ["https://localhost", "https://your.app"]
  allowed_origins: ["*"]
`;
}

// read the config, and if its not there yet we plant the default first, then read it
// theres a tiny safety net too, so a broken yaml file cant take the whole boot down with it
export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, defaultConfigText(), 'utf-8');
  }
  try {
    const text = fs.readFileSync(CONFIG_PATH, 'utf-8');
    // parseDocument keeps the comments around, so we can fix a missing secret and save it
    // back without wiping all the friendly little notes people rely on
    const doc = YAML.parseDocument(text);
    ensureSecret(doc);
    return doc.toJS() || {};
  } catch (err) {
    console.error('[starl] couldnt read config.yaml, falling back to built-in defaults:', err.message);
    return YAML.parse(defaultConfigText());
  }
}

// no secret means nobody can log in, so if its gone we make a new one and write it right back
function ensureSecret(doc) {
  const current = doc.getIn(['auth', 'secret']);
  if (current && String(current).trim()) return;
  if (!doc.get('auth')) doc.set('auth', {});
  doc.setIn(['auth', 'secret'], freshSecret());
  try {
    fs.writeFileSync(CONFIG_PATH, doc.toString(), 'utf-8');
    console.log('[starl] your config.yaml had no auth secret, so i made a fresh one for you');
  } catch { /* if we cant write it, the in-memory one still works for this run */ }
}

// one read at import time, everybody downstream just shares this same parsed object
export const config = loadConfig();

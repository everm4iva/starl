/*
 * ☆ User store
 * -> keeps a little record per person, in data/users.json, one entry per user id
 * -> in the shared modes theres just the one "local" user, in userpass mode theres a real
 *    account each, with a hashed password (never the plain one, that never touches disk)
 * -> upsertUser just syncs the light stuff (name/picture) from a token, it never clobbers
 *    a stored password, so logging in cant accidentally wipe your account
 */

import { JsonStore } from './lib/json-store.js';
import { USERS_FILE } from './config.js';
import { hashPassword } from './auth/local.js';

export const usersStore = new JsonStore(USERS_FILE, { users: {} });

// username -> a tidy id we key everything by, so "Kevin" and "kevin" are the same account
function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

// grab an account by username, or null if theres nobody by that name yet
export function getByUsername(username) {
  const id = normalizeUsername(username);
  if (!id) return null;
  const users = usersStore.read().users || {};
  return users[id] || null;
}

// make a brand new account, throws if the name is taken or empty so the route can complain
export function createAccount(username, password) {
  const id = normalizeUsername(username);
  if (!id) throw new Error('username required');
  if (!password) throw new Error('password required');

  const data = usersStore.read();
  const users = data.users || {};
  if (users[id]) throw new Error('username taken');

  users[id] = {
    id,
    username: String(username).trim(),
    name: String(username).trim(),
    picture: null,
    passwordHash: hashPassword(password),
    created_at: Date.now(),
  };
  data.users = users;
  usersStore.write(data);
  return users[id];
}

// sync the light bits off a token payload, keeping whatevers already stored (like the password)
export function upsertUser(payload) {
  const userId = payload && payload.sub;
  if (!userId) return {};

  const data = usersStore.read();
  const users = data.users || {};
  const existing = users[userId] || {};

  users[userId] = {
    ...existing,
    id: userId,
    name: payload.name ?? existing.name ?? null,
    picture: payload.picture ?? existing.picture ?? null,
  };
  data.users = users;
  usersStore.write(data);
  return users[userId];
}

// remember which device (client name) connected and when, handy for seeing whos on the server
// we keep a little map of name -> last seen, so a repeat connect just bumps the timestamp
export function recordClient(userId, clientName) {
  const id = String(userId || '').trim();
  const name = String(clientName || '').trim();
  if (!id || !name) return;

  const data = usersStore.read();
  const users = data.users || {};
  const user = users[id];
  if (!user) return;

  const clients = user.clients || {};
  clients[name] = Date.now();
  user.clients = clients;
  data.users = users;
  usersStore.write(data);
}

export function deleteUser(userId) {
  userId = String(userId || '').trim();
  if (!userId) return;
  const data = usersStore.read();
  const users = data.users || {};
  if (users[userId]) {
    delete users[userId];
    data.users = users;
    usersStore.write(data);
  }
}

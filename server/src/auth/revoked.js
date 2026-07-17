/*
 * ☆ Revoked tokens
 * -> a simple list of revoked jti (stored as "jti:exp" when an expiry is known) so old
 *    sessions can be blocked. Port of the revocation helpers in auth.py.
 */

import { JsonStore } from '../lib/json-store.js';
import { REVOKED_TOKENS_FILE } from '../config.js';

export const revokedStore = new JsonStore(REVOKED_TOKENS_FILE, { revoked: [] });

export function isRevoked(payload) {
  const jti = payload.jti;
  if (!jti) return false;
  const revoked = revokedStore.read().revoked || [];
  const exp = payload.exp;
  return revoked.includes(jti) || (exp && revoked.includes(`${jti}:${exp}`));
}

export function revokeToken(payload) {
  const jti = payload.jti;
  if (!jti) return;
  const exp = payload.exp;
  const entry = exp ? `${jti}:${exp}` : jti;
  const data = revokedStore.read();
  const revoked = new Set(data.revoked || []);
  revoked.add(entry);
  data.revoked = [...revoked].sort();
  revokedStore.write(data);
}

export function pruneRevokedTokens() {
  const data = revokedStore.read();
  const revoked = data.revoked || [];
  const now = Math.floor(Date.now() / 1000);
  let stillValid = [];
  for (const entry of revoked) {
    const s = String(entry);
    if (s.includes(':')) {
      const expStr = s.slice(s.lastIndexOf(':') + 1);
      const exp = Number.parseInt(expStr, 10);
      if (Number.isNaN(exp) || exp > now) stillValid.push(entry);
    } else {
      stillValid.push(entry);
    }
  }
  // hard cap so plain JTI (no expiry) can't grow forever
  if (stillValid.length > 1000) stillValid = [...new Set(stillValid)].sort().slice(-1000);
  data.revoked = stillValid;
  revokedStore.write(data);
}

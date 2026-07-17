/*
 * ☆ Token check
 * -> verifies our own local tokens, signed with the secret from config.yaml, thats it
 * -> no cloud, no jwks, no phoning home, just us checking a signature we made ourselves
 * -> getCurrentUser also turns away revoked tokens, so a logged-out session stays out
 */

import { verifyLocalToken } from './local.js';
import { httpError } from '../lib/http-error.js';
import { isRevoked } from './revoked.js';

// take a raw token, make sure we really signed it and it hasnt expired, hand back the payload
// we keep this async so the middleware + callers dont have to change, even with no await now
export async function decodeToken(token) {
  try {
    return verifyLocalToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw httpError(401, 'Token expired');
    if (err.name === 'JsonWebTokenError') {
      if (/invalid signature/i.test(err.message)) throw httpError(401, 'Invalid token signature');
      throw httpError(401, 'Token decode error');
    }
    throw httpError(401, 'Invalid token');
  }
}

// resolve the current user from an Authorization header (or a raw bearer string)
export async function getCurrentUser(authorization) {
  if (!authorization || !authorization.startsWith('Bearer ')) {
    throw httpError(401, 'Missing bearer token');
  }
  const token = authorization.slice('Bearer '.length).trim();
  const payload = await decodeToken(token);
  if (isRevoked(payload)) throw httpError(401, 'Token revoked');
  return payload;
}

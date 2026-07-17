/*
 * ☆ Auth middleware
 * -> requireUser: protected JSON routes; reads the Authorization header, verifies, and
 *    attaches req.user (revocation-checked).
 * -> requireUserOrToken: media GETs that <audio>/<img> tags hit, where the token rides
 *    in ?token= (header can't be set on those element requests). A query token is
 *    decoded but not revocation-checked — same split as the old decode_token vs
 *    get_current_user usage.
 * -> asyncHandler wraps async routes so thrown HttpErrors reach the error handler.
 */

import { getCurrentUser, decodeToken } from './jwt.js';

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export async function requireUser(req, res, next) {
  try {
    req.user = await getCurrentUser(req.headers.authorization);
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireUserOrToken(req, res, next) {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : null;
    if (token) {
      req.user = await decodeToken(token);
    } else {
      req.user = await getCurrentUser(req.headers.authorization);
    }
    next();
  } catch (err) {
    next(err);
  }
}

// pull a bearer token from header or ?token=, for handlers that need the raw token
// (e.g. to forward it when fetching an authenticated upstream image)
export function bearerFrom(req) {
  const q = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (q) return q;
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
}

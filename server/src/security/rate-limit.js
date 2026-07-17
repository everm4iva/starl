/*
 * ☆ Rate limits
 * -> per-route request caps on the auth endpoints, matching the old slowapi limits.
 */

import rateLimit from 'express-rate-limit';

const make = (max) => rateLimit({
  windowMs: 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ detail: 'Rate limit exceeded' }),
});

export const registerLimiter = make(10); // 10 minutes
export const loginLimiter = make(20);    // 20 minutes
export const refreshLimiter = make(15);  // 15 minutes

import rateLimit from 'express-rate-limit';

// Tighter limit for auth endpoints (register/login/forgot-password) — the
// global limiter (300 req/15min in app.ts) is far too loose to meaningfully
// slow down credential-stuffing or mass-account-creation attempts.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

// For public, unauthenticated write endpoints that trigger a real side
// effect (an email, a stubbed payment) — contact form, guest checkout, event
// registration. Looser than authLimiter since these are legitimate
// one-per-visit actions, not credential guesses.
export const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

const rateLimit = require('express-rate-limit');

// All limiters use the default in-memory store — appropriate for a single Render free-tier
// instance (no Redis needed). Sizes are deliberately generous for genuine use, tight enough
// to blunt OTP-bombing / credential-stuffing / spam-ticket abuse.

// OTP send — keyed by mobile+IP so one bad actor can't lock out a mobile number for everyone,
// and one IP can't hammer many numbers either.
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.body?.mobile || ''}`,
  message: { success: false, message: 'Too many OTP requests. Please try again in a few minutes.' },
});

// Login — keyed by IP+identifier, generous enough for a genuine user who mistypes a password
// a few times, tight enough to blunt credential-stuffing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.body?.username || req.body?.mobile || ''}`,
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
});

// Ticket creation — keyed by the authenticated user (this runs after verifyToken), so it
// throttles spam from one account without penalizing everyone behind the same NAT/IP.
const ticketCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many issues submitted recently. Please try again later.' },
});

// Password reset — a handful of attempts per hour is plenty for a real admin who forgot
// their password, and keeps this endpoint from being used to spam the recovery inbox.
const passwordResetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

module.exports = { otpLimiter, loginLimiter, ticketCreateLimiter, passwordResetLimiter };

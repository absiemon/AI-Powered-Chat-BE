
import rateLimit from 'express-rate-limit';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX } from '../config/constants.js';

const chatRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true, // adds the modern RateLimit-* headers
  legacyHeaders: false,  // disables the deprecated X-RateLimit-* headers
  message: {
    message: 'Too many requests. Please slow down and try again shortly.',
  },
});

export default chatRateLimiter;
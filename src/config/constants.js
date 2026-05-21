/**
 * Maximum number of characters allowed in a single user message.
 */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * Maximum number of messages stored per session.
 * When exceeded, the oldest messages are trimmed.
 */
export const SESSION_MAX_MESSAGES = parseInt(
  process.env.SESSION_MAX_MESSAGES || '40',
  10,
);

/**
 * How long (in ms) a session can remain idle before being evicted.
 */
export const SESSION_TTL_MS = parseInt(
  process.env.SESSION_TTL_MS || `${30 * 60 * 1000}`,
  10,
);

/**
 * How often (in ms) the session sweeper runs.
 */
export const SESSION_SWEEP_INTERVAL_MS = Math.max(
  60 * 1000,
  Math.floor(SESSION_TTL_MS / 4),
);

/**
 * Gemini model used for both chat completions and insight extraction.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/**
 * Maximum time (in ms) to wait for a Gemini API response.
 */
export const GEMINI_TIMEOUT_MS = parseInt(
  process.env.GEMINI_TIMEOUT_MS || '20000',
  10,
);

/**
 * How long (in ms) to keep a key in cooldown after it returns a
 * rate-limit (429) error. Gemini's RPM resets every 60s.
 */
export const GEMINI_KEY_COOLDOWN_MS = parseInt(
  process.env.GEMINI_KEY_COOLDOWN_MS || '60000',
  10,
);

/**
 * Maximum tokens for the assistant's chat reply.
 */
export const CHAT_MAX_TOKENS = 300;

/**
 * Maximum tokens for the insight extraction response.
 */
export const INSIGHT_MAX_TOKENS = 80;

/**
 * System prompt for chat replies.
 */
export const CHAT_SYSTEM_PROMPT =
  'You are a helpful, friendly assistant. Keep responses concise, ' +
  'clear, and conversational. Use the conversation history for context.';

/**
 * System prompt for insight extraction.
 */
export const INSIGHT_SYSTEM_PROMPT =
  'You analyze user messages and return ONLY a JSON object describing ' +
  'the message\'s intent and sentiment. Do not include any other text.';

/**
 * Allowed sentiment values.
 */
export const ALLOWED_SENTIMENTS = ['positive', 'neutral', 'negative'];

/**
 * Rate limiting configuration.
 */
export const RATE_LIMIT_WINDOW_MS = parseInt(
  process.env.RATE_LIMIT_WINDOW_MS || '60000',
  10,
);

export const RATE_LIMIT_MAX = parseInt(
  process.env.RATE_LIMIT_MAX || '30',
  10,
);

/**
 * Allowed CORS origins.
 */
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
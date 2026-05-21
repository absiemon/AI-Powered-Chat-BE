import crypto from 'crypto';
import logger from '../config/logger.js';
import {
  SESSION_MAX_MESSAGES,
  SESSION_TTL_MS,
  SESSION_SWEEP_INTERVAL_MS,
} from '../config/constants.js';

/** @type {Map<string, { messages: Array, lastAccessedAt: number }>} */
const sessions = new Map();

// ============================================================
// Internal helpers
// ============================================================

/**
 * Touches a session's lastAccessedAt timestamp so it isn't
 * considered idle by the sweeper.
 */
function touchSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastAccessedAt = Date.now();
  }
}

/**
 * Creates a new empty session and returns its id.
 */
function createSession() {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    messages: [],
    lastAccessedAt: Date.now(),
  });
  logger.debug({ sessionId }, 'New session created');
  return sessionId;
}

// ============================================================
// Public API
// ============================================================

/**
 * Returns the given sessionId if it exists, otherwise creates a new one.
 * Also refreshes the lastAccessedAt timestamp.
 *
 * @param {string|undefined} sessionId
 * @returns {string} The active sessionId.
 */
export function getOrCreateSession(sessionId) {
  if (sessionId && sessions.has(sessionId)) {
    touchSession(sessionId);
    return sessionId;
  }
  return createSession();
}

/**
 * Returns a *copy* of the conversation for the given session.
 * Returning a copy prevents callers from mutating internal state.
 *
 * @param {string} sessionId
 * @returns {Array} Array of message entries (empty if session not found).
 */
export function getConversation(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return [];
  touchSession(sessionId);
  // Shallow clone the array; entries themselves are treated as immutable.
  return [...session.messages];
}

/**
 * Appends a message to a session's history and returns the stored entry.
 * Trims the oldest messages if the session exceeds SESSION_MAX_MESSAGES.
 *
 * @param {string} sessionId
 * @param {{ role: 'user'|'assistant', text: string, insight?: object|null, isFallback?: boolean }} message
 * @returns {object} The persisted message entry.
 */
export function appendMessage(sessionId, message) {
  const session = sessions.get(sessionId);
  if (!session) {
    // Defensive: caller should have ensured the session exists.
    throw new Error(`Session ${sessionId} not found`);
  }

  const entry = {
    id: crypto.randomUUID(),
    role: message.role,
    text: message.text,
    insight: message.insight || null,
    // Marks assistant entries that were produced by the fallback path
    // instead of the real model. The aiService skips these when
    // building the next prompt so they never poison context.
    isFallback: Boolean(message.isFallback),
    createdAt: new Date().toISOString(),
  };

  session.messages.push(entry);

  // Trim oldest messages if we've exceeded the cap.
  // This keeps prompt size bounded for Gemini calls.
  if (session.messages.length > SESSION_MAX_MESSAGES) {
    const overflow = session.messages.length - SESSION_MAX_MESSAGES;
    session.messages.splice(0, overflow);
    logger.debug(
      { sessionId, trimmed: overflow },
      'Trimmed oldest messages from session',
    );
  }

  touchSession(sessionId);
  return entry;
}

/**
 * Clears the messages of a session without deleting the session itself.
 * Useful for "start over" buttons in the UI.
 *
 * @param {string} sessionId
 * @returns {boolean} true if the session existed and was reset.
 */
export function resetSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.messages = [];
  touchSession(sessionId);
  return true;
}

/**
 * Deletes a session entirely.
 *
 * @param {string} sessionId
 * @returns {boolean} true if a session was deleted.
 */
export function clearSession(sessionId) {
  return sessions.delete(sessionId);
}

/**
 * Returns basic stats useful for health checks / debugging.
 */
export function getStats() {
  return {
    activeSessions: sessions.size,
    ttlMs: SESSION_TTL_MS,
    maxMessages: SESSION_MAX_MESSAGES,
  };
}

// ============================================================
// TTL sweeper
// ============================================================

/**
 * Removes sessions that have been idle longer than SESSION_TTL_MS.
 * Exported for testing; normally invoked by the interval below.
 */
export function sweepExpiredSessions() {
  const now = Date.now();
  let evicted = 0;
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sessions.delete(id);
      evicted += 1;
    }
  }
  if (evicted > 0) {
    logger.info({ evicted, remaining: sessions.size }, 'Session sweep complete');
  }
}

// Start the sweeper. `.unref()` lets the Node.js process exit naturally
// even if the interval is still scheduled (useful for tests / shutdown).
const sweepTimer = setInterval(sweepExpiredSessions, SESSION_SWEEP_INTERVAL_MS);
sweepTimer.unref();

/**
 * Stops the sweep interval. Mainly used during graceful shutdown.
 */
export function stopSweeper() {
  clearInterval(sweepTimer);p0
}
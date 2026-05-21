
// Manages a pool of Gemini API keys and provides round-robin
// rotation across them. When a key returns a 429 (rate limit /
// quota), it is placed into a short cooldown so subsequent
// requests automatically skip it.
// Key reads from env on startup:
//   GEMINI_API_KEYS   - comma-separated list (preferred)
//   GEMINI_API_KEY    - single key (fallback for backward compatibility)


import { GoogleGenAI } from '@google/genai';
import logger from './logger.js';
import { GEMINI_KEY_COOLDOWN_MS } from './constants.js';

/**
 * Parses GEMINI_API_KEYS (comma-separated) with fallback to GEMINI_API_KEY.
 * Returns a deduplicated array of non-empty key strings.
 */
function loadKeysFromEnv() {
    const multi = (process.env.GEMINI_API_KEYS || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

    if (multi.length > 0) return [...new Set(multi)];

    const single = (process.env.GEMINI_API_KEY || '').trim();
    return single ? [single] : [];
}

const rawKeys = loadKeysFromEnv();

if (rawKeys.length === 0) {
    throw new Error(
        'No Gemini API keys configured. Set GEMINI_API_KEYS (preferred) or ' +
        'GEMINI_API_KEY in your .env file.',
    );
}

/**
 * Returns a masked label for logging — never leak the full key.
 * Example: "key-***xyz9"
 */
function maskKey(key) {
    if (!key || key.length < 4) return 'key-***';
    return `key-***${key.slice(-4)}`;
}

/**
 * @typedef {Object} PoolEntry
 * @property {string} id          - Masked id used in logs.
 * @property {GoogleGenAI} client - Pre-built SDK client for this key.
 * @property {number} cooldownUntil - Epoch ms; the key is considered
 * @property {number} inFlight    - Number of currently-running calls
 * @property {number} usageCount  - Total successful uses (informational).
 * @property {number} rateLimitCount - Total 429s observed (informational).
 */

/** @type {PoolEntry[]} */
const pool = rawKeys.map((key) => ({
    id: maskKey(key),
    client: new GoogleGenAI({ apiKey: key }),
    cooldownUntil: 0,
    inFlight: 0,
    usageCount: 0,
    rateLimitCount: 0,
}));

logger.info(
    { keyCount: pool.length, ids: pool.map((p) => p.id) },
    'Gemini key pool initialized',
);

// Round-robin pointer. Incremented each acquire.
let cursor = 0;


/**
 * Picks the next available client from the pool using round-robin,
 * skipping any keys still in cooldown.
 * Returns a release() function that the caller MUST invoke once the
 * API call completes (success or failure) so inFlight is accurate.
 * @returns {{ client: GoogleGenAI, id: string, release: () => void }}
 * @throws {Error & {status: 429}} when every key is in cooldown.
 */
export function acquireClient() {
    const now = Date.now();
    const n = pool.length;

    // Walk the ring up to n times looking for a usable key.
    for (let attempt = 0; attempt < n; attempt += 1) {
        const idx = (cursor + attempt) % n;
        const entry = pool[idx];

        if (entry.cooldownUntil <= now) {
            // Advance cursor past this key so the next request picks a different one.
            cursor = (idx + 1) % n;
            entry.inFlight += 1;
            entry.usageCount += 1;

            logger.debug({ keyId: entry.id, inFlight: entry.inFlight }, 'Key acquired');

            return {
                client: entry.client,
                id: entry.id,
                release: () => {
                    entry.inFlight = Math.max(0, entry.inFlight - 1);
                },
            };
        }
    }

    // Every key is in cooldown. Surface a 429 so the existing retry
    // layer in utils/retry.js backs off and tries again later, by
    // which point a key has hopefully cooled down.
    const earliest = Math.min(...pool.map((p) => p.cooldownUntil));
    const waitSec = Math.max(1, Math.ceil((earliest - now) / 1000));

    const err = new Error(
        `All Gemini keys are rate-limited. Earliest recovery in ~${waitSec}s.`,
    );
    err.status = 429;
    throw err;
}

/**
 * Marks a key as rate-limited so the pool skips it during cooldown.
 * @param {string} keyId - The masked id returned by acquireClient().
 */
export function markKeyRateLimited(keyId) {
    const entry = pool.find((p) => p.id === keyId);
    if (!entry) return;

    entry.cooldownUntil = Date.now() + GEMINI_KEY_COOLDOWN_MS;
    entry.rateLimitCount += 1;

    logger.warn(
        {
            keyId,
            cooldownMs: GEMINI_KEY_COOLDOWN_MS,
            totalHits: entry.rateLimitCount,
        },
        'Key entered cooldown due to rate limit',
    );
}

/**
 * Returns a snapshot of pool state. Useful for /health or debugging.
 */
export function getPoolStats() {
    const now = Date.now();
    return {
        totalKeys: pool.length,
        availableKeys: pool.filter((p) => p.cooldownUntil <= now).length,
        keys: pool.map((p) => ({
            id: p.id,
            available: p.cooldownUntil <= now,
            cooldownRemainingMs: Math.max(0, p.cooldownUntil - now),
            inFlight: p.inFlight,
            usageCount: p.usageCount,
            rateLimitCount: p.rateLimitCount,
        })),
    };
}
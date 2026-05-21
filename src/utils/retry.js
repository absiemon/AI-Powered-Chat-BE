// Generic async retry helper with exponential backoff.
// Only retries errors classified as "retryable" (rate limits, 5xx, timeouts).

import logger from '../config/logger.js';

/**
 * Default classification of which errors are worth retrying.
 * Retryable:
 *   - HTTP 429 (rate limited / quota)
 *   - HTTP 5xx (upstream server errors)
 *   - Aborted / timeout / network errors (no status code)
 * Non-retryable:
 *   - HTTP 4xx other than 429 (bad request, auth failure)
 * @param {Error & { status?: number, code?: string }} err
 * @returns {boolean}
*/

export function isRetryableError(err) {
    if (!err) return false;

    // Aborted (our timeout fired) — worth one more try.
    if (err.name === 'AbortError') return true;

    const retryableCodes = new Set([
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
        'EPIPE',
    ]);
    if (err.code && retryableCodes.has(err.code)) return true;

    const status = err.status || err.statusCode;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;

    return false;
}

/**
 * Sleep for the given milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes `fn` with retries on retryable failures.
 * @template T
 * @param {() => Promise<T>} fn - The async operation to attempt.
 * @param {object} [options]
 * @param {number} [options.maxAttempts=3]    - Total attempts including the first one.
 * @param {number} [options.baseDelayMs=500]  - Initial backoff delay.
 * @param {number} [options.factor=3]         - Exponential growth factor between attempts.
 * @param {(err: Error) => boolean} [options.shouldRetry=isRetryableError] - Predicate for retry decisions.
 * @param {string} [options.label='operation'] - Human-readable name for logs.
 * @returns {Promise<T>}
 */
export async function withRetry(fn, options = {}) {
    const {
        maxAttempts = 3,
        baseDelayMs = 500,
        factor = 3,
        shouldRetry = isRetryableError,
        label = 'operation',
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await fn();
        } 
        catch (err) {
            lastError = err;

            // Non-retryable errors short-circuit immediately.
            if (!shouldRetry(err)) {
                logger.debug(
                    { err, attempt, label },
                    'Non-retryable error, giving up immediately',
                );
                throw err;
            }

            // If we've exhausted attempts, surface the error.
            if (attempt >= maxAttempts) {
                logger.warn(
                    { err, attempt, label },
                    'All retry attempts exhausted',
                );
                throw err;
            }

            // Otherwise wait with exponential backoff + jitter and try again.
            const delay = baseDelayMs * Math.pow(factor, attempt - 1);
            const jitter = Math.floor(Math.random() * 200); // 0–199 ms
            const waitMs = delay + jitter;

            logger.info(
                { attempt, nextWaitMs: waitMs, label, errMessage: err?.message },
                'Retryable error, backing off',
            );

            await sleep(waitMs);
        }
    }

    throw lastError;
}
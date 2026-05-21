import { Type } from '@google/genai';
import {
    acquireClient,
    markKeyRateLimited,
} from '../config/geminiConfig.js';
import logger from '../config/logger.js';
import { safeJsonParse } from '../utils/jsonParser.js';
import { withRetry } from '../utils/retry.js';
import {
    GEMINI_MODEL,
    GEMINI_TIMEOUT_MS,
    CHAT_MAX_TOKENS,
    INSIGHT_MAX_TOKENS,
    CHAT_SYSTEM_PROMPT,
    INSIGHT_SYSTEM_PROMPT,
    ALLOWED_SENTIMENTS,
} from '../config/constants.js';

/**
 * Maps our internal conversation entries to the format Gemini expects:
 *   { role: 'user' | 'model', parts: [{ text }] }
 * Fallback entries are skipped — they are static templates produced
 * when the AI was unavailable, and feeding them back into the model
 * adds noise without value.
 */
function toGeminiContents(conversation) {
    return conversation
        .filter((entry) => !entry.isFallback)
        .map((entry) => ({
            role: entry.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: entry.text }],
        }));
}

/**
 * Wraps a promise with an AbortController-based timeout.
 */
async function withTimeout(fn, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fn(controller.signal);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Normalizes an insight object so the API always returns a predictable shape.
 */
function normalizeInsight(raw) {
    const intent =
        typeof raw?.intent === 'string' && raw.intent.trim()
            ? raw.intent.trim().toLowerCase()
            : 'unknown';

    const rawSentiment =
        typeof raw?.sentiment === 'string' ? raw.sentiment.trim().toLowerCase() : '';

    const sentiment = ALLOWED_SENTIMENTS.includes(rawSentiment)
        ? rawSentiment
        : 'neutral';

    return { intent, sentiment };
}

/**
 * Logs Gemini's finishReason when it indicates a problem.
 */
function logIfAbnormalFinish(response, label) {
    const finishReason = response?.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
        logger.warn(
            { finishReason, label },
            'Gemini response ended for non-STOP reason',
        );
    }
}

/**
 * Pulls a status code out of an error in a tolerant way. The Gemini
 * SDK exposes it at `err.status`, but Google's underlying transport
 * sometimes nests it under `err.error.code` or similar.
 */
function extractStatus(err) {
    return (
        err?.status ||
        err?.statusCode ||
        err?.error?.code ||
        err?.response?.status ||
        null
    );
}

/**
 * Acquires a client, runs the given operation against it, and:
 *   - on success, releases the key back to the pool
 *   - on 429, marks the key as rate-limited (cooldown) before releasing
 *   - on any error, still releases so inFlight stays correct
 *
 * The actual retry across keys is handled by the outer withRetry()
 * wrapper because that lets the existing backoff schedule absorb
 * the "all keys in cooldown" case as well.
 *
 * @template T
 * @param {(client: import('@google/genai').GoogleGenAI) => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function runWithPooledClient(operation) {
    // Throws a 429 if every key is currently in cooldown. That 429 is
    // retryable, so withRetry() will back off and try acquiring again.
    const { client, id, release } = acquireClient();

    try {
        const result = await operation(client);
        return result;
    }
    catch (err) {
        // If the upstream returned 429, this key is rate-limited — put it
        // into cooldown so the next acquireClient() skips it. The error
        // itself is re-thrown so withRetry() can decide whether to retry
        // with a different key.
        const status = extractStatus(err);
        if (status === 429) {
            markKeyRateLimited(id);
            // Normalize the error so retry.isRetryableError sees status=429.
            if (!err.status) err.status = 429;
        }
        throw err;
    } finally {
        release();
    }
}

/**
 * Generates an AI reply given the full conversation context.
 * Retries automatically on transient failures (429 / 5xx / timeout)
 * and rotates across all configured Gemini keys.
 */
export async function generateAIResponse(conversation) {
    const contents = toGeminiContents(conversation);

    logger.debug(
        { historyLength: contents.length },
        'Sending conversation to Gemini',
    );

    const response = await withRetry(
        () =>
            runWithPooledClient((client) =>
                withTimeout(
                    (signal) =>
                        client.models.generateContent({
                            model: GEMINI_MODEL,
                            contents,
                            config: {
                                systemInstruction: CHAT_SYSTEM_PROMPT,
                                temperature: 0.7,
                                maxOutputTokens: CHAT_MAX_TOKENS,
                                abortSignal: signal,
                            },
                        }),
                    GEMINI_TIMEOUT_MS,
                ),
            ),
        { label: 'gemini:chat', maxAttempts: 4 }, // bumped to 4 to take advantage of 4 keys
    );

    logIfAbnormalFinish(response, 'chat');

    const text = response?.text?.trim();
    return text || 'I am sorry, I could not generate a response.';
}

/**
 * Extracts intent and sentiment from a single user message.
 * Never throws — returns safe defaults on any failure.
 */
export async function extractInsight(userMessage) {
    const safeText = userMessage.replace(/"/g, '\\"');

    const userPrompt =
        `Analyze this message and respond with a JSON object containing ` +
        `"intent" (a short lowercase word such as "complaint", "query", ` +
        `"request", "greeting", "feedback", "smalltalk") and ` +
        `"sentiment" (one of "positive", "neutral", "negative").\n\n` +
        `Message: "${safeText}"`;

    try {
        const response = await withRetry(
            () =>
                runWithPooledClient((client) =>
                    withTimeout(
                        (signal) =>
                            client.models.generateContent({
                                model: GEMINI_MODEL,
                                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                                config: {
                                    systemInstruction: INSIGHT_SYSTEM_PROMPT,
                                    temperature: 0,
                                    maxOutputTokens: INSIGHT_MAX_TOKENS,
                                    responseMimeType: 'application/json',
                                    responseSchema: {
                                        type: Type.OBJECT,
                                        properties: {
                                            intent: { type: Type.STRING },
                                            sentiment: {
                                                type: Type.STRING,
                                                enum: ALLOWED_SENTIMENTS,
                                            },
                                        },
                                        required: ['intent', 'sentiment'],
                                    },
                                    abortSignal: signal,
                                },
                            }),
                        GEMINI_TIMEOUT_MS,
                    ),
                ),
            { label: 'gemini:insight', maxAttempts: 4 },
        );

        logIfAbnormalFinish(response, 'insight');

        const rawText = response?.text || '';
        const parsed = safeJsonParse(rawText);
        return normalizeInsight(parsed);
    } catch (error) {
        logger.warn({ err: error }, 'Insight extraction failed, returning defaults');
        return { intent: 'unknown', sentiment: 'neutral' };
    }
}

/**
 * Runs the chat completion and insight extraction in parallel,
 * each using its own pooled client. This means a single user message
 * occupies two keys briefly, which spreads load better than reusing
 * the same key for both calls.
 */
export async function generateReplyAndInsight(conversation, latestUserMessage) {
    const insightPromise = extractInsight(latestUserMessage);
    const replyPromise = generateAIResponse(conversation);
    const [reply, insight] = await Promise.all([replyPromise, insightPromise]);
    return { reply, insight };
}


















// import { Type } from '@google/genai';
// import geminiClient from '../config/geminiConfig.js';
// import logger from '../config/logger.js';
// import { safeJsonParse } from '../utils/jsonParser.js';
// import { withRetry } from '../utils/retry.js';
// import {
//     GEMINI_MODEL,
//     GEMINI_TIMEOUT_MS,
//     CHAT_MAX_TOKENS,
//     INSIGHT_MAX_TOKENS,
//     CHAT_SYSTEM_PROMPT,
//     INSIGHT_SYSTEM_PROMPT,
//     ALLOWED_SENTIMENTS,
// } from '../config/constants.js';

// // ============================================================
// // Helpers
// // ============================================================

// /**
//  * Maps our internal conversation entries to the format Gemini expects:
//  *   { role: 'user' | 'model', parts: [{ text }] }
//  * Internally we use "assistant" (OpenAI convention) but Gemini uses "model",
//  * so we translate at this boundary. Fallback entries are skipped — they
//  * are static templates produced when the AI was unavailable, and feeding
//  * them back into the model adds noise without value.
//  *
//  * @param {Array<{role: string, text: string, isFallback?: boolean}>} conversation
//  * @returns {Array<{role: 'user'|'model', parts: Array<{text: string}>}>}
//  */
// function toGeminiContents(conversation) {
//     return conversation
//         .filter((entry) => !entry.isFallback)
//         .map((entry) => ({
//             role: entry.role === 'assistant' ? 'model' : 'user',
//             parts: [{ text: entry.text }],
//         }));
// }

// /**
//  * Wraps a promise with an AbortController-based timeout.
//  * The Gemini SDK accepts an `abortSignal` in its config, which it honors.
//  *
//  * @param {(signal: AbortSignal) => Promise<T>} fn
//  * @param {number} timeoutMs
//  * @returns {Promise<T>}
//  */
// async function withTimeout(fn, timeoutMs) {
//     const controller = new AbortController();
//     const timer = setTimeout(() => controller.abort(), timeoutMs);
//     try {
//         return await fn(controller.signal);
//     } finally {
//         clearTimeout(timer);
//     }
// }

// /**
//  * Normalizes an insight object so the API always returns a predictable shape.
//  *
//  * @param {object|null} raw
//  * @returns {{ intent: string, sentiment: 'positive'|'neutral'|'negative' }}
//  */
// function normalizeInsight(raw) {
//     const intent =
//         typeof raw?.intent === 'string' && raw.intent.trim()
//             ? raw.intent.trim().toLowerCase()
//             : 'unknown';

//     const rawSentiment =
//         typeof raw?.sentiment === 'string' ? raw.sentiment.trim().toLowerCase() : '';

//     const sentiment = ALLOWED_SENTIMENTS.includes(rawSentiment)
//         ? rawSentiment
//         : 'neutral';

//     return { intent, sentiment };
// }

// /**
//  * Logs Gemini's finishReason when it indicates a problem.
//  * STOP = normal completion. Anything else means truncation, safety block, etc.
//  */
// function logIfAbnormalFinish(response, label) {
//     const finishReason = response?.candidates?.[0]?.finishReason;
//     if (finishReason && finishReason !== 'STOP') {
//         logger.warn(
//             { finishReason, label },
//             'Gemini response ended for non-STOP reason',
//         );
//     }
// }

// // ============================================================
// // Public API
// // ============================================================

// /**
//  * Generates an AI reply given the full conversation context.
//  * Retries automatically on transient failures (429 / 5xx / timeout).
//  * @param {Array} conversation - Ordered list of past messages (user + assistant).
//  * @returns {Promise<string>} The assistant's reply text.
//  * @throws Re-throws the last error if retries are exhausted or the error is non-retryable.
//  */
// export async function generateAIResponse(conversation) {
//     const contents = toGeminiContents(conversation);

//     logger.debug(
//         { historyLength: contents.length },
//         'Sending conversation to Gemini',
//     );

//     const response = await withRetry(
//         () =>
//             withTimeout(
//                 (signal) =>
//                     geminiClient.models.generateContent({
//                         model: GEMINI_MODEL,
//                         contents,
//                         config: {
//                             systemInstruction: CHAT_SYSTEM_PROMPT,
//                             temperature: 0.7,
//                             maxOutputTokens: CHAT_MAX_TOKENS,
//                             abortSignal: signal,
//                         },
//                     }),
//                 GEMINI_TIMEOUT_MS,
//             ),
//         { label: 'gemini:chat' },
//     );

//     logIfAbnormalFinish(response, 'chat');

//     // `response.text` is a convenience accessor that returns the concatenated
//     // text of all parts in the first candidate. May be empty if the model was
//     // blocked by safety filters — the caller should handle that case.
//     const text = response?.text?.trim();
//     return text || 'I am sorry, I could not generate a response.';
// }

// /**
//  * Extracts intent and sentiment from a single user message.
//  * Uses Gemini's structured-output mode for reliable JSON parsing.
//  * Never throws — returns safe defaults on any failure, since insight
//  * extraction is a non-critical enrichment.
//  * @param {string} userMessage
//  * @returns {Promise<{ intent: string, sentiment: 'positive'|'neutral'|'negative' }>}
//  */
// export async function extractInsight(userMessage) {
//     // Escape any embedded quotes so the model sees clean input.
//     const safeText = userMessage.replace(/"/g, '\\"');

//     const userPrompt =
//         `Analyze this message and respond with a JSON object containing ` +
//         `"intent" (a short lowercase word such as "complaint", "query", ` +
//         `"request", "greeting", "feedback", "smalltalk") and ` +
//         `"sentiment" (one of "positive", "neutral", "negative").\n\n` +
//         `Message: "${safeText}"`;

//     try {
//         const response = await withRetry(
//             () =>
//                 withTimeout(
//                     (signal) =>
//                         geminiClient.models.generateContent({
//                             model: GEMINI_MODEL,
//                             contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
//                             config: {
//                                 systemInstruction: INSIGHT_SYSTEM_PROMPT,
//                                 temperature: 0,
//                                 maxOutputTokens: INSIGHT_MAX_TOKENS,
//                                 // Force structured JSON output. Gemini guarantees the response
//                                 // matches this schema, eliminating parse failures.
//                                 responseMimeType: 'application/json',
//                                 responseSchema: {
//                                     type: Type.OBJECT,
//                                     properties: {
//                                         intent: { type: Type.STRING },
//                                         sentiment: {
//                                             type: Type.STRING,
//                                             enum: ALLOWED_SENTIMENTS,
//                                         },
//                                     },
//                                     required: ['intent', 'sentiment'],
//                                 },
//                                 abortSignal: signal,
//                             },
//                         }),
//                     GEMINI_TIMEOUT_MS,
//                 ),
//             { label: 'gemini:insight' },
//         );

//         logIfAbnormalFinish(response, 'insight');

//         const rawText = response?.text || '';
//         const parsed = safeJsonParse(rawText);
//         return normalizeInsight(parsed);
//     } catch (error) {
//         // Insight extraction is non-critical — log and return a safe default.
//         logger.warn({ err: error }, 'Insight extraction failed, returning defaults');
//         return { intent: 'unknown', sentiment: 'neutral' };
//     }
// }

// /**
//  * Runs the chat completion and insight extraction in parallel.
//  * Cuts latency roughly in half compared to sequential calls.
//  *
//  * IMPORTANT: This throws if the chat call fails permanently. The controller
//  * is expected to catch that, await the insight (which never throws), and
//  * build a contextual fallback reply.
//  *
//  * @param {Array} conversation - Full conversation including the latest user message.
//  * @param {string} latestUserMessage - The user message to analyze for insights.
//  * @returns {Promise<{ reply: string, insight: object }>}
//  */
// export async function generateReplyAndInsight(conversation, latestUserMessage) {
//     // Kick off both calls in parallel. We grab the insight promise separately
//     // so the controller can await it independently if the chat call fails.
//     const insightPromise = extractInsight(latestUserMessage);
//     const replyPromise = generateAIResponse(conversation);

//     const [reply, insight] = await Promise.all([replyPromise, insightPromise]);
//     return { reply, insight };
// }

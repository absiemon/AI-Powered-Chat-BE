
import logger from '../config/logger.js';
import * as sessionService from '../services/sessionService.js';
import * as aiService from '../services/aiService.js';
import { buildFallbackResponse } from '../utils/fallbackResponses.js';

/**
 * POST /api/chat
 * Body: { sessionId?: string, message: string }
 * Response shape:
 * {
 *   sessionId: string,
 *   userMessage: Entry,
 *   assistantMessage: Entry,    // includes isFallback: true when degraded
 *   insight: { intent, sentiment },
 *   conversation: Entry[]
 * }
 */
export async function sendChatMessage(req, res, next) {
    try {
        const { sessionId, message } = req.body;

        // 1. Resolve or create the session.
        const activeSessionId = sessionService.getOrCreateSession(sessionId);

        // 2. Persist the user's message FIRST, so the conversation context
        //    sent to the AI includes their latest message.
        const userEntry = sessionService.appendMessage(activeSessionId, {
            role: 'user',
            text: message,
        });

        // 3. Snapshot the conversation AFTER appending so the model sees
        //    the latest user message in its prompt.
        const conversation = sessionService.getConversation(activeSessionId);

        // 4. Kick off insight + reply in parallel.
        //    - insight never throws (it returns defaults on failure)
        //    - reply may throw if Gemini is unavailable after retries
        //    We start them together but handle failure separately so the
        //    insight is still available to shape a fallback reply.
        const insightPromise = aiService.extractInsight(message);
        const replyPromise = aiService.generateAIResponse(conversation);

        let reply;
        let insight;
        let isFallback = false;

        try {
            // Happy path: both succeed.
            [reply, insight] = await Promise.all([replyPromise, insightPromise]);
        } catch (aiError) {
            // The reply call failed after all retries. The insight call is
            // independent and likely succeeded — await it so we can shape
            // an intent-aware fallback message.
            logger.error(
                { err: aiError, sessionId: activeSessionId },
                'AI reply generation failed after retries, falling back',
            );

            insight = await insightPromise; // safe; extractInsight never throws
            reply = buildFallbackResponse(insight);
            isFallback = true;
        }

        // 5. Persist the assistant's reply along with the extracted insight.
        //    Fallback entries are flagged so:
        //      - the frontend can style them differently (e.g., "retry" hint)
        //      - the aiService can filter them out of future prompt context
        const assistantEntry = sessionService.appendMessage(activeSessionId, {
            role: 'assistant',
            text: reply,
            insight,
            isFallback,
        });

        logger.info(
            {
                sessionId: activeSessionId,
                intent: insight.intent,
                sentiment: insight.sentiment,
                isFallback,
            },
            'Chat request processed',
        );

        return res.status(200).json({
            sessionId: activeSessionId,
            userMessage: userEntry,
            assistantMessage: assistantEntry,
            insight,
            conversation: sessionService.getConversation(activeSessionId),
        });
    } 
    catch (error) {
        // Reaches here only on non-AI failures (session, validation, unknown).
        return next(error);
    }
}

/**
 * GET /api/chat/:sessionId
 * Returns the full conversation history for a session.
 */
export function getConversationHistory(req, res) {
    const { sessionId } = req.params;
    const conversation = sessionService.getConversation(sessionId);
    return res.status(200).json({ sessionId, conversation });
}

/**
 * DELETE /api/chat/:sessionId
 * Clears all messages for a session but keeps the session alive.
 * Returns 404 if the session doesn't exist.
 */
export function resetConversation(req, res) {
    const { sessionId } = req.params;
    const ok = sessionService.resetSession(sessionId);
    if (!ok) {
        return res.status(404).json({ message: 'Session not found.' });
    }
    return res.status(200).json({ sessionId, message: 'Conversation reset.' });
}
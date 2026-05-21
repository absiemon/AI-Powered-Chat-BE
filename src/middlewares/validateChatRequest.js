
import { MAX_MESSAGE_LENGTH } from '../config/constants.js';

/**
 * Express middleware that ensures req.body contains a valid chat message.
 * On success, normalizes the message (trims whitespace) and continues.
 * On failure, responds with HTTP 400 and a descriptive error.
 */
export default function validateChatRequest(req, res, next) {
  const { message, sessionId } = req.body || {};

  // message must exist and be a string
  if (typeof message !== 'string') {
    return res
      .status(400)
      .json({ message: 'Field "message" is required and must be a string.' });
  }

  const trimmed = message.trim();

  if (trimmed.length === 0) {
    return res
      .status(400)
      .json({ message: 'Field "message" cannot be empty.' });
  }

  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      message: `Field "message" exceeds the maximum length of ${MAX_MESSAGE_LENGTH} characters.`,
    });
  }

  // sessionId is optional but if provided must be a string.
  if (sessionId !== undefined && typeof sessionId !== 'string') {
    return res
      .status(400)
      .json({ message: 'Field "sessionId" must be a string when provided.' });
  }

  req.body.message = trimmed;

  return next();
}
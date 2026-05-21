// src/routes/chatRoutes.js
import express from 'express';
import {
  sendChatMessage,
  getConversationHistory,
  resetConversation,
} from '../controllers/chatController.js';
import validateChatRequest from '../middlewares/validateChatRequest.js';
import chatRateLimiter from '../middlewares/rateLimiter.js';

const router = express.Router();

router.use(chatRateLimiter);

router.post('/', validateChatRequest, sendChatMessage);
router.get('/:sessionId', getConversationHistory);
router.delete('/:sessionId', resetConversation);

export default router;
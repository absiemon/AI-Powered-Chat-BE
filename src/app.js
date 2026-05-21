import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';

import chatRoutes from './routes/chatRoutes.js';
import requestLogger from './middlewares/requestLogger.js';
import errorHandler from './middlewares/errorHandler.js';
import { getStats } from './services/sessionService.js';
import { getPoolStats } from './config/geminiKeyPool.js';
import { CORS_ORIGINS } from './config/constants.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());

app.use(
  cors({
    origin: CORS_ORIGINS.includes('*') ? true : CORS_ORIGINS,
    credentials: true,
  }),
);

app.use(express.json({ limit: '64kb' }));
app.use(requestLogger);


/**
 * Liveness probe + pool diagnostics. Shows which Gemini keys are
 * currently available vs in cooldown, which is invaluable when
 * debugging quota issues.
 */

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    sessions: getStats(),
    geminiKeyPool: getPoolStats(),
  });
});

app.use('/api/chat', chatRoutes);


app.use((req, res) => {
  res
    .status(404)
    .json({ message: `Resource not found: ${req.method} ${req.originalUrl}` });
});

app.use(errorHandler);

export default app;
// src/index.js
import app from './app.js';
import logger from './config/logger.js';
import { stopSweeper } from './services/sessionService.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

const server = app.listen(PORT, () => {
  logger.info(`AI chat backend listening on http://localhost:${PORT}`);
});

function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received');

  const forceExitTimer = setTimeout(() => {
    logger.warn('Forcing exit after 10s shutdown timeout');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error during server shutdown');
      process.exit(1);
    }

    stopSweeper();
    logger.info('Server closed cleanly');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});
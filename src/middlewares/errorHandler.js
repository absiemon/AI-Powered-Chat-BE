import logger from '../config/logger.js';

const isProduction = process.env.NODE_ENV === 'production';

export default function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  logger.error(
    {
      err,
      url: req.originalUrl,
      method: req.method,
    },
    'Unhandled error',
  );

  // Decide what to send the client.
  const safeMessage =
    status < 500
      ? err.message || 'Bad request'
      : isProduction
        ? 'Internal server error'
        : err.message || 'Internal server error';

  const payload = { message: safeMessage };

  // Expose the stack only in non-production environments, for easier debugging.
  if (!isProduction && err.stack) {
    payload.stack = err.stack;
  }

  res.status(status).json(payload);
}

import pinoHttp from 'pino-http';
import logger from '../config/logger.js';

const requestLogger = pinoHttp({
  logger,

  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    // Health check endpoints are hit constantly by uptime monitors —
    // keep them out of the info stream.
    if (req.url === '/health') return 'debug';
    return 'info';
  },

  // Slim down the auto-serialized request object.
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});

export default requestLogger;
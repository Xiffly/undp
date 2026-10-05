import { randomUUID } from 'node:crypto';
import type { RequestHandler, ErrorRequestHandler } from 'express';
import { logger, requestContext } from './logger';

export const requestLogging: RequestHandler = (req, res, next) => {
  const supplied = req.get('X-Request-ID');
  const requestId = supplied && /^[a-zA-Z0-9_-]{1,80}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader('X-Request-ID', requestId);
  const started = performance.now();
  requestContext.run({ requestId }, () => {
    res.on('finish', () => logger.info('http.request.completed', {
      requestId, method: req.method, route: req.route?.path || req.baseUrl || 'unmatched',
      status: res.statusCode, durationMs: Math.round(performance.now() - started),
    }));
    next();
  });
};

export const errorLogging: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  logger.error('http.request.failed', { error });
  if (res.headersSent) { next(error); return; }
  const status = typeof error === 'object' && error !== null && 'status' in error
    && typeof error.status === 'number' && error.status >= 400 && error.status < 500 ? error.status : 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : 'Invalid request',
    requestId: res.getHeader('X-Request-ID') });
};

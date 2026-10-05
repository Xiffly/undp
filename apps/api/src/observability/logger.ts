import { AsyncLocalStorage } from 'node:async_hooks';
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: 'crisis-platform@1.0.0',
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
      graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
      databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0,
    },
    defaultIntegrations: false,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.breadcrumbs;
      return event;
    },
  });
}

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
type Fields = Record<string, unknown>;
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /password|secret|token|authorization|cookie|api.?key/i.test(key) ? '[redacted]' : sanitize(item, depth + 1)]));
  }
  return typeof value === 'bigint' ? String(value) : value;
}
function write(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  // Callers supply operational metadata; request bodies, headers and credentials are never logged.
  const normalized = sanitize(fields) as Fields;
  const record = JSON.stringify({ ...normalized, timestamp: new Date().toISOString(), level, event,
    requestId: requestContext.getStore()?.requestId });
  if (level === 'error' && process.env.SENTRY_DSN) {
    const exception = fields.error instanceof Error ? fields.error
      : Array.isArray(fields.details) ? fields.details.find((entry) => entry instanceof Error) : undefined;
    const options = { tags: { event }, extra: { ...normalized, requestId: requestContext.getStore()?.requestId } };
    if (exception) Sentry.captureException(exception, options);
    else Sentry.captureMessage(event, { ...options, level: 'error' });
  }
  if (level === 'error') console.error(record);
  else if (level === 'warn') console.warn(record);
  else console.log(record);
}
export const logger = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
};

export async function flushErrorMonitoring(): Promise<void> {
  if (process.env.SENTRY_DSN) await Sentry.flush(2000);
}

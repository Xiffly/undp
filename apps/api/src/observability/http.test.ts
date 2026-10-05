import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { errorLogging, requestLogging } from './http';
import { logger, requestContext } from './logger';

let server: Server;
let base: string;
const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
beforeAll(async () => {
  const app = express();
  app.use(requestLogging);
  app.get('/context', async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    res.json({ requestId: requestContext.getStore()?.requestId });
  });
  app.get('/error', (_req, _res, next) => next(new Error('Private diagnostic')));
  app.use(errorLogging);
  server = await new Promise<Server>((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  spy.mockRestore(); errorSpy.mockRestore();
});
it('keeps request IDs isolated across concurrent asynchronous requests', async () => {
  const results = await Promise.all(['request-a', 'request-b'].map(async (requestId) => {
    const response = await fetch(base + '/context', { headers: { 'X-Request-ID': requestId } });
    return { header: response.headers.get('X-Request-ID'), body: await response.json() };
  }));
  expect(results).toEqual([
    { header: 'request-a', body: { requestId: 'request-a' } },
    { header: 'request-b', body: { requestId: 'request-b' } },
  ]);
});
it('returns a traceable generic error and logs diagnostic details', async () => {
  const response = await fetch(base + '/error', { headers: { 'X-Request-ID': 'error-request' } });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal server error', requestId: 'error-request' });
  const record = JSON.parse(String(errorSpy.mock.calls.at(-1)?.[0]));
  expect(record).toMatchObject({ event: 'http.request.failed', requestId: 'error-request', error: { message: 'Private diagnostic' } });
});
it('redacts credential fields in nested operational metadata', () => {
  logger.info('test.redaction', { secret: 'private', details: [{ password: 'private', safe: 1 }] });
  const record = JSON.parse(String(spy.mock.calls.at(-1)?.[0]));
  expect(record.secret).toBe('[redacted]');
  expect(record.details).toEqual([{ password: '[redacted]', safe: 1 }]);
});

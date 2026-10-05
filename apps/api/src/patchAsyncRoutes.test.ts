import { describe, expect, it, vi } from 'vitest';
import { wrapAsyncRouteHandler } from './patchAsyncRoutes';

describe('wrapAsyncRouteHandler', () => {
  it('forwards rejected async handlers to next', async () => {
    const next = vi.fn();
    const error = new Error('db down');
    const wrapped = wrapAsyncRouteHandler(async (req: unknown, res: unknown, nextFn: unknown) => {
      void req;
      void res;
      void nextFn;
      throw error;
    }) as (req: never, res: never, nextFn: (...args: unknown[]) => unknown) => void;

    wrapped({} as never, {} as never, next);
    await Promise.resolve();

    expect(next).toHaveBeenCalledWith(error);
  });

  it('forwards synchronous throws to next', () => {
    const next = vi.fn();
    const error = new Error('boom');
    const wrapped = wrapAsyncRouteHandler((req: unknown, res: unknown, nextFn: unknown) => {
      void req;
      void res;
      void nextFn;
      throw error;
    }) as (req: never, res: never, nextFn: (...args: unknown[]) => unknown) => void;

    wrapped({} as never, {} as never, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('does not wrap express error handlers', () => {
    const handler = (err: unknown, req: unknown, res: unknown, next: (value?: unknown) => void) => {
      void req;
      void res;
      next(err);
    };

    expect(wrapAsyncRouteHandler(handler)).toBe(handler);
  });
});

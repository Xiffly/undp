import express, { type NextFunction, type Request, type Response } from 'express';

type RouteHandler = (req: Request, res: Response, next: NextFunction) => unknown;
type RouterMethod = (...args: unknown[]) => unknown;

const PATCH_FLAG = Symbol.for('undp-crisis.async-routes-patched');
const ROUTER_METHODS = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof (value as PromiseLike<unknown>).then === 'function';
}

export function wrapAsyncRouteHandler<T>(value: T): T {
  if (typeof value !== 'function') return value;

  const handler = value as RouteHandler;
  if (handler.length >= 4) return value;

  return (((req: Request, res: Response, next: NextFunction) => {
    try {
      const result = handler(req, res, next);
      if (isPromiseLike(result)) {
        void Promise.resolve(result).then(undefined, next);
      }
    } catch (error) {
      next(error);
    }
  }) as unknown) as T;
}

function wrapHandlerArg(arg: unknown): unknown {
  if (Array.isArray(arg)) {
    return arg.map((entry) => wrapHandlerArg(entry));
  }
  return wrapAsyncRouteHandler(arg);
}

export function installAsyncRouteHandling(): void {
  const RouterFactory = express.Router as unknown as { [PATCH_FLAG]?: boolean } & ((options?: unknown) => unknown);
  if (RouterFactory[PATCH_FLAG]) return;

  const baseRouter = express.Router;
  const routerMethods = baseRouter as unknown as Record<string, RouterMethod>;
  for (const method of ROUTER_METHODS) {
    const original = routerMethods[method];
    routerMethods[method] = function patchedRouterMethod(this: unknown, ...args: unknown[]) {
      return original.apply(this, args.map((arg) => wrapHandlerArg(arg)));
    };
  }

  RouterFactory[PATCH_FLAG] = true;
}

installAsyncRouteHandling();

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../dbRuntime';
import { getAdminSessionUser, isTrustedSessionRequest, readAdminCookie } from '../services/adminSessions';
import { logger } from '../observability/logger';

const JWT_SECRET = process.env.JWT_SECRET || '';

interface JwtPayload {
  id?: string;
  email?: string;
  role?: string;
  name?: string;
  isAdmin?: boolean;
  internal?: boolean;
}

const INTEGRATION_TOKEN = process.env.WHATSAPP_SERVICE_TOKEN || process.env.INTEGRATION_TOKEN || '';

export type AuthenticatedRequest = Request & {
  user?: JwtPayload;
  isAdmin?: boolean;
};

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

async function resolveAuthenticatedUser(payload: JwtPayload): Promise<JwtPayload | null> {
  if (!payload?.id) {
    if (payload.internal && (payload.isAdmin || payload.role === 'admin')) {
      return {
        role: 'admin',
        isAdmin: true,
        internal: true,
      };
    }
    return null;
  }

  const user = await queryOne<{
    id: string;
    email: string;
    role: string;
    name?: string | null;
    active: boolean;
  }>('SELECT id, email, role, name, active FROM users WHERE id = ?', [payload.id]);

  if (!user || !user.active) return null;

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name || undefined,
    isAdmin: user.role === 'admin',
  };
}

async function authenticate(req: Request): Promise<JwtPayload | null> {
  const token = readBearerToken(req);
  if (token) {
    let payload: JwtPayload;
    try {
      const verified = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof verified === 'string') return null;
      payload = verified as JwtPayload;
    } catch { return null; }
    if (process.env.NODE_ENV === 'production' && (payload.isAdmin || ['admin', 'team_lead', 'field_officer'].includes(payload.role || ''))) return null;
    const user = await resolveAuthenticatedUser(payload);
    if (process.env.NODE_ENV === 'production' && user && ['admin', 'team_lead', 'field_officer'].includes(user.role || '')) return null;
    return user;
  }
  const user = await getAdminSessionUser(req);
  return user ? { id: user.id, email: user.email, role: user.role, name: user.name || undefined, isAdmin: user.role === 'admin' } : null;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!JWT_SECRET) { res.status(500).json({ error: 'Authentication is not configured' }); return; }
  if (readAdminCookie(req) && !isTrustedSessionRequest(req)) {
    res.status(403).json({ error: 'Untrusted request origin' }); return;
  }
  try {
    const user = await authenticate(req);
    if (!user) { res.status(401).json({ error: 'Invalid or expired session' }); return; }
    Object.assign(req, { user, isAdmin: Boolean(user.isAdmin) });
    next();
  } catch (error) {
    logger.error('auth.lookup.failed', { error });
    next(error);
  }
}

export async function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!JWT_SECRET) { next(); return; }
  if (readAdminCookie(req) && !isTrustedSessionRequest(req)) {
    res.status(403).json({ error: 'Untrusted request origin' }); return;
  }
  try {
    const user = await authenticate(req);
    if (user) Object.assign(req, { user, isAdmin: Boolean(user.isAdmin) });
    next();
  } catch (error) {
    logger.error('auth.lookup.failed', { error });
    next(error);
  }
}

const ROLE_LEVELS: Record<string, number> = {
  admin: 3,
  team_lead: 2,
  field_officer: 1,
  public_user: 0,
};

export function requireRole(minRole: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) { res.status(401).json({ error: 'Unauthorized' }); return; }

    // Admin acts as the operational override so global access does not depend on every route's role map.
    if (user.isAdmin) { next(); return; }

    const userLevel = ROLE_LEVELS[user.role || ''] || 0;
    const requiredLevel = ROLE_LEVELS[minRole] ?? 99;

    if (userLevel < requiredLevel) {
      res.status(403).json({ error: `Requires ${minRole} role or higher` });
      return;
    }
    next();
  };
}

export async function adminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  await authMiddleware(req, res, () => requireRole('admin')(req, res, next));
}

export function requireIntegrationAuth(req: Request, res: Response, next: NextFunction): void {
  if (!INTEGRATION_TOKEN) {
    res.status(500).json({ error: 'Integration authentication is not configured' });
    return;
  }
  const token = String(req.headers['x-integration-token'] || '').trim();
  if (!token || token !== INTEGRATION_TOKEN) {
    res.status(401).json({ error: 'Unauthorized integration request' });
    return;
  }
  next();
}

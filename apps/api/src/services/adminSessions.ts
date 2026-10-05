import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { execute, queryOne } from '../dbRuntime';

export const ADMIN_SESSION_SECONDS = 30 * 60;
export const ADMIN_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-crisis_admin' : 'crisis_admin';
const cookieOptions: CookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict', path: '/' };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface SessionUser {
  id: string; email: string; name: string | null; role: string; active: boolean;
}

export function readAdminCookie(req: Request): string | null {
  const entry = req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_COOKIE}=`));
  if (!entry) return null;
  const value = entry.slice(ADMIN_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export function isTrustedSessionRequest(req: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  if (req.get('Sec-Fetch-Site') === 'cross-site') return false;
  const origin = req.get('Origin');
  if (!origin) return true; // CLI clients do not attach browser ambient credentials.
  const base = process.env.APP_BASE_URL || 'http://localhost:5173';
  const allowed = [new URL(base).origin];
  if (process.env.NODE_ENV === 'production' && process.env.DOMAIN) {
    const alias = new URL(base);
    alias.hostname = process.env.DOMAIN.replace(/^www\./i, '');
    allowed.push(alias.origin);
    alias.hostname = `www.${alias.hostname}`;
    allowed.push(alias.origin);
  }
  if (process.env.NODE_ENV !== 'production') allowed.push('http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:8080', 'http://localhost:8080');
  return allowed.includes(origin);
}

export async function getAdminSessionUser(req: Request): Promise<SessionUser | null> {
  const token = readAdminCookie(req);
  if (!token) return null;
  return await queryOne<SessionUser>(`SELECT u.id, u.email, u.name, u.role, u.active
    FROM admin_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.active = TRUE
      AND u.role IN ('admin', 'team_lead', 'field_officer')`, [hash(token)]) || null;
}

export async function revokeAdminSession(req: Request, res: Response): Promise<void> {
  const token = readAdminCookie(req);
  if (token) await execute('DELETE FROM admin_sessions WHERE token_hash = ?', [hash(token)]);
  res.clearCookie(ADMIN_COOKIE, cookieOptions);
}

export async function createAdminSession(req: Request, res: Response, userId: string): Promise<void> {
  await revokeAdminSession(req, res);
  await execute('DELETE FROM admin_sessions WHERE expires_at <= NOW()');
  const token = randomBytes(32).toString('hex');
  await execute('INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [hash(token), userId, new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000)]);
  res.cookie(ADMIN_COOKIE, token, { ...cookieOptions, maxAge: ADMIN_SESSION_SECONDS * 1000 });
}

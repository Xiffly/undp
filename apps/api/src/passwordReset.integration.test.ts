import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initRuntimeDb, queryOne, execute, closeRuntimeDb } from './dbRuntime';
import usersRouter from './routes/users';
import adminRouter from './routes/admin';
import { authMiddleware } from './middleware/auth';

const delivered = vi.hoisted(() => ({ token: '', email: '' }));
vi.mock('./email', () => ({ sendPasswordResetEmail: vi.fn(async (email: string, token: string) => {
  delivered.email = email; delivered.token = token; return { delivered: true };
}) }));
const enabled = process.env.CI === 'true' || process.env.RUN_DB_INTEGRATION === 'true';
let server: Server;
let base: string;
const email = `reset-integration-${Date.now()}@test.invalid`;
const userId = `reset-integration-${Date.now()}`;
let headers: Record<string, string>;

describe.skipIf(!enabled)('password reset over HTTP with PostgreSQL and captured mail delivery', () => {
  beforeAll(async () => {
    await initRuntimeDb();
    await execute('INSERT INTO users (id, name, email, password_hash, role, active) VALUES (?, ?, ?, ?, ?, TRUE)',
      [userId, 'Reset test', email, await bcrypt.hash('Original-Password-2026', 12), 'public_user']);
    const consent = await queryOne<{ value: string }>("SELECT value FROM consent_settings WHERE key = 'consent_version'");
    // Consent defaults are loaded by the same service as the application.
    const { getConsentSettings } = await import('./services/consentSettings');
    const settings = await getConsentSettings();
    headers = { 'Content-Type': 'application/json', 'X-Consent-Choice': 'necessary_only', 'X-Consent-Version': consent?.value || settings.consentVersion };
    const app = express();
    app.use(express.json());
    app.use('/api/users', usersRouter);
    app.use('/api/admin', adminRouter);
    app.get('/protected', authMiddleware, (_req, res) => res.json({ ok: true }));
    server = await new Promise<Server>((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server port');
    base = `http://127.0.0.1:${address.port}/api/users`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
    await execute('DELETE FROM users WHERE id = ?', [userId]);
    await closeRuntimeDb();
  });
  it('delivers a single-use link, changes credentials, and rejects reuse', async () => {
    const post = (route: string, data: object) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(data) });
    expect((await post('/forgot-password', { email })).status).toBe(200);
    expect(delivered.email).toBe(email);
    expect(delivered.token.length).toBeGreaterThan(20);
    const row = await queryOne<{ token_hash: string }>('SELECT token_hash FROM password_reset_tokens WHERE user_id = ?', [userId]);
    expect(row?.token_hash).not.toBe(delivered.token);
    expect((await post('/reset-password', { token: delivered.token, new_password: 'Updated-Password-2026' })).status).toBe(200);
    expect((await post('/login', { email, password: 'Updated-Password-2026' })).status).toBe(200);
    expect((await post('/login', { email, password: 'Original-Password-2026' })).status).toBe(401);
    expect((await post('/reset-password', { token: delivered.token, new_password: 'Another-Password-2026' })).status).toBe(400);
  });

  it('allows exactly one concurrent redemption of a reset link', async () => {
    await fetch(base + '/forgot-password', { method: 'POST', headers, body: JSON.stringify({ email }) });
    const body = JSON.stringify({ token: delivered.token, new_password: 'Updated-Password-2026' });
    const responses = await Promise.all([1, 2].map(() => fetch(base + '/reset-password', { method: 'POST', headers, body })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
  });

  it('rotates admin sessions, rejects CSRF, and revokes them on logout', async () => {
    const originBase = base.replace('/api/users', '');
    const login = (cookie = '') => fetch(`${originBase}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
    });
    const first = await login();
    expect(first.status).toBe(200);
    const firstCookie = first.headers.getSetCookie().at(-1)!.split(';')[0];
    expect(first.headers.getSetCookie().at(-1)).toContain('HttpOnly');
    expect(first.headers.getSetCookie().at(-1)).toContain('SameSite=Strict');
    const rotated = await login(firstCookie);
    const secondCookie = rotated.headers.getSetCookie().at(-1)!.split(';')[0];
    expect(secondCookie).not.toBe(firstCookie);
    const session = (cookie: string) => fetch(`${originBase}/api/admin/session`, { headers: { Cookie: cookie } });
    expect((await session(firstCookie)).status).toBe(401);
    expect((await session(secondCookie)).status).toBe(200);
    const csrf = await fetch(`${originBase}/api/admin/logout`, { method: 'POST', headers: { Cookie: secondCookie, Origin: 'https://untrusted.invalid' } });
    expect(csrf.status).toBe(403);
    expect((await session(secondCookie)).status).toBe(200);
    expect((await fetch(`${originBase}/api/admin/logout`, { method: 'POST', headers: { Cookie: secondCookie } })).status).toBe(204);
    expect((await session(secondCookie)).status).toBe(401);
  });
  it('expires admin sessions in the database and rejects promoted users with old public JWTs in production', async () => {
    const originBase = base.replace('/api/users', '');
    const login = await fetch(`${originBase}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) });
    const cookie = login.headers.getSetCookie().at(-1)!.split(';')[0];
    await execute("UPDATE admin_sessions SET expires_at = NOW() - INTERVAL '1 minute'");
    expect((await fetch(`${originBase}/api/admin/session`, { headers: { Cookie: cookie } })).status).toBe(401);
    const publicLogin = await fetch(base + '/login', { method: 'POST', headers, body: JSON.stringify({ email, password: 'Updated-Password-2026' }) });
    const payload = await publicLogin.json() as { token: string };
    await execute("UPDATE users SET role = 'admin' WHERE id = ?", [userId]);
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = await fetch(`${originBase}/protected`, { headers: { Authorization: `Bearer ${payload.token}` } });
      expect(response.status).toBe(401);
    } finally { vi.unstubAllEnvs(); }
  });
  it('accepts configured browser origins and rejects unrelated origins in production', async () => {
    const originBase = base.replace('/api/users', '');
    const login = (origin: string) => fetch(`${originBase}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
    });
    vi.stubEnv('APP_BASE_URL', 'https://crisis.test');
    vi.stubEnv('DOMAIN', 'crisis.test');
    try {
      expect((await login('http://localhost:5173')).status).toBe(200);
      vi.stubEnv('NODE_ENV', 'production');
      expect((await login('https://crisis.test')).status).toBe(200);
      expect((await login('https://www.crisis.test')).status).toBe(200);
      expect((await login('https://untrusted.invalid')).status).toBe(403);
      expect((await login('http://localhost:5173')).status).toBe(403);
    } finally { vi.unstubAllEnvs(); }
  });

});

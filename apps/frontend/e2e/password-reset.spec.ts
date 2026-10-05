import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

test('a public user resets their password and cannot reuse the link', async ({ page, request }) => {
  const suffix = Date.now();
  const email = `reset-${suffix}@smoke.test`;
  const oldPassword = 'Old-Smoke-Password-2026';
  const newPassword = 'New-Smoke-Password-2026';
  const config = await (await request.get('/api/consent/config')).json();
  const headers = { 'X-Consent-Choice': 'necessary_only', 'X-Consent-Version': config.consent_version };
  const signup = await request.post('/api/users/register', { headers, data: { name: 'Reset User', email, password: oldPassword } });
  expect(signup.status()).toBe(201);
  // Seed a delivered token in the isolated smoke database. Token issuance and mail handoff are tested by the API integration suite.
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  const composeArgs = ['compose'];
  if (process.env.ENV_FILE) composeArgs.push('--env-file', process.env.ENV_FILE);
  composeArgs.push('-f', process.env.COMPOSE_FILE || '../../docker-compose.yml', 'exec', '-T', 'postgres',
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'crisis_user', '-d', 'crisis_db', '-c',
    `INSERT INTO password_reset_tokens (id, user_id, email, token_hash, expires_at)
      SELECT 'e2e-reset-${suffix}', id, email, '${hash}', NOW() + INTERVAL '15 minutes' FROM users WHERE email = '${email}'`);
  execFileSync('docker', composeArgs);
  await page.goto(`/reset-password?token=${token}`);
  await page.getByRole('button', { name: /^Necessary Only$/i }).click();
  await page.locator('form input[type="password"]').nth(0).fill(newPassword);
  await page.locator('form input[type="password"]').nth(1).fill(newPassword);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/login$/);
  const login = await request.post('/api/users/login', { headers, data: { email, password: newPassword } });
  expect(login.status()).toBe(200);
  expect((await request.post('/api/users/login', { headers, data: { email, password: oldPassword } })).status()).toBe(401);
  expect((await request.post('/api/users/reset-password', { headers, data: { token, new_password: oldPassword } })).status()).toBe(400);
});

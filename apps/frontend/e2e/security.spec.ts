import { expect, test } from '@playwright/test';

test('admin cookie survives reload, rejects cross-origin writes, and is revoked on logout', async ({ page, baseURL }) => {
  const request = page.request;
  await page.goto('/admin/login');
  await page.getByLabel(/^Email$/i).fill(process.env.ADMIN_EMAIL || 'bootstrap-admin@local');
  await page.getByLabel(/^Password$/i).fill(process.env.ADMIN_PASSWORD || 'change-me-to-a-strong-password');
  await page.getByRole('button', { name: /Sign In/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const cookie = (await page.context().cookies()).find((entry) => entry.name.endsWith('crisis_admin'));
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
  if (baseURL?.startsWith('https:')) expect(cookie?.secure).toBe(true);
  expect(await page.evaluate(() => [localStorage.getItem('admin_token'), localStorage.getItem('admin-auth')])).toEqual([null, null]);
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Dashboard$/i })).toBeVisible();
  const csrf = await request.post('/api/admin/logout', { headers: { Origin: 'https://untrusted.invalid' } });
  expect(csrf.status()).toBe(403);
  expect((await request.get('/api/admin/session')).status()).toBe(200);
  const savedCookie = `${cookie?.name}=${cookie?.value}`;
  expect((await request.post('/api/admin/logout')).status()).toBe(204);
  expect((await request.get('/api/admin/session', { headers: { Cookie: savedCookie } })).status()).toBe(401);
  await page.reload();
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test('public user signs up and signs in through the browser', async ({ page }) => {
  const email = `browser-${Date.now()}@smoke.test`;
  const password = 'Public-Smoke-Password-2026';
  await page.goto('/signup');
  await page.getByRole('button', { name: /^Necessary Only$/i }).click();
  await page.locator('form input[type="text"]').first().fill('Smoke User');
  await page.locator('form input[type="email"]').fill(email);
  await page.locator('form input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('button', { name: /^Logout/i }).first().click();
  await page.goto('/login');
  await page.locator('form input[type="email"]').fill(email);
  await page.locator('form input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account$/);
});

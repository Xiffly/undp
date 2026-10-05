import { expect, test } from '@playwright/test';

const ONE_PIXEL_PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000000970485973000003e8000003e801b57b526b0000001349444154089963f8cfc0f09f018cff333000001fee03fda92fc0e20000000049454e44ae426082', 'hex');

test('submits a live report and reviews it in admin', async ({ page, request }) => {
  const adminEmail = process.env.ADMIN_EMAIL || 'bootstrap-admin@local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'change-me-to-a-strong-password';
  const uniqueSuffix = Date.now().toString();
  const offset = ((Date.now() % 900) + 100) / 100000;
  const latitude = (15.3694 + offset).toFixed(6);
  const longitude = (44.191 + offset).toFixed(6);

  await page.goto('/submit');
  await page.getByRole('button', { name: /^Necessary Only$/i }).click();

  await page.getByLabel(/Latitude/i).fill(latitude);
  await page.getByLabel(/Longitude/i).fill(longitude);
  await page.getByRole('button', { name: /Continue/i }).click();

  await page.getByRole('button', { name: /Residential/i }).click();
  await page.getByRole('button', { name: /Earthquake/i }).click();
  await page.getByRole('button', { name: /Continue/i }).click();

  await page.getByRole('button', { name: /Minimal \/ No Damage/i }).click();
  await page.getByRole('button', { name: /Continue/i }).click();

  await page.getByRole('button', { name: /No damage observed/i }).click();
  await page.getByRole('button', { name: /Fully functional/i }).click();
  await page.getByRole('button', { name: /Food assistance and safe drinking water/i }).click();
  await page.getByRole('button', { name: /Continue/i }).click();

  await page.locator('input[type="file"]').setInputFiles({ name: 'smoke.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });
  await page.getByLabel(/Contact/i).fill(`e2e-${uniqueSuffix}@local.test`);

  await page.getByRole('button', { name: /Submit Report/i }).click();
  await expect(page.getByText(/Report Submitted/i)).toBeVisible({ timeout: 45_000 });

  const reportId = (await page.locator('p.font-mono').first().textContent())?.trim();
  expect(reportId).toMatch(/^CR-\d{4}-\d{4}$/);

  await page.goto('/admin/login');
  await page.getByLabel(/^Email$/i).fill(adminEmail);
  await page.getByLabel(/^Password$/i).fill(adminPassword);
  await page.getByRole('button', { name: /Sign In/i }).click();

  await expect(page.getByRole('heading', { name: /^Dashboard$/i })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('link', { name: /^Reports$/i }).click();

  await page.getByPlaceholder(/Search ID, location, name/i).fill(reportId || '');
  await expect(page.getByText(reportId || '')).toBeVisible({ timeout: 45_000 });

  await page.getByRole('button', { name: `View report ${reportId}`, exact: true }).click();
  await expect(page.locator('span.font-mono').filter({ hasText: reportId || '' }).first()).toBeVisible();
  const patchRequest = page.waitForResponse((response) =>
    response.request().method() === 'PATCH' &&
    response.url().includes(`/api/reports/${reportId}`) &&
    response.ok()
  );

  await page.getByRole('button', { name: /Verify/i }).click();
  await patchRequest;

  const adminLogin = await request.post('/api/admin/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  await expect
    .poll(async () => {
      const response = await request.get('/api/admin/reports?limit=20&offset=0');
      const data = await response.json();
      const report = data.reports.find((entry: { id: string; status: string }) => entry.id === reportId);
      return report?.status || '';
    }, { timeout: 45_000 })
    .toBe('verified');
});

test('switches language on the submission journey and updates direction metadata', async ({ page }) => {
  await page.goto('/submit');
  await page.getByRole('button', { name: /Switch language/i }).first().click();
  await page.getByRole('button', { name: /العربية/i }).click();

  await expect.poll(async () => page.locator('html').getAttribute('dir')).toBe('rtl');
  await expect.poll(async () => page.locator('html').getAttribute('lang')).toBe('ar');
});

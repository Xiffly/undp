import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8080',
    headless: true,
    ignoreHTTPSErrors: true,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: process.env.E2E_EXTERNAL_SERVER === 'true' ? undefined : {
    command: 'docker compose up -d --build',
    url: 'http://127.0.0.1:8080',
    cwd: '../..',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://mac.jasontally.com',
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: 'chromium', use: { channel: 'chrome' } }],
});

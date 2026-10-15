import { defineConfig } from '@playwright/test';

process.env.TEST_BASE_URL = process.env.THEMED_BASE_URL || 'http://127.0.0.1:2618';

export default defineConfig({
  testDir: './tests',
  testMatch: ['themed-games.spec.ts', 'own-cabinets.spec.ts', 'themed-account-security.spec.ts'],
  timeout: 90000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'artifacts/themed-games/results',
  use: {
    baseURL: process.env.THEMED_BASE_URL || 'http://127.0.0.1:5218',
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
  },
  webServer: process.env.THEMED_BASE_URL ? undefined : [
    {
      command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2618 npm run dev:web -- --port 5218 --strictPort',
      url: 'http://127.0.0.1:5218',
      reuseExistingServer: false,
    },
    {
      command: 'PORT=2618 AUTH_DB_PATH=:memory: node --import tsx server/index.ts',
      url: 'http://127.0.0.1:2618/healthz',
      reuseExistingServer: false,
    },
  ],
});

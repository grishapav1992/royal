import { defineConfig } from '@playwright/test';

process.env.TEST_BASE_URL = 'http://127.0.0.1:2608';

export default defineConfig({
  testDir: './tests',
  testMatch: ['own-cabinets.spec.ts', 'original-games.spec.ts', 'original-games-live.spec.ts', 'ezslots.spec.ts', 'originals-security.spec.ts', 'originals-account-security.spec.ts'],
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5208',
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2608 npm run dev:web -- --port 5208 --strictPort',
      url: 'http://127.0.0.1:5208',
      reuseExistingServer: false,
    },
    {
      command: 'PORT=2608 AUTH_DB_PATH=:memory: node --import tsx server/index.ts',
      url: 'http://127.0.0.1:2608/healthz',
      reuseExistingServer: false,
    },
  ],
});

import { defineConfig } from '@playwright/test';
process.env.TEST_BASE_URL = 'http://127.0.0.1:2628';
export default defineConfig({
  testDir: './tests', testMatch: ['github-games.spec.ts', 'doors.spec.ts', 'own-cabinets.spec.ts'],
  timeout: 120000, workers: 1, outputDir: 'artifacts/github-room/test-results',
  use: { baseURL: 'http://127.0.0.1:5228', channel: 'chrome', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: [
    { command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2628 npm run dev:web -- --port 5228 --strictPort', url: 'http://127.0.0.1:5228', reuseExistingServer: false },
    { command: 'PORT=2628 AUTH_DB_PATH=:memory: node --import tsx server/index.ts', url: 'http://127.0.0.1:2628/healthz', reuseExistingServer: false },
  ],
});

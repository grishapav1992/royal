import { defineConfig } from '@playwright/test';
process.env.TEST_BASE_URL = 'http://127.0.0.1:2632';
export default defineConfig({
  testDir: './tests', testMatch: 'cabinet-seating.spec.ts', timeout: 120000, workers: 1,
  outputDir: 'artifacts/cabinet-seating/test-results',
  use: { baseURL: 'http://127.0.0.1:5232', channel: 'chrome', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', actionTimeout: 15000 },
  webServer: [
    { command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2632 npm run dev:web -- --port 5232 --strictPort', url: 'http://127.0.0.1:5232', reuseExistingServer: false },
    { command: 'PORT=2632 AUTH_DB_PATH=:memory: node --import tsx server/index.ts', url: 'http://127.0.0.1:2632/healthz', reuseExistingServer: false },
  ],
});

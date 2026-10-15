import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'nile-wallet.spec.ts', timeout: 45000, workers: 1,
  use: { baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:5187', channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: process.env.TEST_BASE_URL ? undefined : [
    { command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2578 npm run dev:web -- --port 5187 --strictPort', url: 'http://127.0.0.1:5187', reuseExistingServer: false },
    { command: 'PORT=2578 AUTH_DB_PATH=/tmp/royal-nile-ui-test.sqlite node --import tsx server/index.ts', url: 'http://127.0.0.1:2578/healthz', reuseExistingServer: false },
  ],
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'elevator.spec.ts', timeout: 90000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5281', channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: [
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5281 --strictPort', url: 'http://127.0.0.1:5281', env: { ROYAL_DEV_API_URL: 'http://127.0.0.1:2681' }, reuseExistingServer: false },
    { command: 'node --import tsx server/index.ts', url: 'http://127.0.0.1:2681/healthz', env: { PORT: '2681' }, reuseExistingServer: false },
  ],
});

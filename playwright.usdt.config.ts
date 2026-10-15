import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'usdt-wallet.spec.ts', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5192', channel: 'chrome', viewport: { width: 390, height: 844 } },
  webServer: [
    { command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2592 npm run dev:web -- --port 5192 --strictPort', url: 'http://127.0.0.1:5192', reuseExistingServer: false },
    { command: 'node --import tsx scripts/check-usdt-ui.ts', url: 'http://127.0.0.1:2592/healthz', reuseExistingServer: false },
  ],
});

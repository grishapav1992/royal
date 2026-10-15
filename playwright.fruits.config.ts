import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['fruits.spec.ts', 'game-core.spec.ts', 'demo-wallet.spec.ts', 'casino-api-pro.spec.ts'],
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5207',
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'ROYAL_DEV_API_URL=http://127.0.0.1:2607 npm run dev:web -- --port 5207 --strictPort',
      url: 'http://127.0.0.1:5207',
      reuseExistingServer: false,
    },
    {
      command: 'PORT=2607 AUTH_DB_PATH=:memory: node --import tsx server/index.ts',
      url: 'http://127.0.0.1:2607/healthz',
      reuseExistingServer: false,
    },
  ],
});

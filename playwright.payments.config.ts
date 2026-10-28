import { defineConfig } from '@playwright/test';

process.env.ROYAL_SANDBOX_BROWSER = 'true';
process.env.TEST_BASE_URL = 'http://127.0.0.1:2585';
export default defineConfig({
  testDir: './tests', testMatch: ['demo-wallet.spec.ts', 'crypto-wallet.spec.ts', 'nile-play.spec.ts', 'telegram-stars.spec.ts'],
  timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:2585', channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'node --import tsx scripts/nowpayments-sandbox-local.ts',
    env: { ROYAL_SANDBOX_UI_PORT: '2585' }, url: 'http://127.0.0.1:2585/healthz',
    reuseExistingServer: false, timeout: 45000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15000 } },
});

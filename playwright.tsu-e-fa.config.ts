import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'tsu-e-fa.spec.ts', workers: 1, timeout: 150000,
  outputDir: 'test-results/tsu-e-fa',
  webServer: { command: 'node --import tsx scripts/pvp-local.ts', url: 'http://127.0.0.1:5193', timeout: 120000,
    env: { PVP_DEV_CLIENT: '0', PVP_WEB_PORT: '5193' } },
  use: { baseURL: 'http://127.0.0.1:5193', channel: 'chrome', viewport: { width: 1366, height: 900 },
    actionTimeout: 10000, screenshot: 'only-on-failure', trace: { mode: 'retain-on-failure', screenshots: false } },
});

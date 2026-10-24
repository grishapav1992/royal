import { defineConfig } from '@playwright/test';
process.env.TEST_BASE_URL = 'http://127.0.0.1:2691';
export default defineConfig({
  testDir: './tests', testMatch: 'studio-cabinet-catalog.spec.ts', workers: 1, timeout: 150000,
  outputDir: 'artifacts/studio-cabinet-catalog/results',
  use: { baseURL: 'http://127.0.0.1:2691', channel: 'chrome', viewport: { width: 1366, height: 900 }, trace: 'retain-on-failure' },
  webServer: [
    { command: 'PORT=2691 CODEX_SALE_API_KEY= node --import tsx server/index.ts', url: 'http://127.0.0.1:2691/healthz', reuseExistingServer: false },
  ],
});

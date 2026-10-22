import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'neopolis.spec.ts', workers: 1, timeout: 120000,
  outputDir: 'test-results/neopolis',
  use: { baseURL: 'http://127.0.0.1:5216', channel: 'chrome', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node --import tsx scripts/neopolis-preview.ts', url: 'http://127.0.0.1:5216/tests/fixtures/neopolis-preview.html', reuseExistingServer: true, timeout: 120000 },
});

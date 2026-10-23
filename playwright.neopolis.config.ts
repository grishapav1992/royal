import { defineConfig } from '@playwright/test';
const origin = 'http://127.0.0.1:' + (process.env.NEOPOLIS_WEB_PORT || '5216');
export default defineConfig({
  testDir: './tests', testMatch: 'neopolis.spec.ts', workers: 1, timeout: 120000,
  outputDir: 'test-results/neopolis',
  use: { baseURL: origin, channel: 'chrome', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node --import tsx scripts/neopolis-preview.ts', env:{NEOPOLIS_TEST_RNG:'1'}, url: origin + '/tests/fixtures/neopolis-preview.html', reuseExistingServer: !process.env.CI, timeout: 120000 },
});

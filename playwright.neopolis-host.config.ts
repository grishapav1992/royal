import { defineConfig } from '@playwright/test';

const port = process.env.NEOPOLIS_WEB_PORT || '5276';
export default defineConfig({
  testDir: './tests', testMatch: 'neopolis-host.spec.ts', workers: 1, timeout: 90000,
  outputDir: 'test-results/neopolis-host',
  use: { baseURL: 'http://127.0.0.1:' + port, channel: 'chrome', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  webServer: {
    command: 'node --import tsx scripts/neopolis-preview.ts',
    env: { NEOPOLIS_WEB_PORT: port, NEOPOLIS_API_PORT: process.env.NEOPOLIS_API_PORT || '2676', NEOPOLIS_TEST_RNG: '1' },
    url: 'http://127.0.0.1:' + port + '/tests/fixtures/neopolis-preview.html', reuseExistingServer: !process.env.CI,
  },
});

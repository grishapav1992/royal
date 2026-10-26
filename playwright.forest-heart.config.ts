import { defineConfig } from '@playwright/test';
const origin = 'http://127.0.0.1:' + (process.env.FOREST_WEB_PORT || '5296');
process.env.TEST_BASE_URL = 'http://127.0.0.1:' + (process.env.FOREST_API_PORT || '2696');
export default defineConfig({
  testDir: './tests', testMatch: 'forest-heart.spec.ts', workers: 1, timeout: 180000,
  outputDir: 'artifacts/work/forest-heart-client/browser-results',
  // Trace DOM snapshots distort frame/audio timing. Save explicit screenshots and measurements instead.
  use: { baseURL: origin, channel: process.env.CI ? 'chromium' : 'chrome', viewport: { width: 1440, height: 1000 }, actionTimeout: 15000, trace: 'off' },
  webServer: { command: 'node --import tsx scripts/forest-heart-preview.ts', url: origin + '/', reuseExistingServer: !process.env.CI, timeout: 120000 },
});

import { defineConfig } from '@playwright/test';
const origin = 'http://127.0.0.1:' + (process.env.FOREST_WEB_PORT || '5296');
process.env.TEST_BASE_URL = 'http://127.0.0.1:' + (process.env.FOREST_API_PORT || '2696');
export default defineConfig({
  globalTeardown: './scripts/forest-heart-teardown.ts',
  testDir: './tests', testMatch: ['forest-heart.spec.ts','forest-heart-audio.spec.ts'], workers: 1, timeout: 180000,
  outputDir: (process.env.FOREST_ARTIFACT_DIR || 'artifacts/work/forest-heart-client') + '/browser-results',
  // Trace DOM snapshots distort frame/audio timing. Save explicit screenshots and measurements instead.
  use: { baseURL: origin, channel: process.env.CI ? 'chromium' : 'chrome', viewport: { width: 1440, height: 1000 }, actionTimeout: 15000, trace: 'off',
    video: process.env.FOREST_CAPTURE_VIDEO === '1' ? { mode: 'on', size: { width: 1440, height: 1000 } } : 'off' },
  webServer: { command: 'node --import tsx scripts/forest-heart-preview.ts', env:{FOREST_TEST_AUTOMATED:'1'}, url: origin + '/', reuseExistingServer: !process.env.CI, timeout: 120000 },
});

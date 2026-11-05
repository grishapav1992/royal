import { defineConfig } from '@playwright/test';

const baseURL = process.env.TEST_BASE_URL;
if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') {
  throw new Error('Set TEST_BASE_URL to the isolated local host with a disposable database.');
}
export default defineConfig({
  testDir: './tests', testMatch: 'character-selection.spec.ts', timeout: 60000, workers: 1,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results/character-selection',
  use: { baseURL, channel: 'chrome' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});

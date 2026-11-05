import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'entry-modes.spec.ts', timeout: 90000, workers: 1,
  use: { baseURL: process.env.ENTRY_TEST_URL || 'http://127.0.0.1:5198', channel: 'chrome', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' },
});

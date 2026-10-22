import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: ['cr-leo-rendering.spec.ts', 'cr-leo-audio.spec.ts'], workers: 1, timeout: 60000,
  outputDir: 'test-results/cr-leo',
  use: { channel: 'chrome', baseURL: 'http://127.0.0.1:5232', viewport: { width: 1100, height: 860 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/build-game-module.mjs --game cr-vs-leo && node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5232 --strictPort', url: 'http://127.0.0.1:5232', reuseExistingServer: false },
});

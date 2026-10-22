import { defineConfig } from '@playwright/test';

// This suite owns a local web host and never opens a production connection.
export default defineConfig({
  testDir: './tests', testMatch: 'chat-delivery.spec.ts', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4180', channel: 'chrome', viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' },
  webServer: {
    command: 'node scripts/build-game-module.mjs --game royal-dice && node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180', reuseExistingServer: false, timeout: 60000,
  },
});
